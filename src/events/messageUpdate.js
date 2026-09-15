// Mirrors messageCreate's link conversion so editing a message's URL updates
// (or removes) the bot's existing reply instead of leaving it stale.

const {
  buildConversion,
  buildReplyPayloads,
  isHandleableMessage,
  delay,
  SUPPRESS_PROPAGATION_DELAY_MS,
} = require('../linkConversion');
const replyTracker = require('../replyTracker');
const webhookRepost = require('../webhookRepost');
const { DELETE_EMOJI } = require('../deleteReaction');

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
  if (storage.isChannelIgnored(message.guild.id, message.channel.id)) return;

  const existingReplyId = replyTracker.get(message.id);
  const existingReply = existingReplyId
    ? await message.channel.messages.fetch(existingReplyId).catch(() => null)
    : null;
  const { replaced, textLinks, facebookEmbeds, newText, facebookVideoLinks } = await buildConversion(
    message.content,
    config,
    storage.getFixerOverrides(message.guild.id)
  );

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

    if (existingReply) {
      // Syncing an already-converted message — always a normal reply edit.
      // Webhook mode only applies to first-time detection below: once a
      // message is webhook-reposted the original no longer exists, so there's
      // never a persisted original+reply pair left here to sync.
      await message.suppressEmbeds(true);
      // embeds/content must be passed explicitly (even empty) so edit() clears
      // whichever side no longer applies, rather than leaving stale content.
      // A single edited message can't be split into two the way a fresh reply
      // can (see buildReplyPayloads) — if the edit now needs both a video link
      // and an info embed, keep the video link on this one (so it still
      // auto-unfurls) and send the embed as a new follow-up reply instead.
      const needsSplit = facebookVideoLinks.length > 0 && facebookEmbeds.length > 0;
      await existingReply.edit({
        content: textLinks.length ? textLinks.join('\n') : '',
        embeds: needsSplit ? [] : facebookEmbeds,
      });
      if (needsSplit) {
        const extraReply = await message.reply({ embeds: facebookEmbeds, allowedMentions: { repliedUser: false } });
        await extraReply.react(DELETE_EMOJI).catch((err) => console.error('Failed to add delete reaction:', err));
      }
      return;
    }

    // Only a genuinely new reply/repost counts as a conversion — syncing an
    // existing one above is a no-op for stats, or every unrelated edit would
    // re-count it.
    storage.recordStats(replaced);

    if (storage.isWebhookRepostEnabled(message.guild.id)) {
      try {
        const repost = await webhookRepost.repost(
          message,
          { content: newText, embeds: facebookEmbeds, hasVideo: facebookVideoLinks.length > 0 },
          storage
        );
        await repost.react(DELETE_EMOJI).catch((err) => console.error('Failed to add delete reaction:', err));
        return;
      } catch (err) {
        console.error('Webhook repost failed, falling back to a normal reply:', err);
        // falls through to the normal suppress+reply path below
      }
    }

    await message.suppressEmbeds(true);
    await delay(SUPPRESS_PROPAGATION_DELAY_MS);
    const [firstPayload, ...morePayloads] = buildReplyPayloads(textLinks, facebookEmbeds, facebookVideoLinks);
    const reply = await message.reply(firstPayload);
    replyTracker.set(message.id, reply.id);
    await reply.react(DELETE_EMOJI).catch((err) => console.error('Failed to add delete reaction:', err));
    for (const payload of morePayloads) {
      const extraReply = await message.reply(payload);
      await extraReply.react(DELETE_EMOJI).catch((err) => console.error('Failed to add delete reaction:', err));
    }
  } catch (err) {
    console.error('Error processing message edit:', err);
  }
};
