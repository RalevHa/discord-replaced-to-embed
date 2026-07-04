// Deletes the bot's conversion reply when the original message is deleted,
// so it doesn't linger as an orphan.

const replyTracker = require('../replyTracker');

module.exports = async function messageDelete(message, ctx) {
  const replyId = replyTracker.get(message.id);
  if (!replyId) return;

  replyTracker.delete(message.id);
  try {
    const reply = await message.channel.messages.fetch(replyId).catch(() => null);
    if (reply) await reply.delete();
  } catch (err) {
    console.error('Error deleting reply after message delete:', err);
  }
};
