// Tracks the original message id <-> the id of the bot's conversion reply, so
// a later edit/delete/reaction can find either message from the other's id.
// In-memory only and lost on restart — a message sent before a restart just
// won't be tracked, which is an acceptable tradeoff (see storage.js for what
// IS persisted).

const replyIdByOriginal = new Map();
const originalIdByReply = new Map();

module.exports = {
  set(originalId, replyId) {
    replyIdByOriginal.set(originalId, replyId);
    originalIdByReply.set(replyId, originalId);
  },

  get(originalId) {
    return replyIdByOriginal.get(originalId);
  },

  /** The original message id for one of the bot's own reply ids, if tracked. */
  getOriginalId(replyId) {
    return originalIdByReply.get(replyId);
  },

  delete(originalId) {
    const replyId = replyIdByOriginal.get(originalId);
    replyIdByOriginal.delete(originalId);
    if (replyId) originalIdByReply.delete(replyId);
  },
};
