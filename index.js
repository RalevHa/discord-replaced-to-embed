// Entry point. Starts the bot only when run directly (`node index.js`), so the
// pure link logic in src/rules.js can be imported by tests without booting Discord.

if (require.main === module) {
  require('./src/bot').start();
}

// Re-exported so existing imports of `./index` (e.g. tests) keep working.
module.exports = require('./src/rules');
