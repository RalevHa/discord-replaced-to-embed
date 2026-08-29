// Lets the original poster (or a moderator) react 🗑️ on the bot's conversion
// reply — or on a webhook repost — to delete it. For a normal reply this also
// restores the original message's native embed, the same cleanup
// messageDelete.js does when the source message itself is deleted, just
// triggered by a reaction instead. A webhook repost has no original message
// left to restore (see webhookRepost.js), so that case just deletes it.
// Both lookups are storage-backed (src/storage.js) so they survive a restart.

const { PermissionFlagsBits } = require('discord.js');
const replyTracker = require('../replyTracker');
const { DELETE_EMOJI } = require('../deleteReaction');

module.exports = async function messageReactionAdd(reaction, user, ctx) {
  if (user.bot) return;
  if (reaction.emoji.name !== DELETE_EMOJI) return;

  // Reactions on messages the bot didn't have cached arrive "partial" — the
  // rest of the payload (message content, emoji, etc.) needs a fetch first.
  try {
    if (reaction.partial) await reaction.fetch();
  } catch (err) {
    console.error('React-to-delete: failed to fetch partial reaction:', err);
    return;
  }

  const replyMessage = reaction.message;
  // replyTracker is in-memory only and empty after a restart; the bot's own
  // reply carries a Discord message reference that survives restarts and
  // points at the same original id. Gated to the bot's own messages only —
  // any reply-to-a-reply from a regular user also has a `.reference`, and
  // that must not be treated as one of the bot's tracked messages.
  const isBotReply = replyMessage.author?.id === ctx.client.user.id;
  const originalId =
    replyTracker.getOriginalId(replyMessage.id) || (isBotReply && replyMessage.reference?.messageId);

  if (originalId) {
    const original = await replyMessage.channel.messages.fetch(originalId).catch(() => null);

    const member = await replyMessage.guild?.members.fetch(user.id).catch(() => null);
    const isAuthor = original?.author.id === user.id;
    const isMod = Boolean(member?.permissions.has(PermissionFlagsBits.ManageMessages));
    if (!isAuthor && !isMod) return;

    replyTracker.delete(originalId);
    try {
      await replyMessage.delete();
      if (original) await original.suppressEmbeds(false);
    } catch (err) {
      console.error('React-to-delete: failed to delete reply / restore embed:', err);
    }
    return;
  }

  const repostAuthorId = ctx.storage.getRepostAuthorId(replyMessage.id);
  if (!repostAuthorId) return; // not one of the bot's tracked messages at all

  const member = await replyMessage.guild?.members.fetch(user.id).catch(() => null);
  const isAuthor = repostAuthorId === user.id;
  const isMod = Boolean(member?.permissions.has(PermissionFlagsBits.ManageMessages));
  if (!isAuthor && !isMod) return;

  await ctx.storage.untrackRepostAuthor(replyMessage.id);
  try {
    await replyMessage.delete();
    // Nothing to restore — the true original was already deleted at repost time.
  } catch (err) {
    console.error('React-to-delete: failed to delete webhook repost:', err);
  }
};
