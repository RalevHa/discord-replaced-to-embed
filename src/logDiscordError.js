// console.error truncates nested objects past depth 2, which hides the
// embeds array inside a discord.js HTTPError's requestBody — exactly the
// detail needed to diagnose a Discord API 500 caused by bad embed content.
// Logs at full depth instead.
const { inspect } = require('node:util');

function logDiscordError(prefix, err) {
  console.error(prefix, inspect(err, { depth: null }));
}

module.exports = { logDiscordError };
