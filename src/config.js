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

  // Public base URL this bot's own HTTP server is reachable at (e.g. a
  // Cloudflare Tunnel hostname), used only for Facebook Reel/video links so
  // Discord's unfurler renders a playable video via facebookProxy.js. Empty =
  // fall back to posting the raw (often short-lived) Facebook CDN video URL.
  facebookProxyBaseUrl: (process.env.FACEBOOK_PROXY_BASE_URL || '').trim().replace(/\/$/, ''),

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

  // Optional: GitHub webhook secret for instant redeploy-on-push at
  // POST /deploy-webhook (see src/deployWebhook.js). Empty = route disabled
  // (returns 404), so nothing changes for deployments that don't set this.
  deployWebhookSecret: (process.env.DEPLOY_WEBHOOK_SECRET || '').trim(),
  // Branch a push must target to trigger a redeploy.
  deployBranch: process.env.DEPLOY_BRANCH || 'main',

  // Upstash Redis REST credentials. If either is missing, storage falls back to
  // in-memory state that resets on restart.
  upstash: {
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  },

  // Admin web panel (see src/adminApi.js), served at /admin. Empty password =
  // panel disabled entirely (404s), same "absent secret = feature off" pattern
  // as deployWebhookSecret above.
  adminPassword: (process.env.ADMIN_PASSWORD || '').trim(),
  // Signs the admin panel's session cookie. Required whenever adminPassword is set.
  sessionSecret: (process.env.SESSION_SECRET || '').trim(),
  // Name pm2 knows this process by (see scripts/auto-deploy.ps1's `pm2 restart`).
  // One place for it since the admin panel's process controls need it too.
  pm2ProcessName: (process.env.PM2_PROCESS_NAME || 'discord-bot').trim(),

  // Public origin the admin panel is reached at — needed for passkey (WebAuthn)
  // login: a passkey is bound to one exact origin/hostname at registration time
  // and the browser refuses to use it anywhere else, so this has to match the
  // address bar precisely, not just point at *a* working URL. Defaults to the
  // same tunnel hostname already configured for the Facebook proxy, since
  // that's normally the same public domain; set ADMIN_PUBLIC_URL explicitly
  // only if the admin panel is reached at a different host. Empty = passkey
  // routes are disabled (404), same "absent config = feature off" pattern as
  // adminPassword above.
  adminPublicUrl: (process.env.ADMIN_PUBLIC_URL || process.env.FACEBOOK_PROXY_BASE_URL || '')
    .trim()
    .replace(/\/$/, ''),
});
