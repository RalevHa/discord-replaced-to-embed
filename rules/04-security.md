# 04 · Security

- Prevent SQL injection.
- Validate input every time — on both the client and the server.
- Never hardcode passwords, API keys, or secrets — use `.env` / configuration.
- Always use parameterized queries.
- Check authorization on the server for every endpoint.
- Never expose secrets in code, logs, or docs; ensure `.gitignore` covers `.env` and `*.key`.

## Project specifics

- **Auth model:** Discord-side — slash-command permission gating via
  `PermissionFlagsBits.ManageGuild` (`/toggle`, `/roll-channel`, `/fixer`), no separate user
  database. Admin-panel side — single shared `ADMIN_PASSWORD` verified in `src/adminAuth.js`
  (bcrypt-hashed, session cookie signed with `SESSION_SECRET`, 15-minute IP lockout after 5
  failed attempts), with an optional WebAuthn passkey 2nd factor (`src/passkeyAuth.js`) once one
  is registered — see README's "Passkey login" section.
- **Secret storage:** `.env` file (gitignored) parsed via `--env-file=.env`; all reads go
  through `src/config.js`. Holds `DISCORD_BOT_TOKEN`, `UPSTASH_REDIS_REST_URL`/`TOKEN`,
  `ADMIN_PASSWORD`, `SESSION_SECRET`, `FACEBOOK_PROXY_BASE_URL`, etc. — see `.env.example` for
  the full list. No vault/cloud secret manager in use.
