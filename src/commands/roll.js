const { SlashCommandBuilder } = require('discord.js');
const { parseDice, rollDice } = require('../dice');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('roll')
    .setDescription('Roll dice, e.g. 1d100 or 2d6+3')
    .addStringOption((opt) =>
      opt.setName('dice').setDescription('Dice notation, e.g. 1d100 or 2d6+3').setRequired(true)
    ),

  async execute(interaction, { storage }) {
    if (!interaction.guild) {
      await interaction.reply({ content: 'This command only works in a server.', ephemeral: true });
      return;
    }

    if (!storage.isRollChannelAllowed(interaction.guild.id, interaction.channel.id)) {
      await interaction.reply({
        content:
          "🚫 Rolling isn't allowed in this channel. Ask an admin to run `/roll-channel add` " +
          'here, or check `/roll-channel list` for where it works.',
        ephemeral: true,
      });
      return;
    }

    const input = interaction.options.getString('dice', true);
    const spec = parseDice(input);
    if (!spec) {
      await interaction.reply({
        content: '⚠️ Invalid dice notation. Try something like `1d20` or `2d6+3`.',
        ephemeral: true,
      });
      return;
    }

    const { rolls, total } = rollDice(spec);
    const modifierPart = spec.modifier ? ` ${spec.modifier > 0 ? '+' : '-'} ${Math.abs(spec.modifier)}` : '';
    await interaction.reply(`🎲 **${input}** → [${rolls.join(', ')}]${modifierPart} = **${total}**`);
  },
};
