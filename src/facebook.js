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
function extractJsonObject(html, keyPattern) {
  const m = keyPattern.exec(html);
  if (!m) return null;
  const start = m.index + m[0].length - 1; // position of the opening "{"
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

// Facebook duplicates engagement counts across several GraphQL fragments in the same
// page, under different field names depending on whether the request is authenticated:
// - Anonymous/crawler fragment: `reaction_count`/`comment_rendering_instance`, paired
//   together — no share count is exposed to anonymous requests at all.
// - Logged-in fragment (only present with a `cookie`, see extractFacebookPost):
//   `unified_reactors` (inside the post's own "story" object, so reliably scoped) plus
//   `total_comment_count`/`share_count_reduced` elsewhere in the page, tied back to the
//   right post via the shared feedback id read out of "story".
// Both shapes repeat similar-looking blocks for *other* posts on the page (a suggested
// Reels tray, preloaded comments) — the pairing/id-matching below is what keeps this
// from picking up the wrong post's numbers.
function extractEngagementCounts(html) {
  const story = extractJsonObject(html, /"story":\{/);
  if (story) {
    const feedbackId = /"id":"(ZmVlZGJhY2s6[^"]+)","viewer_actor"/.exec(story);
    const reactions = /"unified_reactors":\{"count":(\d+)/.exec(story);
    if (feedbackId && reactions) {
      const shareMatch = new RegExp(
        `"total_comment_count":(\\d+),[\\s\\S]{0,200}?"id":"${escapeRegExp(feedbackId[1])}","share_count_reduced":"(\\d+)"`
      ).exec(html);
      return {
        reactions: Number(reactions[1]),
        comments: shareMatch ? Number(shareMatch[1]) : null,
        shares: shareMatch ? Number(shareMatch[2]) : null,
      };
    }
  }

  const anon =
    /"comment_rendering_instance":\{"comments":\{"total_count":(\d+)\}\}[\s\S]{0,300}?"reaction_count":\{"count":(\d+)/.exec(
      html
    );
  if (anon) return { reactions: Number(anon[2]), comments: Number(anon[1]), shares: null };

  return { reactions: null, comments: null, shares: null };
}

// Unlike an actual og:video: tag, the browser_native lookaside url is an
// undocumented endpoint that serves the real .mp4 for some posts and a 500
// error page for others, with nothing in the post's own metadata predicting
// which — so probe it with a HEAD request (cheap: no body download) before
// trusting it as playable, rather than finding out only when Discord's own
// unfurler tries and fails.
async function verifyVideoUrl(url) {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)' },
      signal: AbortSignal.timeout(VIDEO_VERIFY_TIMEOUT_MS),
    });
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
  const messageMatch = /"message":\{"text":"((?:[^"\\]|\\.)*)"/.exec(html);
  const imageMatch = /"image":\{"uri":"((?:[^"\\]|\\.)*)"/.exec(html);
  if (!messageMatch && !imageMatch) return null;
  return {
    description: messageMatch ? decodeJsonEscapedString(messageMatch[1]) : '',
    image: imageMatch ? decodeJsonEscapedString(imageMatch[1]) : null,
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
async function extractFacebookPost(url, { skipVideoVerification = false, cookie = '' } = {}) {
  const key = normalizeUrl(url);
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.data;

  let data = null;
  try {
    const response = await fetch(key, {
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
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (response.ok) {
      const html = await response.text();
      const { tags, images } = parseOgTags(html);
      const ogHasContent = tags['og:title'] || tags['og:description'] || images.length;
      const fallback = ogHasContent ? null : extractEmbeddedPostData(html);
      if ((ogHasContent || fallback) && !looksLikeLoginWall(tags)) {
        const albumImages = extractAlbumImages(html);
        const imageList = albumImages.length ? albumImages : images;
        // Cap at 4 — Discord's own multi-image gallery grouping (see buildEmbed) tops out there.
        const allImages = imageList.length ? imageList.slice(0, 4) : fallback && fallback.image ? [fallback.image] : [];
        // Reels/videos expose a direct (usually short-lived, signed) file URL here.
        // Posted as plain text it lets Discord's own unfurler render a playable
        // video, which a bot-built embed can't do (see buildEmbed below). Reels no
        // longer set these og:video tags at all, so fall back to the browser_native
        // lookaside URL embedded in the page (see extractBrowserNativeVideoUrl) —
        // verified before use since that fallback isn't reliable (see verifyVideoUrl).
        const taggedVideo = tags['og:video:secure_url'] || tags['og:video:url'] || tags['og:video'];
        const browserNativeVideo = taggedVideo ? null : extractBrowserNativeVideoUrl(html);
        const browserNativeVideoOk =
          browserNativeVideo && (skipVideoVerification || (await verifyVideoUrl(browserNativeVideo)));
        const video = taggedVideo || (browserNativeVideoOk ? browserNativeVideo : null);
        const engagement = extractEngagementCounts(html);
        data = {
          title: tags['og:title'] || '',
          description: tags['og:description'] || (fallback && fallback.description) || '',
          image: allImages[0] || null,
          images: allImages,
          video,
          siteName: tags['og:site_name'] || 'Facebook',
          url: tags['og:url'] || key,
          timestamp: extractPostTimestamp(html),
          reactions: engagement.reactions,
          comments: engagement.comments,
          shares: engagement.shares,
        };
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

/** Build Discord embed(s) from extracted post data. Extra photos (beyond the
 * first) ride along as bare image-only embeds sharing the same URL — Discord
 * groups same-URL embeds into one gallery grid, up to 4 images. */
function buildEmbed(data) {
  const siteName = data.siteName || 'Facebook';
  const dateLine = data.timestamp ? `${siteName} • ${formatUtc7(data.timestamp)} (UTC+7)` : siteName;

  // Shares are only ever available when FACEBOOK_COOKIE is set (see
  // extractEngagementCounts) — reactions/comments show either way.
  const engagementParts = [];
  if (data.reactions != null) engagementParts.push(`❤️ ${humanFormat(data.reactions)}`);
  if (data.comments != null) engagementParts.push(`💬 ${humanFormat(data.comments)}`);
  if (data.shares != null) engagementParts.push(`🔁 ${humanFormat(data.shares)}`);
  const footerText = engagementParts.length ? `${dateLine}\n${engagementParts.join(' • ')}` : dateLine;

  const embed = new EmbedBuilder()
    .setColor(0x1877f2) // Facebook blue
    .setURL(data.url)
    .setFooter({ text: footerText });

  if (data.title) embed.setTitle(data.title.slice(0, 256));
  embed.setDescription((data.description || '[View on Facebook]').slice(0, 4096));

  const images = data.images && data.images.length ? data.images : data.image ? [data.image] : [];
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
  extractFacebookPost,
  buildEmbed,
  normalizeUrl,
  encodeProxyPath,
  decodeProxyPath,
};
