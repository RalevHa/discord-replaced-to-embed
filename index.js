const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// [label, domain, newHost] — matches https://(www.)domain/PATH, keeps PATH.
// Order matters: more specific subdomains (vt.tiktok.com) before their parent.
const RULES = [
  ['Facebook',          'facebook.com',  'facebed.com'],
  ['TikTok (vt short)', 'vt.tiktok.com', 'a.tnktok.com'],
  ['TikTok',            'tiktok.com',    'a.tnktok.com'],
  ['Bilibili',          'bilibili.com',  'www.vxbilibili.com'],
  ['X (Twitter)',       'x.com',         'fixupx.com'],
  ['Pixiv',             'pixiv.net',     'www.phixiv.net'],
];

const URL_RULES = RULES.map(([label, domain, newHost]) => {
  const esc = domain.replace(/\./g, '\\.');
  return {
    label,
    pattern: new RegExp(`https?://(?:www\\.)?${esc}/([^\\s]+)`, 'gi'),
    replace: (match, path) => `https://${newHost}/${path}`,
  };
});

// Early-exit trigger built from the same domains
const TRIGGER = new RegExp(RULES.map(([, d]) => d.replace(/\./g, '\\.')).join('|'), 'i');

/**
 * Applies all URL replacement rules to a given text.
 * Returns { newText, replaced: [{ label, original, converted }] }
 */
function applyReplacements(text) {
  let newText = text;
  const replaced = [];

  for (const rule of URL_RULES) {
    // Reset lastIndex for global regexes
    rule.pattern.lastIndex = 0;

    const matches = [...text.matchAll(rule.pattern)];
    for (const match of matches) {
      const original = match[0];
      const converted = match[0].replace(rule.pattern, rule.replace);
      rule.pattern.lastIndex = 0; // reset after single-match replace

      // Only record if the URL actually changed
      if (original !== converted) {
        replaced.push({ label: rule.label, original, converted });
      }
    }

    // Apply the replacement globally to newText
    rule.pattern.lastIndex = 0;
    newText = newText.replace(rule.pattern, rule.replace);
  }

  return { newText, replaced };
}

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// Only act in these server (guild) IDs. Comma-separated in env; empty = all servers.
const ALLOWED_GUILDS = (process.env.ALLOWED_GUILD_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

client.on('messageCreate', async (message) => {
  // Ignore bots and DMs
  if (message.author.bot) return;
  if (!message.guild) return;
  if (ALLOWED_GUILDS.length && !ALLOWED_GUILDS.includes(message.guild.id)) return;

  const content = message.content;

  // Quick early-exit: only process if a known domain is in the message
  if (!TRIGGER.test(content)) return;

  const { newText, replaced } = applyReplacements(content);

  // Nothing changed — skip
  if (replaced.length === 0) return;

  try {
    // Build an embed showing what was replaced
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setAuthor({
        name: message.author.displayName || message.author.username,
        iconURL: message.author.displayAvatarURL({ dynamic: true }),
      })
      .setDescription(newText)
      .setFooter({ text: '🔁 Links replaced for better media embeds' })
      .setTimestamp();

    // Add a field for each replaced URL (up to 5 to stay within embed limits)
    const shown = replaced.slice(0, 5);
    for (const r of shown) {
      embed.addFields({
        name: `${r.label}`,
        value: `~~${r.original}~~\n→ ${r.converted}`,
        inline: false,
      });
    }
    if (replaced.length > 5) {
      embed.addFields({
        name: `…and ${replaced.length - 5} more`,
        value: 'Additional links were also replaced.',
        inline: false,
      });
    }

    // Delete original message and repost via embed
    await message.delete();
    await message.channel.send({ embeds: [embed] });

  } catch (err) {
    console.error('Error processing message:', err);
  }
});

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error('❌  DISCORD_BOT_TOKEN environment variable is not set.');
  process.exit(1);
}

client.login(token);
