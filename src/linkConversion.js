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

async function buildConversion(content, config, overrides = {}) {
  // Facebook links get a native embed (scraped OG data) instead of a text rewrite —
  // checked independently of TRIGGER since Facebook isn't in RULES.
  const facebookMatches = config.facebookEmbedEnabled
    ? facebook.extractFacebookMatches(content, findSpoilerRanges(content))
    : [];

  if (!TRIGGER.test(content) && facebookMatches.length === 0) {
    return { replaced: [], textLinks: [], facebookEmbeds: [], newText: content, facebookVideoLinks: [] };
  }

  const { newText, replaced } = TRIGGER.test(content)
    ? applyReplacements(content, overrides)
    : { newText: content, replaced: [] };

  const facebookEmbeds = [];
  // Real, new-content links — a fixed spoiler redirect or a video/CDN URL,
  // never the raw original facebook.com URL — so appending these is always
  // safe in both reply and webhook-repost content: neither is already present
  // (verbatim) in newText, unlike a plain passthrough of the same link would be.
  const facebookVideoLinks = [];
  // Cap per-message to avoid one message triggering a burst of outbound fetches.
  for (const { url, spoiler } of facebookMatches.slice(0, 4)) {
    if (spoiler) {
      // Skip the OG-scrape/embed-build entirely — a bot-attached embed can't be
      // spoiler-blurred by Discord, so building it now would leak the
      // image/description before it's revealed. Route through a public fixup
      // host instead of the raw facebook.com URL so Discord's own native
      // unfurl handles it, which DOES inherit the spoiler — same "revealed on
      // click" experience every other platform already gets (see facebook.js).
      facebookVideoLinks.push(`||${facebook.spoilerFixUrl(url)}||`);
      replaced.push({ label: 'Facebook' });
      continue;
    }

    const data = await facebook.extractFacebookPost(url, {
      skipVideoVerification: config.facebookTrustUnverifiedVideo,
      cookie: config.facebookCookie,
    });
    if (data) {
      // Reels/videos: post a link Discord's own unfurler will play inline — a
      // bot-built embed can't carry playable video. Prefer our own proxy (stable
      // Twitter Player Card, works even if Facebook's CDN url is signed/expiring);
      // fall back to the raw CDN url when no proxy is configured. facebook.js
      // already verified data.video actually serves video before setting it.
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

  // newText (used only for webhook-repost content, see buildWebhookContent) is
  // the whole original message re-sent as fresh content — unlike a normal reply,
  // which never includes the original's surrounding text at all, so a raw
  // Facebook URL sitting in it would otherwise get a second, broken auto-embed
  // from Discord right alongside the real one built above.
  const webhookSafeText = facebookMatches.length ? facebook.suppressFacebookLinksInText(newText) : newText;

  return { replaced, textLinks, facebookEmbeds, newText: webhookSafeText, facebookVideoLinks };
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

/** Webhook-repost content: the *whole* original message with its link(s)
 * swapped in place (unlike buildReplyPayload's link-only content), plus any
 * Facebook video/spoiler-fixup links appended the same way a normal reply
 * would — safe in both, since neither is a passthrough of something already
 * sitting verbatim in newText (see buildConversion). */
function buildWebhookContent(newText, facebookVideoLinks) {
  return [newText, ...facebookVideoLinks].join('\n');
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
  buildWebhookContent,
  isHandleableMessage,
  delay,
  SUPPRESS_PROPAGATION_DELAY_MS,
};
