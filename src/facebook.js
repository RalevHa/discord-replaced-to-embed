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

// Reels no longer expose an og:video meta tag — the page instead embeds this field
// (JSON-escaped, e.g. `"browser_native_hd_url":"https:\/\/lookaside.fbsbx.com\/..."`)
// pointing at a stable lookaside.fbsbx.com crawler-media URL that serves the actual
// video/mp4 file directly (unlike the DASH CDN URLs elsewhere in the page, which are
// split into separate video/audio streams and short-lived).
function extractBrowserNativeVideoUrl(html) {
  const m = /"browser_native_(?:hd|sd)_url":"([^"]+)"/.exec(html);
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

function decodeJsonEscapedString(escaped) {
  try {
    return JSON.parse(`"${escaped}"`);
  } catch {
    return escaped;
  }
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
 */
async function extractFacebookPost(url) {
  const key = normalizeUrl(url);
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.data;

  let data = null;
  try {
    const response = await fetch(key, {
      headers: {
        'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
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
        // Cap at 4 — Discord's own multi-image gallery grouping (see buildEmbed) tops out there.
        const allImages = images.length ? images.slice(0, 4) : fallback && fallback.image ? [fallback.image] : [];
        data = {
          title: tags['og:title'] || '',
          description: tags['og:description'] || (fallback && fallback.description) || '',
          image: allImages[0] || null,
          images: allImages,
          // Reels/videos expose a direct (usually short-lived, signed) file URL here.
          // Posted as plain text it lets Discord's own unfurler render a playable
          // video, which a bot-built embed can't do (see buildEmbed below). Reels no
          // longer set these og:video tags at all, so fall back to the browser_native
          // lookaside URL embedded in the page (see extractBrowserNativeVideoUrl).
          video:
            tags['og:video:secure_url'] ||
            tags['og:video:url'] ||
            tags['og:video'] ||
            extractBrowserNativeVideoUrl(html),
          siteName: tags['og:site_name'] || 'Facebook',
          url: tags['og:url'] || key,
          timestamp: extractPostTimestamp(html),
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
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Bangkok',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(ms);
}

/** Build Discord embed(s) from extracted post data. Extra photos (beyond the
 * first) ride along as bare image-only embeds sharing the same URL — Discord
 * groups same-URL embeds into one gallery grid, up to 4 images. */
function buildEmbed(data) {
  const siteName = data.siteName || 'Facebook';
  const footerText = data.timestamp ? `${siteName} • ${formatUtc7(data.timestamp)} (UTC+7)` : siteName;

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
