// Dispatches chat-input slash commands to the matching command's execute().

module.exports = async function interactionCreate(interaction, ctx) {
  if (!interaction.isChatInputCommand()) return;

  const command = ctx.commands.byName.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction, ctx);
  } catch (err) {
    console.error(`Error in /${interaction.commandName}:`, err);
    const reply = { content: '⚠️ Something went wrong running that command.', ephemeral: true };
    // Reply or follow-up depending on whether we already responded.
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply).catch(() => {});
    } else {
      await interaction.reply(reply).catch(() => {});
    }
  }
};
