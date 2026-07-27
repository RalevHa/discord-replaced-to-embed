const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('roll-channel')
    .setDescription('Manage which channels allow /roll')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Allow /roll in a channel')
        .addChannelOption((opt) =>
          opt
            .setName('channel')
            .setDescription('The channel to allow')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Disallow /roll in a channel')
        .addChannelOption((opt) =>
          opt
            .setName('channel')
            .setDescription('The channel to disallow')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('List channels /roll is allowed in')),

  async execute(interaction, { storage }) {
    if (!interaction.guild) {
      await interaction.reply({ content: 'This command only works in a server.', ephemeral: true });
      return;
    }

    const guildId = interaction.guild.id;
    const sub = interaction.options.getSubcommand();

    if (sub === 'add') {
      const channel = interaction.options.getChannel('channel', true);
      await storage.addRollChannel(guildId, channel.id);
      await interaction.reply({ content: `✅ \`/roll\` is now allowed in <#${channel.id}>.`, ephemeral: true });
      return;
    }

    if (sub === 'remove') {
      const channel = interaction.options.getChannel('channel', true);
      await storage.removeRollChannel(guildId, channel.id);
      await interaction.reply({ content: `⏸️ \`/roll\` is no longer allowed in <#${channel.id}>.`, ephemeral: true });
      return;
    }

    // list
    const channels = storage.getRollChannels(guildId);
    await interaction.reply({
      content: channels.length
        ? `📋 \`/roll\` is allowed in:\n${channels.map((id) => `• <#${id}>`).join('\n')}`
        : "No channels configured — `/roll` won't work anywhere until you run `/roll-channel add`.",
      ephemeral: true,
    });
  },
};
