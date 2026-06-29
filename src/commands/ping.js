const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder().setName('ping').setDescription('Check the bot latency'),

  async execute(interaction, { client }) {
    const sent = await interaction.reply({ content: '🏓 Pinging...', fetchReply: true });
    const rtt = sent.createdTimestamp - interaction.createdTimestamp;
    await interaction.editReply(
      `🏓 Pong! Round-trip: \`${rtt}ms\` | WebSocket: \`${Math.round(client.ws.ping)}ms\``
    );
  },
};
