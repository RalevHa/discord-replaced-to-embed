// Maps an original message id to the id of the bot's conversion reply, so a
// later edit can update or remove that reply instead of posting a new one.
// In-memory only and lost on restart — an edit to a message sent before a
// restart just won't be tracked, which is an acceptable tradeoff.

module.exports = new Map();
