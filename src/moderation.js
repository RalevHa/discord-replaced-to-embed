// Discord-side responses to a detected cross-channel flood: time the member out,
// delete the spam across channels, and alert moderators. Kept separate from the
// detection logic (spam.js) so that logic stays pure and testable.

const { PermissionFlagsBits, EmbedBuilder } = require('discord.js');

// Staff/trusted members and ignored channels are never actioned. Bots and DMs are
// already filtered out before this is reached.
function isExempt(member, channel, config) {
  if (!member) return true; // can't evaluate -> err on the side of not acting
  if (config.spamIgnoredChannelIds.includes(channel.id)) return true;
  if (member.id === member.guild.ownerId) return true;

  const p = member.permissions;
  if (
    p.has(PermissionFlagsBits.Administrator) ||
    p.has(PermissionFlagsBits.ManageGuild) ||
    p.has(PermissionFlagsBits.ModerateMembers)
  ) {
    return true;
  }

  if (config.spamTrustedRoleIds.some((id) => member.roles.cache.has(id))) return true;
  return false;
}

/**
 * Act on a confirmed flood.
 * @param {import('discord.js').Message} message  The latest offending message.
 * @param {{ channelCount: number, entries: Array<{channelId,messageId}> }} detection
 * @param {object} ctx  Shared context { client, config, storage, spam }.
 */
async function handleFlood(message, detection, ctx) {
  const { config, storage, client } = ctx;
  const member = message.member;
  const reason = `Cross-channel spam: same message in ${detection.channelCount} channels`;

  // Stop re-triggering on the rest of the burst.
  ctx.spam.clear(message.guild.id, message.author.id);

  // 1) Timeout the member (reversible). May fail if the bot lacks Moderate Members
  //    or sits below the member in the role hierarchy — log and continue.
  let timedOut = false;
  try {
    await member.timeout(config.spamTimeoutMs, reason);
    timedOut = true;
  } catch (err) {
    console.error('Spam: failed to timeout member:', err.message);
  }

  // 2) Delete the flagged messages, grouped by channel for one bulkDelete each.
  let deleted = 0;
  const byChannel = new Map();
  for (const entry of detection.entries) {
    if (!byChannel.has(entry.channelId)) byChannel.set(entry.channelId, []);
    byChannel.get(entry.channelId).push(entry.messageId);
  }
  for (const [channelId, ids] of byChannel) {
    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel || !channel.bulkDelete) continue;
      const result = await channel.bulkDelete(ids, true); // filterOld: skip >14d
      deleted += result.size;
    } catch (err) {
      console.error(`Spam: failed to delete messages in ${channelId}:`, err.message);
    }
  }

  // 3) Record the catch (fire-and-forget; never blocks).
  if (storage.recordSpamCatch) storage.recordSpamCatch();

  // 4) Alert moderators.
  console.log(
    `🚨 Spam handled: ${message.author.tag} (${message.author.id}) — ` +
      `${detection.channelCount} channels, ${deleted} messages deleted, ` +
      `timeout=${timedOut}`
  );
  await postModLog(message, { detection, deleted, timedOut, reason }, ctx);
}

async function postModLog(message, info, ctx) {
  const { config, client } = ctx;
  if (!config.modLogChannelId) return;
  try {
    const channel = await client.channels.fetch(config.modLogChannelId);
    if (!channel || !channel.send) return;

    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle('🚨 Cross-channel spam blocked')
      .setDescription(
        `**Member:** <@${message.author.id}> (\`${message.author.tag}\` · ${message.author.id})`
      )
      .addFields(
        {
          name: 'Action',
          value: info.timedOut
            ? `Timed out for ${Math.round(ctx.config.spamTimeoutMs / 60000)} min`
            : '⚠️ Timeout failed (check bot permissions / role order)',
          inline: true,
        },
        { name: 'Channels', value: String(info.detection.channelCount), inline: true },
        { name: 'Messages deleted', value: String(info.deleted), inline: true },
        { name: 'Reason', value: info.reason }
      )
      .setTimestamp(message.createdAt);

    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error('Spam: failed to post mod-log:', err.message);
  }
}

module.exports = { isExempt, handleFlood };
