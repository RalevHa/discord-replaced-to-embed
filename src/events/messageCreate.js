// Auto-conversion: watch messages, rewrite supported links, and reply with the
// embeddable versions (suppressing the original's broken auto-embed).

const { isExempt, handleFlood } = require('../moderation');
const {
  buildConversion,
  buildReplyPayloads,
  isHandleableMessage,
  delay,
  SUPPRESS_PROPAGATION_DELAY_MS,
} = require('../linkConversion');
const replyTracker = require('../replyTracker');
const webhookRepost = require('../webhookRepost');
const { DELETE_EMOJI } = require('../deleteReaction');

module.exports = async function messageCreate(message, ctx) {
  const { config, storage, spam } = ctx;

  if (!isHandleableMessage(message, config)) return;

  // Cross-channel spam check runs on EVERY message (independent of link content), so
  // it sits before the link-conversion early-exits below.
  if (config.spamDetectionEnabled && !isExempt(message.member, message.channel, config)) {
    const detection = spam.record(
      message.guild.id,
      message.author.id,
      message.channel.id,
      message.id,
      message.content
    );
    if (detection.flagged) {
      try {
        await handleFlood(message, detection, ctx);
      } catch (err) {
        console.error('Spam: failed to handle flood:', err);
      }
      return; // don't also run link conversion on spam
    }
  }

  // Skip servers where an admin disabled auto-conversion via /toggle.
  if (storage.isGuildDisabled(message.guild.id)) return;
  // Skip channels an admin excluded via /ignore-channel — /convert still works there.
  if (storage.isChannelIgnored(message.guild.id, message.channel.id)) return;

  const { replaced, textLinks, facebookEmbeds, newText, facebookVideoLinks } = await buildConversion(
    message.content,
    config,
    storage.getFixerOverrides(message.guild.id)
  );
  if (replaced.length === 0) return;

  storage.recordStats(replaced);

  if (storage.isWebhookRepostEnabled(message.guild.id)) {
    try {
      const repost = await webhookRepost.repost(
        message,
        { content: newText, embeds: facebookEmbeds, hasVideo: facebookVideoLinks.length > 0 },
        storage
      );
      // Best-effort: a one-click delete affordance, not required for the
      // repost itself to have succeeded (needs the Add Reactions permission).
      await repost.react(DELETE_EMOJI).catch((err) => console.error('Failed to add delete reaction:', err));
      return;
    } catch (err) {
      console.error('Webhook repost failed, falling back to a normal reply:', err);
      // falls through to the normal suppress+reply path below
    }
  }

  try {
    // Keep the original, just strip its auto-embed, then reply with the converted
    // links (which Discord auto-embeds) and/or the native Facebook embeds. No ping.
    // A video link and an info embed go out as two separate replies — see
    // buildReplyPayloads — since Discord only auto-unfurls the video link into
    // an inline player when the message carrying it has no embeds of its own.
    await message.suppressEmbeds(true);
    await delay(SUPPRESS_PROPAGATION_DELAY_MS);
    const payloads = buildReplyPayloads(textLinks, facebookEmbeds, facebookVideoLinks);
    // Track the content-carrying reply specifically, not just whichever one
    // happens to go out first — buildReplyPayloads sends the info embed ahead
    // of the video link, but messageUpdate's edit-sync (and this file's own
    // suppress-embeds restore) key off the tracked reply as "the" converted
    // link, which only the content payload is.
    const trackedIndex = Math.max(
      payloads.findIndex((p) => p.content !== undefined),
      0
    );
    for (const [index, payload] of payloads.entries()) {
      const sentReply = await message.reply(payload);
      if (index === trackedIndex) replyTracker.set(message.id, sentReply.id);
      await sentReply.react(DELETE_EMOJI).catch((err) => console.error('Failed to add delete reaction:', err));
    }
  } catch (err) {
    console.error('Error processing message:', err);
  }
};
