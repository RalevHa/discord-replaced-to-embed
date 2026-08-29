const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { FIXER_OPTIONS, isValidFixerHost } = require('../rules');
const { requireGuild } = require('./guards');

const CONFIGURABLE_PLATFORMS = Object.keys(FIXER_OPTIONS);
const platformChoices = CONFIGURABLE_PLATFORMS.map((label) => ({ name: label, value: label }));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('fixer')
    .setDescription('Choose which embed-fixing service converts a platform\'s links in this server')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('Set the fixer host used for a platform in this server')
        .addStringOption((opt) =>
          opt.setName('platform').setDescription('The platform to configure').setRequired(true).addChoices(...platformChoices)
        )
        .addStringOption((opt) =>
          opt.setName('host').setDescription("The fixer host to use — see /fixer list for options").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('reset')
        .setDescription('Revert a platform to its default fixer host')
        .addStringOption((opt) =>
          opt.setName('platform').setDescription('The platform to reset').setRequired(true).addChoices(...platformChoices)
        )
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('List configurable platforms and their fixer hosts')),

  async execute(interaction, { storage }) {
    if (!(await requireGuild(interaction))) return;

    const guildId = interaction.guild.id;
    const sub = interaction.options.getSubcommand();

    if (sub === 'set') {
      const platform = interaction.options.getString('platform', true);
      const host = interaction.options.getString('host', true);
      if (!isValidFixerHost(platform, host)) {
        await interaction.reply({
          content: `⚠️ \`${host}\` isn't a known fixer for **${platform}**. Options:\n${FIXER_OPTIONS[platform]
            .map((h) => `• \`${h}\``)
            .join('\n')}`,
          ephemeral: true,
        });
        return;
      }
      await storage.setFixerHost(guildId, platform, host);
      await interaction.reply({ content: `✅ **${platform}** links now convert to \`${host}\`.`, ephemeral: true });
      return;
    }

    if (sub === 'reset') {
      const platform = interaction.options.getString('platform', true);
      await storage.resetFixerHost(guildId, platform);
      await interaction.reply({
        content: `↩️ **${platform}** reverted to its default fixer (\`${FIXER_OPTIONS[platform][0]}\`).`,
        ephemeral: true,
      });
      return;
    }

    // list
    const overrides = storage.getFixerOverrides(guildId);
    const lines = CONFIGURABLE_PLATFORMS.map((label) => {
      const current = overrides[label] || FIXER_OPTIONS[label][0];
      const options = FIXER_OPTIONS[label].map((h) => (h === current ? `**${h}** (current)` : h)).join(', ');
      return `• **${label}**: ${options}`;
    }).join('\n');
    await interaction.reply({
      content: `Configurable platforms:\n${lines}\n\nUse \`/fixer set\` to change one.`,
      ephemeral: true,
    });
  },
};
