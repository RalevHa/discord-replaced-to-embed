// Auto-conversion: watch messages, rewrite supported links, and reply with the
// embeddable versions (suppressing the original's broken auto-embed).

const { applyReplacements, TRIGGER } = require('../rules');
const { isExempt, handleFlood } = require('../moderation');

module.exports = async function messageCreate(message, ctx) {
  const { config, storage, spam } = ctx;

  // Ignore bots and DMs.
  if (message.author.bot) return;
  if (!message.guild) return;
  if (config.allowedGuilds.length && !config.allowedGuilds.includes(message.guild.id)) return;

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

  const content = message.content;

  // Quick early-exit: only process if a known domain is in the message.
  if (!TRIGGER.test(content)) return;

  const { replaced } = applyReplacements(content);
  if (replaced.length === 0) return;

  storage.recordStats(replaced);

  try {
    // Keep the original, just strip its auto-embed, then reply with the converted
    // links (which Discord auto-embeds). No ping on the reply.
    await message.suppressEmbeds(true);
    await message.reply({
      content: replaced.map((r) => r.converted).join('\n'),
      allowedMentions: { repliedUser: false },
    });
  } catch (err) {
    console.error('Error processing message:', err);
  }
};
