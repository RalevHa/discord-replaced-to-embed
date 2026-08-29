// Shared guard for commands that only make sense inside a server (not DMs).
// Used by every guild-scoped command so the check/reply text can't drift.

async function requireGuild(interaction) {
  if (interaction.guild) return true;
  await interaction.reply({ content: 'This command only works in a server.', ephemeral: true });
  return false;
}

module.exports = { requireGuild };
