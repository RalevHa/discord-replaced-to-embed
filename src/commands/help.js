const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Explain what this bot does and how to use it'),

  // The command list is generated from the registry so it never drifts out of sync.
  async execute(interaction, { commands }) {
    const lines = commands.list
      .map((c) => `• \`/${c.data.name}\` — ${c.data.description}`)
      .join('\n');

    await interaction.reply({
      content:
        '👋 **Link Embed Bot**\n' +
        'I watch for social media links and repost them as embeddable versions so they ' +
        'preview properly in Discord.\n\n' +
        `**Commands**\n${lines}`,
      ephemeral: true,
    });
  },
};
