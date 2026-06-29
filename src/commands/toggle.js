const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('toggle')
    .setDescription('Enable or disable automatic link conversion in this server')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction, { storage }) {
    // Guild-only (the command is hidden in DMs, but guard anyway).
    if (!interaction.guild) {
      await interaction.reply({ content: 'This command only works in a server.', ephemeral: true });
      return;
    }

    const id = interaction.guild.id;
    const nowEnabled = storage.isGuildDisabled(id); // if currently disabled, we're re-enabling
    await storage.setGuildDisabled(id, !nowEnabled);

    await interaction.reply({
      content: nowEnabled
        ? '✅ Automatic link conversion is now **enabled** in this server.'
        : '⏸️ Automatic link conversion is now **disabled**. Members can still use `/convert` manually.',
      ephemeral: true,
    });
  },
};
