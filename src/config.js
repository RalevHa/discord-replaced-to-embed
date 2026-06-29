// All environment-variable reading lives here, so every other module takes a plain
// config object instead of touching process.env directly.

module.exports = Object.freeze({
  // Discord bot token (required to start).
  token: process.env.DISCORD_BOT_TOKEN,

  // Comma-separated server (guild) IDs the bot acts in. Empty = all servers.
  allowedGuilds: (process.env.ALLOWED_GUILD_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // Port for the health-check HTTP server (Render sets this automatically).
  port: process.env.PORT || 3000,

  // Upstash Redis REST credentials. If either is missing, storage falls back to
  // in-memory state that resets on restart.
  upstash: {
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  },
});
