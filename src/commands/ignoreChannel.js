const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { requireGuild } = require('./guards');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ignore-channel')
    .setDescription('Manage which channels skip automatic link conversion')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Skip automatic link conversion in a channel')
        .addChannelOption((opt) =>
          opt
            .setName('channel')
            .setDescription('The channel to ignore')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Resume automatic link conversion in a channel')
        .addChannelOption((opt) =>
          opt
            .setName('channel')
            .setDescription('The channel to stop ignoring')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('List channels that skip automatic conversion')),

  async execute(interaction, { storage }) {
    if (!(await requireGuild(interaction))) return;

    const guildId = interaction.guild.id;
    const sub = interaction.options.getSubcommand();

    if (sub === 'add') {
      const channel = interaction.options.getChannel('channel', true);
      await storage.addIgnoredChannel(guildId, channel.id);
      await interaction.reply({
        content: `🔇 Automatic link conversion is now skipped in <#${channel.id}>. \`/convert\` still works there.`,
        ephemeral: true,
      });
      return;
    }

    if (sub === 'remove') {
      const channel = interaction.options.getChannel('channel', true);
      await storage.removeIgnoredChannel(guildId, channel.id);
      await interaction.reply({ content: `🔊 Automatic link conversion resumed in <#${channel.id}>.`, ephemeral: true });
      return;
    }

    // list
    const channels = storage.getIgnoredChannels(guildId);
    await interaction.reply({
      content: channels.length
        ? `🔇 Automatic conversion is skipped in:\n${channels.map((id) => `• <#${id}>`).join('\n')}`
        : 'No channels are ignored — automatic conversion runs everywhere in this server.',
      ephemeral: true,
    });
  },
};
