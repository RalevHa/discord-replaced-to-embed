// Webhook repost: instead of the bot replying to a fixed link as itself, this
// deletes the original message and reposts it through a channel webhook set to
// the original author's display name and avatar — Discord webhooks can post
// under any supplied username/avatar, indistinguishable in the channel from a
// normal message. This is best-effort by design: any failure (missing Manage
// Webhooks permission, a rejected username, a transient API error) should be
// caught by the caller and fall back to a normal bot reply — see
// events/messageCreate.js and events/messageUpdate.js.
//
// Known, unavoidable limitations of a webhook-sent message:
//   - It can't carry reply/message_reference context, so if the original was
//     itself a reply to something, that context is lost.
//   - Any reactions already on the original are lost (it's a new message id).

// Webhooks belong to a channel, not a message — cached per channel so we don't
// refetch/recreate one on every repost. Self-healing: if the cached webhook was
// deleted out from under us, the next send fails and the entry is dropped so
// the following attempt creates a fresh one.
const webhookByChannel = new Map();

const WEBHOOK_NAME = 'Link Fixer Repost';

async function getOrCreateWebhook(channel) {
  const cached = webhookByChannel.get(channel.id);
  if (cached) return cached;

  // Cache the in-flight promise, not just the resolved webhook — otherwise two
  // messages processed concurrently in a channel with nothing cached yet could
  // both miss this check and both create their own webhook.
  const creating = (async () => {
    const webhooks = await channel.fetchWebhooks();
    const existing = webhooks.find((w) => w.owner?.id === channel.client.user.id);
    return existing || channel.createWebhook({ name: WEBHOOK_NAME });
  })();
  webhookByChannel.set(channel.id, creating);

  try {
    return await creating;
  } catch (err) {
    webhookByChannel.delete(channel.id);
    throw err;
  }
}

/**
 * Repost `message`'s content as the original author via webhook, then delete
 * the original. Throws on any failure before the original is touched — the
 * caller falls back to a normal reply in that case.
 * @param {import('discord.js').Message} message
 * @param {{ content: string, embeds: object[] }} payload
 * @param {import('./storage').Storage} storage
 * @returns {Promise<import('discord.js').Message>} the new webhook message
 */
async function repost(message, { content, embeds }, storage) {
  const channel = message.channel;
  // Webhooks belong to a text channel, not a thread — a thread's messages are
  // sent through its parent's webhook with `threadId` set.
  const webhookChannel = channel.isThread() ? channel.parent : channel;
  if (!webhookChannel) throw new Error('Webhook repost: thread parent channel is not cached.');

  let webhook;
  try {
    webhook = await getOrCreateWebhook(webhookChannel);
  } catch (err) {
    webhookByChannel.delete(webhookChannel.id);
    throw err;
  }

  const displayName = message.member?.displayName || message.author.username;
  const avatarURL = message.member?.displayAvatarURL() || message.author.displayAvatarURL();

  let sent;
  try {
    sent = await webhook.send({
      content,
      embeds,
      username: displayName,
      avatarURL,
      files: [...message.attachments.values()],
      allowedMentions: { parse: [] },
      threadId: channel.isThread() ? channel.id : undefined,
    });
  } catch (err) {
    // The cached webhook itself may be the problem (deleted externally,
    // permission revoked) — drop it so the next attempt creates a fresh one.
    webhookByChannel.delete(webhookChannel.id);
    throw err;
  }

  await storage.trackRepostAuthor(sent.id, message.author.id);

  try {
    await message.delete();
  } catch (err) {
    console.error('Webhook repost: failed to delete the original message:', err);
    // The repost already went out — fall back to at least suppressing the
    // original's own embed, same as the normal-reply path always does, so a
    // stray delete failure doesn't leave two live, doubly-embedded messages.
    await message.suppressEmbeds(true).catch(() => {});
  }

  return sent;
}

module.exports = { getOrCreateWebhook, repost };
