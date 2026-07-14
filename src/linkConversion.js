// Shared link-conversion logic used by both messageCreate (new messages) and
// messageUpdate (edits), so the two stay in sync instead of drifting apart.

const { applyReplacements, TRIGGER, findSpoilerRanges } = require('./rules');
const facebook = require('./facebook');

// ponytail: Discord's own suppress-embeds edit can reach clients slower than a
// freshly-sent reply, so the reply can render before the original's embed is
// actually gone. A short pause after suppressEmbeds() lets that propagate first.
const SUPPRESS_PROPAGATION_DELAY_MS = 400;
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function buildConversion(content, config) {
  // Facebook links get a native embed (scraped OG data) instead of a text rewrite —
  // checked independently of TRIGGER since Facebook isn't in RULES.
  const facebookMatches = config.facebookEmbedEnabled
    ? facebook.extractFacebookMatches(content, findSpoilerRanges(content))
    : [];

  if (!TRIGGER.test(content) && facebookMatches.length === 0) {
    return { replaced: [], textLinks: [], facebookEmbeds: [] };
  }

  const { replaced } = TRIGGER.test(content) ? applyReplacements(content) : { replaced: [] };

  const facebookEmbeds = [];
  const facebookVideoLinks = [];
  // Cap per-message to avoid one message triggering a burst of outbound fetches.
  for (const { url, spoiler } of facebookMatches.slice(0, 4)) {
    if (spoiler) {
      // Spoilered like any other link (see rules.js) — skip the fetch/embed
      // entirely so nothing (image, description) leaks before it's revealed.
      facebookVideoLinks.push(`||${url}||`);
      replaced.push({ label: 'Facebook' });
      continue;
    }

    const data = await facebook.extractFacebookPost(url);
    if (data) {
      // Reels/videos: post a link Discord's own unfurler will play inline — a
      // bot-built embed can't carry playable video. Prefer our own proxy (stable
      // Twitter Player Card, works even if Facebook's CDN url is signed/expiring);
      // fall back to the raw CDN url when no proxy is configured.
      if (data.video) {
        facebookVideoLinks.push(
          config.facebookProxyBaseUrl
            ? `${config.facebookProxyBaseUrl}/fb/${facebook.encodeProxyPath(url)}`
            : data.video
        );
      } else {
        // Discord caps a message at 10 embeds total; multiple multi-photo posts
        // in one message could otherwise exceed that and get the reply rejected.
        const room = 10 - facebookEmbeds.length;
        if (room > 0) facebookEmbeds.push(...facebook.buildEmbed(data).slice(0, room));
      }
      replaced.push({ label: 'Facebook' });
    }
  }

  const textLinks = replaced
    .filter((r) => r.converted)
    .map((r) => r.converted)
    .concat(facebookVideoLinks);

  return { replaced, textLinks, facebookEmbeds };
}

/** Payload for a brand-new reply — omits empty keys since Discord rejects a
 * totally-empty message (content:'' with no embeds/attachments). */
function buildReplyPayload(textLinks, facebookEmbeds) {
  return {
    ...(textLinks.length ? { content: textLinks.join('\n') } : {}),
    ...(facebookEmbeds.length ? { embeds: facebookEmbeds } : {}),
    allowedMentions: { repliedUser: false },
  };
}

// Shared guard: skip bot messages, DMs, and guilds outside the allowlist.
// Used by both messageCreate and messageUpdate so the checks can't drift.
function isHandleableMessage(message, config) {
  if (message.author.bot) return false;
  if (!message.guild) return false;
  return !config.allowedGuilds.length || config.allowedGuilds.includes(message.guild.id);
}

module.exports = {
  buildConversion,
  buildReplyPayload,
  isHandleableMessage,
  delay,
  SUPPRESS_PROPAGATION_DELAY_MS,
};
