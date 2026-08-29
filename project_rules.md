# project_rules.md — discord-link-replacer-bot

> Single source of truth for how the AI engineer works on this project.
> Read this first on every task (see `/project-os`). Keep it accurate; edit the `TODO`s.

## Project

- **Name:** discord-link-replacer-bot (repo directory: `embed-replace`)
- **Stack:** Node.js (CommonJS) — discord.js v14, Express 5, `@upstash/redis`, `express-session`,
  `cookie-parser`, `pm2`. Admin panel frontend: React 18 + Vite + `react-router-dom` +
  `@simplewebauthn/browser`. No relational database — persistence is Upstash Redis (REST API)
  behind `src/storage.js`, with an in-memory fallback when Upstash isn't configured.
- **Purpose:** A Discord bot that detects social-media links (TikTok, X/Twitter, Bilibili, Pixiv,
  Bluesky, Instagram, Reddit, FurAffinity, Iwara, Tumblr, Threads, PTT, DeviantArt, plus native
  Facebook embeds), suppresses their broken auto-embed, and replies with an embeddable rewrite —
  with per-guild fixer-host overrides, cross-channel spam detection, and a password-protected
  admin panel at `/admin`.
- **Entry points / how to run:** `npm start` (bot + HTTP server together, `--env-file=.env`).
  `npm run build:admin` builds the admin panel frontend (only needed if `ADMIN_PASSWORD`/
  `SESSION_SECRET` are set). See `README.md` for full setup/deploy instructions.
- **Test / lint command:** `npm test` (Node's built-in test runner, `node --test`). No separate
  lint step configured (no ESLint/Prettier config present) — match surrounding code style.

## Conventions

- **Naming:** camelCase for functions/variables, one module per concern under `src/`
  (`rules.js`, `storage.js`, `facebook.js`, …), Discord event handlers under `src/events/`,
  slash commands under `src/commands/` (each exports `{ data, execute }` and self-registers via
  `src/commands/index.js`'s `list`).
- **API contract / response format:** Admin panel REST API is `/admin/api/*`, JSON in/out,
  cookie-session auth (`src/adminAuth.js` + `src/adminApi.js`). Discord-facing contract is slash
  commands (`src/commands/*.js`) — must keep `data`/`execute` shape.
- **Branching / commits:** solo-maintained repo — `git log` shows direct commits to `main`,
  one logical change per commit, no PR/branch workflow in recent history. Commit messages are
  plain imperative subject lines describing the change (`Add X`, `Fix X`, `Show X`, `Remove X`)
  — **not** Conventional Commits type-prefixed (`feat:`, `fix:`); match that existing style
  rather than introducing prefixes.
- **Roles / permissions:** Discord side — guild-admin-only slash commands
  (`/toggle`, `/roll-channel`, `/fixer`) require `PermissionFlagsBits.ManageGuild`, set via
  `setDefaultMemberPermissions`. Admin-panel side — a single shared `ADMIN_PASSWORD` (bcrypt
  session cookie, `src/adminAuth.js`) gated by IP lockout after failed attempts, plus optional
  WebAuthn passkey 2nd factor (`src/passkeyAuth.js`) once one is registered. No per-user roles —
  it's a single shared admin identity, not multi-tenant auth.

## Iron rules

- Reuse existing code; prefer modification over duplication.
- Keep architecture consistent and modules independent; follow SOLID, DRY, KISS.
- Never hardcode secrets — use config/environment variables (`src/config.js` centralizes
  `process.env` reads; nothing else should reach into `process.env` directly).
- No relational DB in this project, so the "never `SELECT *`" / SQL-migration rules in
  `rules/06-database.md` don't apply as written — see that file's Project Specifics section.
  Redis reads/writes go through `src/storage.js` only.
- Do not break backward compatibility without explaining it (e.g. Discord slash command
  option/subcommand shapes, `/admin/api` routes the frontend depends on).
- Report outcomes faithfully — if tests fail or a step was skipped, say so.

## Knowledge structure

- `rules/` — cross-cutting rules in 6 categories (general, code-quality, error-handling, security, performance, database)
- `skills/` — reusable how-tos and gotchas discovered while working
- `agents/` — the specialist roles and when to use each
- `hooks/` — checklists to run BeforeTask / BeforeCommit / AfterTask / BeforeRelease / AfterRelease
