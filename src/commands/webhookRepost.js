const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { requireGuild } = require('./guards');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('webhook-repost')
    .setDescription(
      "Enable or disable reposting fixed links as the original author (via webhook) instead of a bot reply"
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction, { storage }) {
    if (!(await requireGuild(interaction))) return;

    const id = interaction.guild.id;
    const nowEnabled = storage.isWebhookRepostEnabled(id);
    await storage.setWebhookRepostEnabled(id, !nowEnabled);

    await interaction.reply({
      content: nowEnabled
        ? '⏸️ Webhook repost is now **disabled** — the bot will reply to fixed links as itself again.'
        : '✅ Webhook repost is now **enabled** — fixed links will be reposted as the original author ' +
          '(needs the **Manage Webhooks** permission in each channel; falls back to a normal reply ' +
          "if it's missing).",
      ephemeral: true,
    });
  },
};
