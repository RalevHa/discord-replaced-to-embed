// Auto-conversion: watch messages, rewrite supported links, and reply with the
// embeddable versions (suppressing the original's broken auto-embed).

const { isExempt, handleFlood } = require('../moderation');
const {
  buildConversion,
  buildReplyPayload,
  buildWebhookContent,
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
      const repost = await webhookRepost.repost(message, {
        content: buildWebhookContent(newText, facebookVideoLinks),
        embeds: facebookEmbeds,
      });
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
    await message.suppressEmbeds(true);
    await delay(SUPPRESS_PROPAGATION_DELAY_MS);
    const reply = await message.reply(buildReplyPayload(textLinks, facebookEmbeds));
    replyTracker.set(message.id, reply.id);
    await reply.react(DELETE_EMOJI).catch((err) => console.error('Failed to add delete reaction:', err));
  } catch (err) {
    console.error('Error processing message:', err);
  }
};
