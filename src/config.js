// All environment-variable reading lives here, so every other module takes a plain
// config object instead of touching process.env directly.

// Parse a comma-separated env var into a clean array of IDs.
const idList = (v) =>
  (v || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

module.exports = Object.freeze({
  // Discord bot token (required to start).
  token: process.env.DISCORD_BOT_TOKEN,

  // Comma-separated server (guild) IDs the bot acts in. Empty = all servers.
  allowedGuilds: idList(process.env.ALLOWED_GUILD_IDS),

  // Port for the health-check HTTP server (Render sets this automatically).
  port: process.env.PORT || 3000,

  // Native Facebook post embeds (scraped Open Graph data, no self-hosted proxy
  // needed). Set to "false" to disable if Facebook starts blocking your IP.
  facebookEmbedEnabled: process.env.FACEBOOK_EMBED_ENABLED !== 'false',

  // --- Cross-channel spam (hijacked-account) detection ---
  // When one member posts the same text across spamChannelThreshold+ channels within
  // spamWindow seconds, the bot deletes those messages and times the member out.
  spamDetectionEnabled: process.env.SPAM_DETECTION_ENABLED !== 'false',
  spamChannelThreshold: Number(process.env.SPAM_CHANNEL_THRESHOLD) || 3,
  spamWindowMs: (Number(process.env.SPAM_WINDOW_SECONDS) || 15) * 1000,
  spamTimeoutMs: (Number(process.env.SPAM_TIMEOUT_MINUTES) || 10) * 60 * 1000,
  // Channel the bot posts moderation alerts to. Empty = no alert (console only).
  modLogChannelId: (process.env.MOD_LOG_CHANNEL_ID || '').trim(),
  // Roles/channels exempt from spam detection (e.g. trusted bots, announcement feeds).
  spamTrustedRoleIds: idList(process.env.SPAM_TRUSTED_ROLE_IDS),
  spamIgnoredChannelIds: idList(process.env.SPAM_IGNORED_CHANNEL_IDS),

  // Upstash Redis REST credentials. If either is missing, storage falls back to
  // in-memory state that resets on restart.
  upstash: {
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  },
});
