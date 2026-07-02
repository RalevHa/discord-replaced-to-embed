const { SlashCommandBuilder } = require('discord.js');
const { RULES } = require('../rules');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sources')
    .setDescription('List the platforms this bot can convert'),

  async execute(interaction, { config }) {
    const list = RULES.map(([label, domain]) => `• **${label}** — \`${domain}\``).join('\n');
    const fbLine = config.facebookEmbedEnabled
      ? '\n• **Facebook** — `facebook.com` (native embed, not a link rewrite)'
      : '';
    await interaction.reply({
      content: `I can convert links from these platforms into embeddable versions:\n${list}${fbLine}`,
      ephemeral: true,
    });
  },
};
