// HTTP proxy so Discord's own link-unfurler can render a playable video for
// Facebook Reels/videos — a bot-sent embed can't carry playable video (Discord
// ignores the `video` field on bot/webhook embeds), but a URL Discord unfurls
// itself can, via the Twitter Player Card meta tags below.
//
// Only link-preview crawlers (Discord, Slack, Twitter, ...) see the synthetic
// page; a real visitor following the link is redirected straight to the
// original Facebook post. Wired into the health-check server in bot.js at
// GET /fb/<encoded-url> (see facebook.js's encodeProxyPath/decodeProxyPath).

const facebook = require('./facebook');

const CRAWLER_UA_PATTERN =
  /bot|facebookexternalhit|embed|crawler|spider|preview|slurp|whatsapp|telegram/i;

function isCrawler(userAgent) {
  return CRAWLER_UA_PATTERN.test(userAgent || '');
}

function escapeHtml(str) {
  return str.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

/** Build the synthetic OG/Twitter-Player HTML a crawler sees for a post. */
function buildProxyHtml(data, canonicalUrl) {
  const tags = [
    `<meta property="og:title" content="${escapeHtml(data.title || data.siteName || 'Facebook')}"/>`,
    data.description
      ? `<meta property="og:description" content="${escapeHtml(data.description)}"/>`
      : '',
    data.image ? `<meta property="og:image" content="${escapeHtml(data.image)}"/>` : '',
    `<meta property="og:url" content="${escapeHtml(canonicalUrl)}"/>`,
  ];

  if (data.video) {
    const video = escapeHtml(data.video);
    tags.push(
      '<meta name="twitter:card" content="player"/>',
      `<meta property="twitter:player:stream" content="${video}"/>`,
      `<meta property="og:video" content="${video}"/>`,
      `<meta property="og:video:secure_url" content="${video}"/>`,
      '<meta property="og:video:type" content="video/mp4"/>'
    );
  }

  return `<!DOCTYPE html><html><head>${tags.filter(Boolean).join('')}<meta http-equiv="refresh" content="0;url=${escapeHtml(canonicalUrl)}"/></head></html>`;
}

/**
 * Node http handler for GET /fb/<encoded-url>. Serves the synthetic embed page
 * to crawlers; redirects everyone else (and any extraction failure) straight
 * to the real Facebook post.
 */
async function handleProxyRequest(res, encodedPath, userAgent) {
  let facebookUrl;
  try {
    facebookUrl = facebook.decodeProxyPath(encodedPath);
    new URL(facebookUrl); // rejects garbage/undecodable segments — must be an absolute URL
  } catch {
    res.writeHead(400).end('bad request');
    return;
  }

  if (!isCrawler(userAgent)) {
    res.writeHead(302, { Location: facebookUrl }).end();
    return;
  }

  const data = await facebook.extractFacebookPost(facebookUrl);
  if (!data) {
    res.writeHead(302, { Location: facebookUrl }).end();
    return;
  }

  res
    .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    .end(buildProxyHtml(data, data.url || facebookUrl));
}

module.exports = { isCrawler, buildProxyHtml, handleProxyRequest };
