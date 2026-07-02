// Facebook-specific embedding. Unlike the other platforms in rules.js, Facebook has
// no reliable public "fixup" host to redirect to — so instead of rewriting the link,
// this module fetches the post itself (spoofing Facebook's own link-preview crawler
// user-agent, which gets a lighter-weight response than a real browser would) and
// builds a native Discord embed from the extracted Open Graph tags. No credentials,
// no headless browser, no external service required.

const { EmbedBuilder } = require('discord.js');

// Matches facebook.com / fb.watch / fb.com links, scheme and subdomains optional —
// same shape as the rules in rules.js. Kept separate from RULES since Facebook
// isn't a text rewrite, it's a native embed.
const FB_URL_PATTERN =
  /(?<![\w.@-])(?:https?:\/\/)?(?:[\w-]+\.)*?(?:facebook\.com|fb\.watch|fb\.com)\/[^\s<>"')\]]+/gi;

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

/** Find all Facebook links in a block of text (deduped, scheme normalized). */
function extractFacebookUrls(text) {
  const matches = text.match(FB_URL_PATTERN) || [];
  const urls = matches.map((m) => (/^https?:\/\//i.test(m) ? m : `https://${m}`));
  return [...new Set(urls)];
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

function parseOgTags(html) {
  const tags = {};
  const re1 = /<meta\s+(?:property|name)=["'](og:[^"']+)["']\s+content=["']([^"']*)["'][^>]*>/gi;
  let m;
  while ((m = re1.exec(html))) tags[m[1]] = decodeHtmlEntities(m[2]);
  const re2 = /<meta\s+content=["']([^"']*)["']\s+(?:property|name)=["'](og:[^"']+)["'][^>]*>/gi;
  while ((m = re2.exec(html))) tags[m[2]] = decodeHtmlEntities(m[1]);
  return tags;
}

function looksLikeLoginWall(tags) {
  const text = `${tags['og:title'] || ''} ${tags['og:description'] || ''}`.toLowerCase();
  return LOGIN_WALL_MARKERS.some((marker) => text.includes(marker));
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
      const tags = parseOgTags(await response.text());
      const hasContent = tags['og:title'] || tags['og:description'] || tags['og:image'];
      if (hasContent && !looksLikeLoginWall(tags)) {
        data = {
          title: tags['og:title'] || '',
          description: tags['og:description'] || '',
          image: tags['og:image'] || null,
          siteName: tags['og:site_name'] || 'Facebook',
          url: tags['og:url'] || key,
        };
      }
    }
  } catch (err) {
    console.error(`Facebook: extraction failed for ${url}:`, err.message);
  }

  cache.set(key, { data, expires: Date.now() + CACHE_TTL_MS });
  return data;
}

/** Build a Discord embed from extracted post data. */
function buildEmbed(data) {
  const embed = new EmbedBuilder()
    .setColor(0x1877f2) // Facebook blue
    .setURL(data.url)
    .setFooter({ text: data.siteName || 'Facebook' });

  if (data.title) embed.setTitle(data.title.slice(0, 256));
  embed.setDescription((data.description || '[View on Facebook]').slice(0, 4096));
  if (data.image) embed.setImage(data.image);

  return embed;
}

module.exports = { extractFacebookUrls, extractFacebookPost, buildEmbed, normalizeUrl };
