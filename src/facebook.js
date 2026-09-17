// Facebook-specific embedding. Unlike the other platforms in rules.js, Facebook has
// no reliable public "fixup" host to redirect to — so instead of rewriting the link,
// this module fetches the post itself (spoofing Facebook's own link-preview crawler
// user-agent, which gets a lighter-weight response than a real browser would) and
// builds a native Discord embed from the extracted Open Graph tags. No credentials,
// no headless browser, no external service required.

const { EmbedBuilder } = require('discord.js');
const { isInSpoiler } = require('./rules');

// Matches facebook.com / fb.watch / fb.com links, scheme and subdomains optional —
// same shape as the rules in rules.js. Kept separate from RULES since Facebook
// isn't a text rewrite, it's a native embed. Path stops before "||" so it doesn't
// swallow a spoiler's closing bar, same fix as rules.js.
const FB_URL_PATTERN =
  /(?<![\w.@-])(?:https?:\/\/)?(?:[\w-]+\.)*?(?:facebook\.com|fb\.watch|fb\.com)\/(?:(?!\|\|)[^\s<>"')\]])+/gi;

const CACHE_TTL_MS = 15 * 60 * 1000; // absorbs re-shares of the same post without hammering Facebook
const FETCH_TIMEOUT_MS = 8000;
const VIDEO_VERIFY_TIMEOUT_MS = 4000;
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const RETRY_DELAY_MS = 250;

// The crawler UA gets Facebook's lightweight "link preview" response, which for some
// Reels/videos only exposes the flaky lookaside.fbsbx.com crawler-media endpoint (see
// verifyVideoUrl). A logged-in session gets the real page instead, so when a cookie is
// configured (see extractFacebookPost's `cookie` option), requests impersonate a real
// browser and attach it rather than announcing themselves as a crawler.
const CRAWLER_USER_AGENT = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36';

// Facebook serves a generic "log in to see this" page instead of real OG tags when it
// doesn't like the request (rate limiting, geo, etc.). Treat that as extraction failure
// rather than posting a useless embed.
const LOGIN_WALL_MARKERS = [
  'log in or sign up',
  'you must log in',
  'see posts, photos and more on facebook',
];

const cache = new Map(); // normalized url -> { data, expires }

// A bot-built embed (EmbedBuilder, sent via the API) can't be spoiler-blurred by
// Discord the way a natively-unfurled link can, so a spoilered Facebook link skips
// building the rich embed entirely (see extractFacebookMatches' caller in
// linkConversion.js) — nothing to leak before it's revealed. Routing the link
// through a public fixup host instead of posting the raw facebook.com URL means
// Discord's own native unfurl handles it, which DOES inherit the spoiler, giving
// the same "revealed on click" experience every other platform already has.
const SPOILER_FIX_HOST = 'facebed.seria.moe';
const FB_DOMAIN_PATTERN = /(?:[\w-]+\.)*?(?:facebook\.com|fb\.watch|fb\.com)/i;

/** Redirects a Facebook URL to a public fixup host, for the spoilered case only —
 * non-spoilered posts keep this bot's own richer OG-scraped embed. */
function spoilerFixUrl(url) {
  return url.replace(FB_DOMAIN_PATTERN, SPOILER_FIX_HOST);
}

/** Rewrites every Facebook link in `text` (the whole original message, for a
 * webhook repost) in place: a spoilered link's domain is swapped for the
 * public fixup host so Discord's native unfurl still renders it — still
 * inside the same `||...||` bars already in the text, so it stays spoilered.
 * A non-spoilered link that resolved to a playable video (`videoLinkByUrl`,
 * keyed by the same normalized url buildConversion looked it up with) is
 * replaced outright by that video/proxy link — live, not wrapped — so Discord
 * unfurls THAT instead of the original post; leaving the original in place
 * too (even suppressed via `<...>`) would print the same video twice. Any
 * other non-spoilered link is wrapped in `<...>`, Discord's own per-link
 * embed-suppression syntax, since its richer OG-scraped embed is attached
 * separately and a live raw URL would otherwise get a second, broken
 * auto-embed from Discord right alongside it. `matches` is
 * extractFacebookMatches's output for the same text, reused here instead of
 * re-detecting spoiler status so this can't disagree with the caller about
 * which links are spoilered. Doing these swaps in place — rather than leaving
 * the raw link suppressed AND appending the replacement as a second line — is
 * what keeps a message from printing the same post twice. */
function rewriteFacebookLinksForRepost(text, matches, videoLinkByUrl = new Map()) {
  const spoilerByUrl = new Map(matches.map((m) => [m.url, m.spoiler]));
  return text.replace(FB_URL_PATTERN, (m) => {
    const url = /^https?:\/\//i.test(m) ? m : `https://${m}`;
    if (spoilerByUrl.get(url)) return spoilerFixUrl(url);
    const videoLink = videoLinkByUrl.get(url);
    return videoLink || `<${url}>`;
  });
}

/** Find all Facebook links in a block of text (deduped, scheme normalized), each
 * flagged with whether it fell inside ||spoiler|| bars — first occurrence wins if
 * the same link appears both spoilered and not. */
function extractFacebookMatches(text, spoilerRanges = []) {
  const seen = new Map(); // normalized url -> spoiler
  for (const m of text.matchAll(FB_URL_PATTERN)) {
    const url = /^https?:\/\//i.test(m[0]) ? m[0] : `https://${m[0]}`;
    if (!seen.has(url)) {
      seen.set(url, isInSpoiler(spoilerRanges, m.index, m.index + m[0].length));
    }
  }
  return [...seen].map(([url, spoiler]) => ({ url, spoiler }));
}

/** Find all Facebook links in a block of text (deduped, scheme normalized). */
function extractFacebookUrls(text) {
  return extractFacebookMatches(text).map((m) => m.url);
}

/** Strip tracking params so re-shares of the same post share a cache entry. */
function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    ['mibextid', 'ref', '__tn__', '__cft__[0]', 'sfnsn', 'paipv', 'eav', 'rdid', 'fbclid'].forEach(
      (p) => parsed.searchParams.delete(p)
    );
    return parsed.toString();
  } catch {
    return url;
  }
}

function decodeHtmlEntities(str) {
  return str
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// Multi-photo posts repeat the og:image tag once per photo, so those need
// collecting into a list rather than treated as a single overwritable tag.
function parseOgTags(html) {
  const tags = {};
  const images = [];
  const collect = (key, value) => {
    const decoded = decodeHtmlEntities(value);
    if (key === 'og:image') images.push(decoded);
    else tags[key] = decoded;
  };
  const re1 = /<meta\s+(?:property|name)=["'](og:[^"']+)["']\s+content=["']([^"']*)["'][^>]*>/gi;
  let m;
  while ((m = re1.exec(html))) collect(m[1], m[2]);
  const re2 = /<meta\s+content=["']([^"']*)["']\s+(?:property|name)=["'](og:[^"']+)["'][^>]*>/gi;
  while ((m = re2.exec(html))) collect(m[2], m[1]);
  return { tags, images: [...new Set(images)] };
}

function looksLikeLoginWall(tags) {
  const text = `${tags['og:title'] || ''} ${tags['og:description'] || ''}`.toLowerCase();
  return LOGIN_WALL_MARKERS.some((marker) => text.includes(marker));
}

// Extracts the JSON object value for a `"key":{...}` occurrence, honoring quoted
// strings/escapes so brace characters inside string values don't miscount. Returns
// null if the key isn't found or the braces never balance.
function readJsonObjectAt(html, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  return null;
}

function extractJsonObject(html, keyPattern) {
  const m = keyPattern.exec(html);
  if (!m) return null;
  return readJsonObjectAt(html, m.index + m[0].length - 1); // m.index+... is the opening "{"
}

// Reels no longer expose an og:video meta tag — the page instead embeds this field
// (JSON-escaped, e.g. `"browser_native_hd_url":"https:\/\/lookaside.fbsbx.com\/..."`)
// pointing at a stable lookaside.fbsbx.com crawler-media URL that serves the actual
// video/mp4 file directly (unlike the DASH CDN URLs elsewhere in the page, which are
// split into separate video/audio streams and short-lived).
// Scoped to the post's own "story" object (same node extractPostTimestamp reads) —
// the page also embeds hydration JSON for other content, like preloaded comments,
// and a matching field there would belong to a commenter's attached video, not the post's.
function extractBrowserNativeVideoUrl(html) {
  const story = extractJsonObject(html, /"story":\{/);
  if (!story) return null;
  const m = /"browser_native_(?:hd|sd)_url":"([^"]+)"/.exec(story);
  return m ? m[1].replace(/\\\//g, '/') : null;
}

// A page fetched with a logged-in `cookie` (see extractFacebookPost) exposes a completely
// different, better video field than the anonymous crawler page: "progressive_urls", a
// fully-signed direct CDN link that's actually playable (unlike browser_native_*_url above,
// a crawler-only lookaside stub that 500s for most requesters — see extractBrowserNativeVideoUrl's
// callers). This field doesn't exist at all without a cookie, so this is only worth trying
// when one's configured.
// The page repeats this shape once per video referenced on it (the post's own video, plus any
// "up next" reels bundled in the same response) with no post/comment id sitting next to it to
// scope by — but each one is immediately preceded by a "dash_manifest_urls" entry naming that
// video's own id (`dash_mpd_debug.mpd?v=<id>`), which anchors this to the requested video
// specifically (id comes from the post's own URL, see extractVideoIdFromUrl).
function extractProgressiveVideoUrl(html, videoId) {
  if (!videoId) return null;
  const anchor = html.indexOf(`dash_mpd_debug.mpd?v=${videoId}&`);
  if (anchor === -1) return null;
  const arrayStart = html.indexOf('"progressive_urls":[', anchor);
  if (arrayStart === -1 || arrayStart - anchor > 2000) return null;
  const arrayEnd = html.indexOf(']', arrayStart);
  const block = html.slice(arrayStart, arrayEnd);
  const entries = [...block.matchAll(/"progressive_url":"((?:[^"\\]|\\.)*)"[\s\S]*?"quality":"([^"]+)"/g)].map(
    (m) => ({ url: decodeJsonEscapedString(m[1]), quality: m[2] })
  );
  if (!entries.length) return null;
  entries.sort((a, b) => (b.quality === 'HD' ? 1 : 0) - (a.quality === 'HD' ? 1 : 0));
  return entries[0].url;
}

// Pulls the numeric video id out of a Facebook video/Reel URL — /reel/<id>, /videos/<id>
// (optionally under a group's /pcb.<n>/ path), or a /watch?v=<id> query param. Returns null
// for URL shapes with no video id (permalink/photo posts), which just skip the progressive-url
// lookup above.
function extractVideoIdFromUrl(url) {
  const m = /\/(?:reel|videos)\/(?:pcb\.\d+\/)?(\d+)/.exec(url) || /[?&]v=(\d+)/.exec(url);
  return m ? m[1] : null;
}

// A /share/v/<code> link posted inside a group commonly redirects to a
// /groups/<id>/permalink/<postId>/ URL, not /reel/ or /videos/ — that carries
// the *post's* id, so extractVideoIdFromUrl above has nothing to match and
// comes back empty even though the page itself has a genuine playable video.
// Falls back to anchoring on the post's own feedback id instead (same
// technique as the caption/reactions lookups) and taking the nearest
// dash_mpd_debug id to it. Confirmed on a real page: the post's own video sits
// ~15,000 chars from its feedback id, an unrelated "up next" video 2,000,000+
// chars away — a 50,000-char radius safely picks only the right one.
function extractVideoIdNearFeedback(html, feedbackId) {
  if (!feedbackId) return null;
  const m = findMatchNearId(html, feedbackId, /dash_mpd_debug\.mpd\?v=(\d+)/, 50000);
  return m ? m[1] : null;
}

// The post's creation time isn't in any og: tag, but it is embedded (once, as a
// unix-seconds timestamp) in the page's hydration JSON alongside the story data,
// e.g. `"story":{"creation_time":1451861194,"unpublished_content_type":"PUBLISHED"...}`.
// Falls back to null (no date shown) rather than guessing, since the page's
// internal JSON shape isn't a stable public API and may shift.
function extractPostTimestamp(html) {
  const m = /"story":\{"creation_time":(\d+)/.exec(html);
  return m ? Number(m[1]) * 1000 : null;
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The post's own message-bearing "story" fragment (same node
// extractEmbeddedPostData's photo_image reads) only ever references its own
// post's feedback id — every count field below is searched near THIS id
// rather than unscoped, since the page bundles the exact same-looking count
// fields for other posts too (a suggested Reels tray, ads, preloaded
// comments), just far enough away (hundreds of thousands of characters, in
// practice) that a modest radius can't confuse the two.
function findFeedbackId(html, story = extractJsonObject(html, /"story":\{/)) {
  const m = story && /"(ZmVlZGJhY2s6[A-Za-z0-9+/=]+)"/.exec(story);
  return m ? m[1] : null;
}

function findMatchNearId(html, feedbackId, pattern, radius = 500) {
  for (const m of html.matchAll(new RegExp(escapeRegExp(feedbackId), 'g'))) {
    const start = Math.max(0, m.index - radius);
    const end = Math.min(html.length, m.index + feedbackId.length + radius);
    const found = pattern.exec(html.slice(start, end));
    if (found) return found;
  }
  return null;
}

function findNumberNearId(html, feedbackId, pattern, radius = 500) {
  const found = findMatchNearId(html, feedbackId, pattern, radius);
  return found ? Number(found[1]) : null;
}

// Facebook exposes reactions/comments/shares under different field names
// depending on the post/page shape, both only present with a logged-in
// `cookie` (see extractFacebookPost):
// - Older shape: "unified_reactors":{"count":N}, "total_comment_count":N,
//   "share_count_reduced":"N".
// - Newer shape (seen on a cookie-fetched plain page post): three separate
//   "UFI...ActionRenderer" fragments, each repeating the feedback id right
//   next to its own "reaction_count"/"comment_rendering_instance...
//   total_count"/"share_count" field.
// Without a cookie, neither shape is present at all — falls through to the
// anonymous-fragment shapes below.
function extractEngagementCounts(html) {
  const feedbackId = findFeedbackId(html);
  if (feedbackId) {
    const reactions =
      findNumberNearId(html, feedbackId, /"unified_reactors":\{"count":(\d+)/) ??
      findNumberNearId(html, feedbackId, /"reaction_count":\{"count":(\d+)\}/);
    if (reactions != null) {
      const comments =
        findNumberNearId(html, feedbackId, /"total_comment_count":(\d+)/) ??
        findNumberNearId(html, feedbackId, /"comment_rendering_instance":\{"comments":\{"total_count":(\d+)/);
      const shares =
        findNumberNearId(html, feedbackId, /"share_count_reduced":"(\d+)"/) ??
        findNumberNearId(html, feedbackId, /"share_count":\{"count":(\d+)\}/);
      return { reactions, comments, shares };
    }
  }

  const anon =
    /"comment_rendering_instance":\{"comments":\{"total_count":(\d+)\}\}[\s\S]{0,300}?"reaction_count":\{"count":(\d+)/.exec(
      html
    );
  if (anon) return { reactions: Number(anon[2]), comments: Number(anon[1]), shares: null };

  // /photo?fbid= permalink pages use a third anonymous shape: reaction_count, share_count
  // and comment_rendering_instance are all present (unlike the plain anon fragment above,
  // which never exposes shares) but spread further apart, tied together by the feedback id
  // closing the reaction_count block and reappearing before comment_rendering_instance —
  // matched via backreference so a different post's numbers elsewhere on the page can't
  // be picked up instead.
  const photoPage =
    /"reaction_count":\{"count":(\d+)\}[\s\S]{0,500}?"id":"(ZmVlZGJhY2s6[^"]+)"\}[\s\S]{0,100}?"i18n_share_count":"\d+","share_count":\{"count":(\d+)[\s\S]{0,300}?"id":"\2"[\s\S]{0,100}?"comment_rendering_instance":\{"comments":\{"total_count":(\d+)\}\}/.exec(
      html
    );
  if (photoPage)
    return { reactions: Number(photoPage[1]), comments: Number(photoPage[4]), shares: Number(photoPage[3]) };

  return { reactions: null, comments: null, shares: null };
}

// Facebook rate-limits/hiccups often enough that a single failed fetch
// shouldn't mean "no embed at all" for the whole post. Retries on a transient
// status (429/500/502/503/504) or a thrown network/timeout error, up to
// `attempts` tries total, with a short fixed delay between them. Builds the
// abort signal itself from `timeoutMs` fresh on every attempt — reusing one
// `AbortSignal.timeout(...)` across retries would carry over an already-
// elapsed (or already-fired) deadline from the first attempt.
async function fetchWithRetry(url, options, timeoutMs, attempts = 2) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
      if (response.ok || !RETRY_STATUSES.has(response.status) || attempt === attempts) return response;
    } catch (err) {
      if (attempt === attempts) throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  }
}

// Unlike an actual og:video: tag, the browser_native lookaside url is an
// undocumented endpoint that serves the real .mp4 for some posts and a 500
// error page for others, with nothing in the post's own metadata predicting
// which — so probe it with a HEAD request (cheap: no body download) before
// trusting it as playable, rather than finding out only when Discord's own
// unfurler tries and fails.
async function verifyVideoUrl(url) {
  try {
    const response = await fetchWithRetry(
      url,
      {
        method: 'HEAD',
        headers: { 'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)' },
      },
      VIDEO_VERIFY_TIMEOUT_MS
    );
    return response.ok && (response.headers.get('content-type') || '').startsWith('video/');
  } catch {
    return false;
  }
}

function decodeJsonEscapedString(escaped) {
  try {
    return JSON.parse(`"${escaped}"`);
  } catch {
    return escaped;
  }
}

// Multi-photo posts used to repeat the og:image tag once per photo (see parseOgTags),
// but Facebook now only emits one — the cover photo. The full set still lives in the
// page's album hydration JSON, e.g. `"all_subattachments":{"count":2,"nodes":[{"media":
// {"image":{"uri":"..."}}},...]}`. Scoped to that object so an unrelated "image" field
// elsewhere on the page (comments, sidebar) isn't picked up.
function extractAlbumImages(html) {
  const album = extractJsonObject(html, /"all_subattachments":\{/);
  if (!album) return [];
  const images = [];
  const re = /"image":\{"uri":"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(album))) images.push(decodeJsonEscapedString(m[1]));
  return images;
}

// Some routes (e.g. /photo?fbid=...) render the Comet SPA shell with no server-side
// og: tags at all — the crawler gets a blank <title>Facebook</title> page. The post's
// caption and image are still present, though, as JSON embedded in a <script> blob
// (React hydration data), so fall back to pulling them out of there directly.
function extractEmbeddedPostData(html) {
  // Scoped to the post's own "story" object (same node extractPostTimestamp/
  // extractEngagementCounts read) when one's present — a page this shell-only
  // (logged-in fetch of a permalink/post) bundles dozens of unrelated "story"
  // fragments for other feed items, ads and the viewer's own nav furniture, so
  // an unscoped search below would just as easily match one of those. Some
  // routes (e.g. /photo?fbid=...) have no "story" object at all, so this falls
  // back to searching the whole page rather than giving up.
  const story = extractJsonObject(html, /"story":\{/);
  // Facebook fragments a post's own data across several separate "story"
  // occurrences (one might carry the caption, another the photo, another
  // just engagement counts) — the single "story" object picked above isn't
  // guaranteed to have every field. A caption missing from it specifically
  // (but not the page at all) is looked for next near the post's own feedback
  // id (see extractEngagementCounts) rather than falling straight to an
  // unscoped whole-page search: the page also bundles a personalized "up
  // next"/suggested reel whose position shifts between requests, so "whichever
  // message comes first in the raw page" isn't actually stable — it can (and
  // did) return a different reel's caption instead of this post's own. Only a
  // route with no feedback id at all (e.g. /photo?fbid=..., the original case
  // this fallback was built for) falls back to that unscoped search.
  const MESSAGE_PATTERN = /"message":\{"text":"((?:[^"\\]|\\.)*)"/;
  const feedbackId = findFeedbackId(html, story);
  const messageMatch =
    (story && MESSAGE_PATTERN.exec(story)) ||
    (feedbackId && findMatchNearId(html, feedbackId, MESSAGE_PATTERN)) ||
    MESSAGE_PATTERN.exec(html);
  // The post's own attached photo lives under "photo_image" — a field specific
  // to a real photo attachment, unlike the generic "image" key which just as
  // often matches page furniture (the viewer's own nav bookmark avatar, an
  // unrelated ad's thumbnail, a suggested reel's preview). Scoped to `story`
  // when there is one, so a different post's "photo_image" on the same page
  // can't be picked up instead. A route with no "story" object at all (see
  // above) has no such furniture to be confused with in the first place, so
  // that case still falls back to the plain, unscoped "image" key.
  const imageMatch = story
    ? /"photo_image":\{"uri":"((?:[^"\\]|\\.)*)"/.exec(story)
    : /"image":\{"uri":"((?:[^"\\]|\\.)*)"/.exec(html);
  // The author's display name (page or profile) never lands inside the single
  // "story" object picked above — observed sitting several thousand chars away
  // from the post's own feedback id, further than the 500-char default radius
  // the engagement counts use, hence the wider one here. Other posts bundled on
  // the same page (feed suggestions, comments) sit hundreds of thousands of
  // chars further out, so this radius doesn't risk picking up their actor
  // instead. Same no-feedback-id fallback as the message/image fields above.
  // A plain post/photo exposes it under "actors"; a Reel exposes it under
  // "owner" instead (no "actors" array at all) — try both shapes.
  const NAME_PATTERN = /"actors":\[\{"__typename":"[^"]*","name":"((?:[^"\\]|\\.)*)"/;
  const OWNER_NAME_PATTERN = /"owner":\{"__typename":"User"(?:,"[a-zA-Z_]+":"[^"]*")*,"name":"((?:[^"\\]|\\.)*)"/;
  const nameMatch =
    (feedbackId && findMatchNearId(html, feedbackId, NAME_PATTERN, 10000)) ||
    (feedbackId && findMatchNearId(html, feedbackId, OWNER_NAME_PATTERN, 10000)) ||
    NAME_PATTERN.exec(html) ||
    OWNER_NAME_PATTERN.exec(html);
  if (!messageMatch && !imageMatch && !nameMatch) return null;
  return {
    description: messageMatch ? decodeJsonEscapedString(messageMatch[1]) : '',
    image: imageMatch ? decodeJsonEscapedString(imageMatch[1]) : null,
    author: nameMatch ? decodeJsonEscapedString(nameMatch[1]) : '',
  };
}

/**
 * Fetch a Facebook URL and extract embeddable post data (title, description, image).
 * Returns null if nothing usable came back (login wall, deleted post, network error).
 * Results are cached for CACHE_TTL_MS so re-shares don't re-fetch.
 *
 * `skipVideoVerification`: post the browser_native lookaside URL without HEAD-checking
 * it first. That endpoint genuinely 500s for some posts (Facebook-side, not fixable
 * client-side) — verifying avoids showing a broken video player, but means those posts
 * fall back to an image-only embed. Skipping trades that safety for more videos posted,
 * some of which won't actually play.
 *
 * `cookie`: a logged-in session's Cookie header value. When set, fetches the post as
 * that browser session instead of as Facebook's own crawler — gets the real page
 * (better odds of a working video URL) at the cost of using a real account to scrape.
 */
// A single fetch-and-parse attempt, factored out of extractFacebookPost so a
// login wall (see below) can be retried as a whole new request rather than
// just given up on — a fresh request often lands on a real page next time
// (observed: the same URL alternating between real content and a login wall
// across back-to-back requests), unlike a genuinely dead post/cookie.
async function attemptExtractFacebookPost(url, key, { skipVideoVerification, cookie }) {
  const response = await fetchWithRetry(
    key,
    {
      headers: cookie
        ? {
            // A logged-in request gets Facebook's bot-fingerprint check applied (the
            // plain crawler UA below skips it) — a bare UA + Cookie isn't enough and
            // gets a generic HTTP 400 "Error" page; needs the browser-signature
            // headers Chrome itself sends alongside a real cookie to pass.
            'User-Agent': BROWSER_USER_AGENT,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Sec-Ch-Ua': '"Chromium";v="132", "Not(A:Brand";v="99"',
            'Sec-Ch-Ua-Mobile': '?0',
            'Sec-Ch-Ua-Platform': '"Windows"',
            'Upgrade-Insecure-Requests': '1',
            Cookie: cookie,
          }
        : {
            'User-Agent': CRAWLER_USER_AGENT,
            Accept: 'text/html,application/xhtml+xml',
            'Accept-Language': 'en-US,en;q=0.9',
          },
      redirect: 'follow',
    },
    FETCH_TIMEOUT_MS
  );

  if (!response.ok) return { data: null, hitLoginWall: false };

  const html = await response.text();
  const { tags, images } = parseOgTags(html);
  const ogHasContent = tags['og:title'] || tags['og:description'] || images.length;
  // A /watch/?v= video page can have neither a caption nor a photo at all
  // (extractEmbeddedPostData's fallback then finds nothing either) while
  // still having a perfectly good video — checked separately so that case
  // doesn't get thrown away before video extraction below even runs.
  const hasVideoSignal =
    Boolean(tags['og:video'] || tags['og:video:secure_url'] || tags['og:video:url']) ||
    /browser_native_(?:hd|sd)_url/.test(html) ||
    /dash_mpd_debug\.mpd\?v=/.test(html);
  const fallback = ogHasContent ? null : extractEmbeddedPostData(html);
  const hitLoginWall = looksLikeLoginWall(tags);
  if (!((ogHasContent || fallback || hasVideoSignal) && !hitLoginWall)) {
    return { data: null, hitLoginWall };
  }

  const albumImages = extractAlbumImages(html);
  const imageList = albumImages.length ? albumImages : images;
  // Cap at 4 — Discord's own multi-image gallery grouping (see buildEmbed) tops out there.
  const allImages = imageList.length ? imageList.slice(0, 4) : fallback && fallback.image ? [fallback.image] : [];
  // Reels/videos expose a direct (usually short-lived, signed) file URL here.
  // Posted as plain text it lets Discord's own unfurler render a playable
  // video, which a bot-built embed can't do (see buildEmbed below). Reels no
  // longer set these og:video tags at all, so fall back (in order):
  //  1. progressive_urls, only present with a logged-in `cookie` — a genuinely
  //     playable signed CDN link (see extractProgressiveVideoUrl), trusted without
  //     the HEAD check below since it isn't the flaky crawler stub that check
  //     exists for.
  //  2. the browser_native lookaside URL embedded in the page (see
  //     extractBrowserNativeVideoUrl) — verified before use since, without a
  //     cookie, it's the crawler-only stub that 500s for most requesters.
  const taggedVideo = tags['og:video:secure_url'] || tags['og:video:url'] || tags['og:video'];
  // A share/v/<code> link's own URL has no video id in it at all (an
  // opaque short code) — it only shows up after Facebook's redirect
  // resolves it to the real /reel/<id> or /videos/<id> URL, so this
  // must read the id from where the fetch actually landed (response.url),
  // not the URL that was requested. Still tries the requested url too,
  // in case a redirect-less fetch left response.url exactly the same.
  // A share/v/ link inside a group instead redirects to a /permalink/ URL,
  // which has a post id but no video id at all — falls back to finding it
  // in the page itself (see extractVideoIdNearFeedback).
  const videoId =
    extractVideoIdFromUrl(response.url) ||
    extractVideoIdFromUrl(url) ||
    extractVideoIdNearFeedback(html, findFeedbackId(html));
  const progressiveVideo = taggedVideo ? null : extractProgressiveVideoUrl(html, videoId);
  const browserNativeVideo = taggedVideo || progressiveVideo ? null : extractBrowserNativeVideoUrl(html);
  const browserNativeVideoOk =
    browserNativeVideo && (skipVideoVerification || (await verifyVideoUrl(browserNativeVideo)));
  const video = taggedVideo || progressiveVideo || (browserNativeVideoOk ? browserNativeVideo : null);
  const engagement = extractEngagementCounts(html);
  const data = {
    title: tags['og:title'] || (fallback && fallback.author) || '',
    description: tags['og:description'] || (fallback && fallback.description) || '',
    image: allImages[0] || null,
    images: allImages,
    video,
    siteName: tags['og:site_name'] || 'Facebook',
    // Some posts' og:url is a legacy-style permalink with the whole caption
    // URL-encoded into the path (500+ chars of %XX-heavy text) — Discord's API
    // 500s when asked to send an embed with a url that long, so fall back to
    // the (short) link that was actually shared instead.
    url: tags['og:url'] && tags['og:url'].length <= 300 ? tags['og:url'] : key,
    timestamp: extractPostTimestamp(html),
    reactions: engagement.reactions,
    comments: engagement.comments,
    shares: engagement.shares,
  };
  return { data, hitLoginWall: false };
}

/**
 * Fetch a Facebook URL and extract embeddable post data (title, description, image).
 * Returns null if nothing usable came back (login wall, deleted post, network error).
 * Results are cached for CACHE_TTL_MS so re-shares don't re-fetch.
 *
 * `skipVideoVerification`: post the browser_native lookaside URL without HEAD-checking
 * it first. That endpoint genuinely 500s for some posts (Facebook-side, not fixable
 * client-side) — verifying avoids showing a broken video player, but means those posts
 * fall back to an image-only embed. Skipping trades that safety for more videos posted,
 * some of which won't actually play.
 *
 * `cookie`: a logged-in session's Cookie header value. When set, fetches the post as
 * that browser session instead of as Facebook's own crawler — gets the real page
 * (better odds of a working video URL) at the cost of using a real account to scrape.
 */
async function extractFacebookPost(url, { skipVideoVerification = false, cookie = '' } = {}) {
  const key = normalizeUrl(url);
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.data;

  let data = null;
  // A login wall often clears up on a fresh request a moment later (observed:
  // the same URL alternating between real content and a login wall across
  // back-to-back fetches) — worth one immediate retry. Skipped with a cookie:
  // there a wall means that specific session is dead, not a transient block,
  // so retrying just burns a request for the same failure (see the warning below).
  const attempts = cookie ? 1 : 2;
  try {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const result = await attemptExtractFacebookPost(url, key, { skipVideoVerification, cookie });
      if (result.data) {
        data = result.data;
        break;
      }
      if (!result.hitLoginWall) break;
      // A login wall with no cookie configured is normal (Facebook just doesn't
      // trust the plain crawler UA with everything) — silently falls through
      // to whatever a real request without one would see. With a cookie, it
      // means that specific session is dead (expired, logged out elsewhere,
      // checkpointed) and every fetch using it will now quietly degrade the
      // same way FACEBOOK_COOKIE being unset always has, until it's replaced.
      if (cookie) {
        console.warn(
          `Facebook: FACEBOOK_COOKIE looks expired or invalid (hit a login wall fetching ${url}) — get a fresh cookie and update it`
        );
      } else if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  } catch (err) {
    console.error(`Facebook: extraction failed for ${url}:`, err.message);
  }

  cache.set(key, { data, expires: Date.now() + CACHE_TTL_MS });
  return data;
}

// Discord's native embed.setTimestamp() renders in each viewer's own locale/timezone,
// which would show a different clock time to every reader — not what "UTC+7" means.
// Format it once, fixed to Bangkok time, and label it explicitly instead.
function formatUtc7(ms) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    dateStyle: 'medium',
    timeStyle: 'short',
    hour12: false,
  }).format(ms);
}

// Matches Facebook's own og:title abbreviation style (e.g. "20K") closely enough for
// a compact footer line — one decimal place, trimmed when it'd just be ".0".
function humanFormat(n) {
  if (n < 1000) return String(n);
  const [unit, suffix] = n < 1_000_000 ? [1000, 'K'] : [1_000_000, 'M'];
  return `${(n / unit).toFixed(1).replace(/\.0$/, '')}${suffix}`;
}

// Shares are only ever available when FACEBOOK_COOKIE is set (see
// extractEngagementCounts) — reactions/comments show either way. Returns null
// when none of the three are available. Shared by buildEmbed's footer and
// buildProxyHtml's description (see facebookProxy.js), so both surfaces show
// the same counts.
function engagementLine(data) {
  const parts = [];
  if (data.reactions != null) parts.push(`❤️ ${humanFormat(data.reactions)}`);
  if (data.comments != null) parts.push(`💬 ${humanFormat(data.comments)}`);
  if (data.shares != null) parts.push(`🔁 ${humanFormat(data.shares)}`);
  return parts.length ? parts.join(' • ') : null;
}

/** Build Discord embed(s) from extracted post data. Extra photos (beyond the
 * first) ride along as bare image-only embeds sharing the same URL — Discord
 * groups same-URL embeds into one gallery grid, up to 4 images. */
function buildEmbed(data) {
  const siteName = data.siteName || 'Facebook';
  const dateLine = data.timestamp ? `${siteName} • ${formatUtc7(data.timestamp)} (UTC+7)` : siteName;

  const engagement = engagementLine(data);
  const footerText = engagement ? `${dateLine}\n${engagement}` : dateLine;

  const embed = new EmbedBuilder()
    .setColor(0x1877f2) // Facebook blue
    .setURL(data.url)
    .setFooter({ text: footerText });

  if (data.title) embed.setTitle(data.title.slice(0, 256));
  embed.setDescription((data.description || '[View on Facebook]').slice(0, 4096));

  // A video post's thumbnail would just duplicate what the video link's own
  // preview already shows (see buildReplyPayloads in linkConversion.js) — skip
  // the image(s) entirely when there's a video. Photo-only posts are unaffected.
  const images = data.video ? [] : data.images && data.images.length ? data.images : data.image ? [data.image] : [];
  if (images[0]) embed.setImage(images[0]);
  const galleryEmbeds = images.slice(1, 4).map((img) => new EmbedBuilder().setURL(data.url).setImage(img));

  return [embed, ...galleryEmbeds];
}

/** Opaque path segment for the video-proxy route (see facebookProxy.js). */
function encodeProxyPath(facebookUrl) {
  return Buffer.from(facebookUrl, 'utf8').toString('base64url');
}

function decodeProxyPath(segment) {
  return Buffer.from(segment, 'base64url').toString('utf8');
}

module.exports = {
  extractFacebookUrls,
  extractFacebookMatches,
  rewriteFacebookLinksForRepost,
  spoilerFixUrl,
  extractFacebookPost,
  buildEmbed,
  engagementLine,
  normalizeUrl,
  encodeProxyPath,
  decodeProxyPath,
};
