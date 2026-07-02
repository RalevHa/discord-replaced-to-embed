// Auto-conversion: watch messages, rewrite supported links, and reply with the
// embeddable versions (suppressing the original's broken auto-embed).

const { applyReplacements, TRIGGER } = require('../rules');
const { isExempt, handleFlood } = require('../moderation');
const facebook = require('../facebook');

module.exports = async function messageCreate(message, ctx) {
  const { config, storage, spam } = ctx;

  // Ignore bots and DMs.
  if (message.author.bot) return;
  if (!message.guild) return;
  if (config.allowedGuilds.length && !config.allowedGuilds.includes(message.guild.id)) return;

  // Cross-channel spam check runs on EVERY message (independent of link content), so
  // it sits before the link-conversion early-exits below.
  if (config.spamDetectionEnabled && !isExempt(message.member, message.channel, config)) {
    const detection = spam.record(
      message.guild.id,
      message.author.id,
      message.channel.id,
      message.id,
      message.content
    );
    if (detection.flagged) {
      try {
        await handleFlood(message, detection, ctx);
      } catch (err) {
        console.error('Spam: failed to handle flood:', err);
      }
      return; // don't also run link conversion on spam
    }
  }

  // Skip servers where an admin disabled auto-conversion via /toggle.
  if (storage.isGuildDisabled(message.guild.id)) return;

  const content = message.content;

  // Facebook links get a native embed (scraped OG data) instead of a text rewrite —
  // checked independently of TRIGGER since Facebook isn't in RULES.
  const facebookUrls = config.facebookEmbedEnabled ? facebook.extractFacebookUrls(content) : [];

  // Quick early-exit: bail unless there's a known domain OR a Facebook link.
  if (!TRIGGER.test(content) && facebookUrls.length === 0) return;

  const { replaced } = TRIGGER.test(content) ? applyReplacements(content) : { replaced: [] };

  const facebookEmbeds = [];
  // Cap per-message to avoid one message triggering a burst of outbound fetches.
  for (const url of facebookUrls.slice(0, 4)) {
    const data = await facebook.extractFacebookPost(url);
    if (data) {
      facebookEmbeds.push(facebook.buildEmbed(data));
      replaced.push({ label: 'Facebook' });
    }
  }

  if (replaced.length === 0) return;

  storage.recordStats(replaced);

  try {
    // Keep the original, just strip its auto-embed, then reply with the converted
    // links (which Discord auto-embeds) and/or the native Facebook embeds. No ping.
    await message.suppressEmbeds(true);
    const textLinks = replaced.filter((r) => r.converted).map((r) => r.converted);
    await message.reply({
      ...(textLinks.length ? { content: textLinks.join('\n') } : {}),
      ...(facebookEmbeds.length ? { embeds: facebookEmbeds } : {}),
      allowedMentions: { repliedUser: false },
    });
  } catch (err) {
    console.error('Error processing message:', err);
  }
};
