const { SlashCommandBuilder } = require('discord.js');
const { applyReplacements } = require('../rules');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('convert')
    .setDescription('Convert social media link(s) into embeddable versions')
    .addStringOption((opt) =>
      opt
        .setName('url')
        .setDescription('The link (or message) containing the URL(s) to convert')
        .setRequired(true)
    ),

  async execute(interaction, { storage }) {
    const input = interaction.options.getString('url', true);
    const { replaced } = applyReplacements(input);

    if (replaced.length === 0) {
      await interaction.reply({
        content: '⚠️ No convertible links found. Use `/sources` to see what I support.',
        ephemeral: true,
      });
      return;
    }

    storage.recordStats(replaced);
    await interaction.reply(replaced.map((r) => r.converted).join('\n'));
  },
};
