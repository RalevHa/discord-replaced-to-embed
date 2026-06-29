// Auto-conversion: watch messages, rewrite supported links, and reply with the
// embeddable versions (suppressing the original's broken auto-embed).

const { applyReplacements, TRIGGER } = require('../rules');

module.exports = async function messageCreate(message, { config, storage }) {
  // Ignore bots and DMs.
  if (message.author.bot) return;
  if (!message.guild) return;
  if (config.allowedGuilds.length && !config.allowedGuilds.includes(message.guild.id)) return;
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
