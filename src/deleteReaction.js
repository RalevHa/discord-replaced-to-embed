// Single source of truth for the "react to delete" emoji, shared by whichever
// code creates a trackable message (messageCreate.js, messageUpdate.js,
// webhookRepost.js) and the code that reacts to it (messageReactionAdd.js).
module.exports = { DELETE_EMOJI: '🗑️' };
