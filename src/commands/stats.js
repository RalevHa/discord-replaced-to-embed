const { SlashCommandBuilder } = require('discord.js');

// Turn a millisecond span into a compact "2d 3h 14m" string.
function formatElapsed(ms) {
  const seconds = Math.floor(ms / 1000);
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`].filter(Boolean).join(' ') || '<1m';
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Show how many links have been converted'),

  async execute(interaction, { storage }) {
    const { total, byLabel, since } = await storage.getStats();

    const elapsed = formatElapsed(Date.now() - since);
    const breakdown = Object.entries(byLabel)
      .map(([label, n]) => [label, Number(n)])
      .sort((a, b) => b[1] - a[1])
      .map(([label, n]) => `• **${label}**: ${n}`)
      .join('\n');

    const period = storage.persistent ? 'all time' : 'since last restart';
    await interaction.reply({
      content:
        `📊 **Conversion stats** (${period})\n` +
        `Tracking for: \`${elapsed}\`\n` +
        `Total links converted: \`${total}\`` +
        (breakdown ? `\n\n${breakdown}` : ''),
      ephemeral: true,
    });
  },
};
