// Auto-conversion: watch messages, rewrite supported links, and reply with the
// embeddable versions (suppressing the original's broken auto-embed).

const { isExempt, handleFlood } = require('../moderation');
const { buildConversion, buildReplyPayload, isHandleableMessage } = require('../linkConversion');
const replyTracker = require('../replyTracker');

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

  const { replaced, textLinks, facebookEmbeds } = await buildConversion(message.content, config);
  if (replaced.length === 0) return;

  storage.recordStats(replaced);

  try {
    // Keep the original, just strip its auto-embed, then reply with the converted
    // links (which Discord auto-embeds) and/or the native Facebook embeds. No ping.
    await message.suppressEmbeds(true);
    const reply = await message.reply(buildReplyPayload(textLinks, facebookEmbeds));
    replyTracker.set(message.id, reply.id);
  } catch (err) {
    console.error('Error processing message:', err);
  }
};
