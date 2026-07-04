// Mirrors messageCreate's link conversion so editing a message's URL updates
// (or removes) the bot's existing reply instead of leaving it stale.

const { buildConversion, buildReplyPayload, isHandleableMessage } = require('../linkConversion');
const replyTracker = require('../replyTracker');

module.exports = async function messageUpdate(oldMessage, newMessage, ctx) {
  const { config, storage } = ctx;
  const message = newMessage;

  // Uncached (partial) messages don't carry enough info to re-run conversion —
  // skip rather than risk acting on stale/missing content.
  if (message.partial) return;
  // Discord fires this event for plenty of non-edits too — most commonly
  // attaching its own auto-generated embed to the message shortly after it's
  // sent, which doesn't touch the text at all. Reacting to those races the
  // slower conversions (e.g. Facebook's scrape) against messageCreate still
  // in flight and posts a duplicate reply. Only actual text edits should proceed.
  if (oldMessage.content === message.content) return;
  if (!isHandleableMessage(message, config)) return;
  if (storage.isGuildDisabled(message.guild.id)) return;

  const existingReplyId = replyTracker.get(message.id);
  const existingReply = existingReplyId
    ? await message.channel.messages.fetch(existingReplyId).catch(() => null)
    : null;
  const { replaced, textLinks, facebookEmbeds } = await buildConversion(message.content, config);

  try {
    if (replaced.length === 0) {
      // Links were edited away — drop the stale reply and restore the original
      // message's native embed, if we'd previously replied to it.
      if (!existingReplyId) return;
      replyTracker.delete(message.id);
      if (existingReply) await existingReply.delete();
      await message.suppressEmbeds(false);
      return;
    }

    await message.suppressEmbeds(true);

    if (existingReply) {
      // embeds/content must be passed explicitly (even empty) so edit() clears
      // whichever side no longer applies, rather than leaving stale content.
      await existingReply.edit({
        content: textLinks.length ? textLinks.join('\n') : '',
        embeds: facebookEmbeds,
      });
    } else {
      // Only a genuinely new reply counts as a conversion — syncing an existing
      // one above is a no-op for stats, or every unrelated edit would re-count it.
      storage.recordStats(replaced);
      const reply = await message.reply(buildReplyPayload(textLinks, facebookEmbeds));
      replyTracker.set(message.id, reply.id);
    }
  } catch (err) {
    console.error('Error processing message edit:', err);
  }
};
