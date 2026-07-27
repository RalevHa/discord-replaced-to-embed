const { SlashCommandBuilder } = require('discord.js');
const { formatElapsed } = require('../format');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Show how many links have been converted'),

  async execute(interaction, { storage }) {
    const { total, byLabel, since, spamCaught } = await storage.getStats();

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
        `Total links converted: \`${total}\`\n` +
        `Spam floods blocked: \`${spamCaught || 0}\`` +
        (breakdown ? `\n\n${breakdown}` : ''),
      ephemeral: true,
    });
  },
};
