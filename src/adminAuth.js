// Admin panel auth: session middleware, login/logout handlers, and a per-IP
// lockout so the login endpoint (reachable over the public tunnel URL) can't be
// brute-forced.

const crypto = require('crypto');
const session = require('express-session');

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

function timingSafeEqualStr(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

// Cloudflare overwrites this header at its edge, so unlike X-Forwarded-For a
// client can't spoof it to get a fresh lockout bucket per request.
function clientIp(req) {
  return req.headers['cf-connecting-ip'] || req.ip;
}

/**
 * Track failed logins per key (IP) and lock out after too many.
 * @param {object} [opts]
 * @param {number} [opts.maxAttempts]
 * @param {number} [opts.lockoutMs]
 * @param {() => number} [opts.now] Clock injection point (tests pass a fake clock).
 */
function createLoginLockout({ maxAttempts = MAX_ATTEMPTS, lockoutMs = LOCKOUT_MS, now = () => Date.now() } = {}) {
  const attempts = new Map(); // key -> { count, lockedUntil }

  return {
    isLocked(key) {
      const entry = attempts.get(key);
      return Boolean(entry && entry.lockedUntil > now());
    },
    recordFailure(key) {
      const entry = attempts.get(key) || { count: 0, lockedUntil: 0 };
      entry.count += 1;
      if (entry.count >= maxAttempts) entry.lockedUntil = now() + lockoutMs;
      attempts.set(key, entry);
    },
    clearFailures(key) {
      attempts.delete(key);
    },
  };
}

/**
 * @param {{ adminPassword: string, sessionSecret: string }} config
 * @param {{ hasPasskeys: () => boolean }} storage Whether a passkey is
 *   registered decides if a correct password alone logs you in (bootstrap —
 *   there's no 2nd factor to check yet) or only starts a 2nd, passkey step.
 */
function createAdminAuth(config, storage) {
  const lockout = createLoginLockout();

  const sessionMiddleware = session({
    secret: config.sessionSecret,
    name: 'admin_sid',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000,
    },
  });

  function requireAuth(req, res, next) {
    if (req.session?.authenticated) {
      next();
      return;
    }
    res.status(401).json({ error: 'Not logged in.' });
  }

  function handleLogin(req, res) {
    const ip = clientIp(req);
    if (lockout.isLocked(ip)) {
      res.status(429).json({ error: 'Too many failed attempts. Try again later.' });
      return;
    }

    const { password } = req.body || {};
    if (typeof password !== 'string' || !timingSafeEqualStr(password, config.adminPassword)) {
      lockout.recordFailure(ip);
      res.status(401).json({ error: 'Wrong password.' });
      return;
    }

    lockout.clearFailures(ip);
    if (storage.hasPasskeys()) {
      // 2nd factor required — passwordVerified alone does NOT satisfy requireAuth
      // below, only handleLoginVerify (src/passkeyAuth.js) setting authenticated does.
      req.session.authenticated = false;
      req.session.passwordVerified = true;
      res.json({ ok: true, requiresPasskey: true });
    } else {
      // No passkey registered yet — password is the only factor there is to
      // check, same as before this feature existed. This is also how you get
      // into the dashboard to register your first passkey.
      req.session.authenticated = true;
      res.json({ ok: true, requiresPasskey: false });
    }
  }

  function handleLogout(req, res) {
    req.session.destroy(() => res.json({ ok: true }));
  }

  function handleSession(req, res) {
    res.json({
      authenticated: Boolean(req.session?.authenticated),
      passwordVerified: Boolean(req.session?.passwordVerified),
    });
  }

  return { sessionMiddleware, requireAuth, handleLogin, handleLogout, handleSession };
}

module.exports = { createAdminAuth, createLoginLockout, timingSafeEqualStr, clientIp };
