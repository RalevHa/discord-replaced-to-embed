// Persistence layer. Exposes one small interface regardless of backend:
//   - When Upstash env vars are present, state lives in Redis and survives restarts.
//   - Otherwise it falls back to in-memory state that resets on restart.
//
// The set of disabled guilds is always mirrored in an in-memory cache so the
// messageCreate hot path can check it synchronously without any network I/O.

const KEYS = {
  disabled: 'disabled_guilds', // Set of guild IDs
  total: 'stats:total', // integer counter
  byLabel: 'stats:by_label', // hash: label -> count
  since: 'stats:since', // ms timestamp, set once
  spamCaught: 'stats:spam_caught', // integer counter of flood incidents handled
  rollChannels: 'roll_channels', // hash: guild ID -> JSON array of allowed channel IDs
  passkeys: 'admin_passkeys', // hash: credential ID -> JSON WebAuthn credential record
  fixerOverrides: 'fixer_overrides', // hash: guild ID -> JSON { label: host }
  ignoredChannels: 'ignored_channels', // hash: guild ID -> JSON array of channel IDs to skip auto-conversion in
};

/**
 * @param {{ upstash: { url?: string, token?: string } }} config
 */
function createStorage(config) {
  let redis = null;
  if (config.upstash.url && config.upstash.token) {
    const { Redis } = require('@upstash/redis');
    redis = new Redis({ url: config.upstash.url, token: config.upstash.token });
    console.log('🗄️  Upstash Redis configured — state will persist across restarts.');
  } else {
    console.warn('⚠️  Upstash env vars not set — using in-memory state (resets on restart).');
  }

  // In-memory cache of disabled guilds (always used for fast reads).
  const disabledGuilds = new Set();
  // In-memory cache of allowed /roll channels: guild ID -> Set of channel IDs.
  const rollChannelsByGuild = new Map();
  // In-memory stats — the source of truth only when Redis is absent.
  const mem = { startedAt: Date.now(), total: 0, byLabel: {}, spamCaught: 0 };
  // In-memory cache of admin passkey credentials: credential ID -> record.
  // With no Redis configured these don't survive a restart, same as everything
  // else here — the admin panel's passkey UI already surfaces that tradeoff
  // via storage.persistent.
  const passkeysById = new Map();
  // In-memory cache of per-guild fixer-host overrides: guild ID -> { label: host }.
  const fixerOverridesByGuild = new Map();
  // In-memory cache of channels that skip auto-conversion: guild ID -> Set of channel IDs.
  const ignoredChannelsByGuild = new Map();

  return {
    /** Whether state will survive a restart. */
    persistent: Boolean(redis),

    /** Hydrate the in-memory cache from Redis. Call once on startup. */
    async init() {
      if (!redis) return;
      try {
        const members = await redis.smembers(KEYS.disabled);
        for (const id of members) disabledGuilds.add(id);

        // hgetall already JSON-decodes each hash value (the @upstash/redis client's
        // automatic deserialization) — channelIds is already the array addRollChannel
        // stored, not a JSON string to parse again. Re-parsing it here used to crash
        // (Array.prototype.toString collapses it to a bare digit string, and
        // JSON.parse of that yields a number, which isn't iterable) for every guild
        // with any roll channels configured, aborting this whole init() before it
        // even finished loading disabled guilds.
        const rollChannels = await redis.hgetall(KEYS.rollChannels);
        for (const [guildId, channelIds] of Object.entries(rollChannels || {})) {
          if (Array.isArray(channelIds)) {
            rollChannelsByGuild.set(guildId, new Set(channelIds));
          } else {
            console.error(`Skipping malformed roll-channels entry for guild ${guildId}:`, channelIds);
          }
        }

        // Same hgetall-already-deserializes caveat as rollChannels above.
        const passkeys = await redis.hgetall(KEYS.passkeys);
        for (const [id, record] of Object.entries(passkeys || {})) {
          if (record && typeof record === 'object') {
            passkeysById.set(id, record);
          } else {
            console.error(`Skipping malformed passkey entry ${id}:`, record);
          }
        }

        // Same hgetall-already-deserializes caveat as rollChannels above.
        const fixerOverrides = await redis.hgetall(KEYS.fixerOverrides);
        for (const [guildId, overrides] of Object.entries(fixerOverrides || {})) {
          if (overrides && typeof overrides === 'object') {
            fixerOverridesByGuild.set(guildId, overrides);
          } else {
            console.error(`Skipping malformed fixer-overrides entry for guild ${guildId}:`, overrides);
          }
        }

        // Same hgetall-already-deserializes caveat as rollChannels above.
        const ignoredChannels = await redis.hgetall(KEYS.ignoredChannels);
        for (const [guildId, channelIds] of Object.entries(ignoredChannels || {})) {
          if (Array.isArray(channelIds)) {
            ignoredChannelsByGuild.set(guildId, new Set(channelIds));
          } else {
            console.error(`Skipping malformed ignored-channels entry for guild ${guildId}:`, channelIds);
          }
        }

        // Stamp the tracking-start time once (first ever boot).
        await redis.set(KEYS.since, Date.now(), { nx: true });
        console.log(`Loaded ${disabledGuilds.size} disabled guild(s) from Redis.`);
      } catch (err) {
        console.error('Failed to load state from Redis:', err);
      }
    },

    /** Synchronous, cache-backed — safe to call on every message. */
    isGuildDisabled(id) {
      return disabledGuilds.has(id);
    },

    /** Persist toggle state and update the cache. */
    async setGuildDisabled(id, disabled) {
      if (disabled) disabledGuilds.add(id);
      else disabledGuilds.delete(id);
      if (!redis) return;
      if (disabled) await redis.sadd(KEYS.disabled, id);
      else await redis.srem(KEYS.disabled, id);
    },

    /** Synchronous, cache-backed — safe to call on every /roll. */
    isRollChannelAllowed(guildId, channelId) {
      return Boolean(rollChannelsByGuild.get(guildId)?.has(channelId));
    },

    /** Channel IDs currently allowed to roll in, for a guild (for /roll-channel list). */
    getRollChannels(guildId) {
      return [...(rollChannelsByGuild.get(guildId) || [])];
    },

    /** Add a channel to a guild's roll allowlist and persist it. */
    async addRollChannel(guildId, channelId) {
      let set = rollChannelsByGuild.get(guildId);
      if (!set) {
        set = new Set();
        rollChannelsByGuild.set(guildId, set);
      }
      set.add(channelId);
      if (!redis) return;
      await redis.hset(KEYS.rollChannels, { [guildId]: JSON.stringify([...set]) });
    },

    /** Remove a channel from a guild's roll allowlist and persist it. */
    async removeRollChannel(guildId, channelId) {
      const set = rollChannelsByGuild.get(guildId);
      if (!set) return;
      set.delete(channelId);
      if (!redis) return;
      if (set.size) await redis.hset(KEYS.rollChannels, { [guildId]: JSON.stringify([...set]) });
      else await redis.hdel(KEYS.rollChannels, guildId);
    },

    /** Synchronous, cache-backed — safe to call on every message. */
    isChannelIgnored(guildId, channelId) {
      return Boolean(ignoredChannelsByGuild.get(guildId)?.has(channelId));
    },

    /** Channel IDs currently skipping auto-conversion, for a guild (for /ignore-channel list). */
    getIgnoredChannels(guildId) {
      return [...(ignoredChannelsByGuild.get(guildId) || [])];
    },

    /** Add a channel to a guild's ignore list and persist it. */
    async addIgnoredChannel(guildId, channelId) {
      let set = ignoredChannelsByGuild.get(guildId);
      if (!set) {
        set = new Set();
        ignoredChannelsByGuild.set(guildId, set);
      }
      set.add(channelId);
      if (!redis) return;
      await redis.hset(KEYS.ignoredChannels, { [guildId]: JSON.stringify([...set]) });
    },

    /** Remove a channel from a guild's ignore list and persist it. */
    async removeIgnoredChannel(guildId, channelId) {
      const set = ignoredChannelsByGuild.get(guildId);
      if (!set) return;
      set.delete(channelId);
      if (!redis) return;
      if (set.size) await redis.hset(KEYS.ignoredChannels, { [guildId]: JSON.stringify([...set]) });
      else await redis.hdel(KEYS.ignoredChannels, guildId);
    },

    /** A guild's fixer-host overrides: { label: host }. Empty object if none set. */
    getFixerOverrides(guildId) {
      return fixerOverridesByGuild.get(guildId) || {};
    },

    /** Set one platform's fixer host for a guild and persist it. */
    async setFixerHost(guildId, label, host) {
      const overrides = { ...(fixerOverridesByGuild.get(guildId) || {}), [label]: host };
      fixerOverridesByGuild.set(guildId, overrides);
      if (!redis) return;
      await redis.hset(KEYS.fixerOverrides, { [guildId]: JSON.stringify(overrides) });
    },

    /** Clear one platform's override (revert to its default) and persist it. */
    async resetFixerHost(guildId, label) {
      const current = fixerOverridesByGuild.get(guildId);
      if (!current || !(label in current)) return;
      const rest = { ...current };
      delete rest[label];
      if (Object.keys(rest).length) fixerOverridesByGuild.set(guildId, rest);
      else fixerOverridesByGuild.delete(guildId);
      if (!redis) return;
      if (Object.keys(rest).length) await redis.hset(KEYS.fixerOverrides, { [guildId]: JSON.stringify(rest) });
      else await redis.hdel(KEYS.fixerOverrides, guildId);
    },

    /**
     * Record conversions. With Redis the increments are fire-and-forget so they
     * never block message handling; errors are logged, not thrown.
     * @param {Array<{ label: string }>} replaced
     */
    recordStats(replaced) {
      if (!redis) {
        mem.total += replaced.length;
        for (const r of replaced) mem.byLabel[r.label] = (mem.byLabel[r.label] || 0) + 1;
        return;
      }
      const pipe = redis.pipeline();
      pipe.incrby(KEYS.total, replaced.length);
      for (const r of replaced) pipe.hincrby(KEYS.byLabel, r.label, 1);
      pipe.exec().catch((err) => console.error('Failed to write stats to Redis:', err));
    },

    /**
     * Record one handled cross-channel spam incident. Fire-and-forget like recordStats.
     */
    recordSpamCatch() {
      if (!redis) {
        mem.spamCaught += 1;
        return;
      }
      redis
        .incr(KEYS.spamCaught)
        .catch((err) => console.error('Failed to write spam counter to Redis:', err));
    },

    /** Read aggregate stats for the /stats command. */
    async getStats() {
      if (!redis) {
        return {
          total: mem.total,
          byLabel: mem.byLabel,
          since: mem.startedAt,
          spamCaught: mem.spamCaught,
        };
      }
      const [total, byLabel, since, spamCaught] = await Promise.all([
        redis.get(KEYS.total),
        redis.hgetall(KEYS.byLabel),
        redis.get(KEYS.since),
        redis.get(KEYS.spamCaught),
      ]);
      return {
        total: Number(total) || 0,
        byLabel: byLabel || {},
        since: Number(since) || mem.startedAt,
        spamCaught: Number(spamCaught) || 0,
      };
    },

    /** Whether the admin has registered any passkeys — gates the 2nd login step. */
    hasPasskeys() {
      return passkeysById.size > 0;
    },

    /** Full internal record (includes the public key) — for verifying a login/registration. */
    getPasskey(id) {
      return passkeysById.get(id) || null;
    },

    /** Every credential's { id, transports } — for WebAuthn's allow/excludeCredentials lists. */
    listPasskeyDescriptors() {
      return [...passkeysById.values()].map((p) => ({ id: p.id, transports: p.transports }));
    },

    /** Display-safe list for the admin panel (no public key material). */
    listPasskeys() {
      return [...passkeysById.values()].map((p) => ({
        id: p.id,
        name: p.name,
        createdAt: p.createdAt,
        deviceType: p.deviceType,
        backedUp: p.backedUp,
      }));
    },

    /** Persist a newly-registered credential. */
    async addPasskey(record) {
      passkeysById.set(record.id, record);
      if (!redis) return;
      await redis.hset(KEYS.passkeys, { [record.id]: JSON.stringify(record) });
    },

    /** Bump a credential's signature counter after a successful login (replay-attack defense). */
    async updatePasskeyCounter(id, counter) {
      const record = passkeysById.get(id);
      if (!record) return;
      record.counter = counter;
      if (!redis) return;
      await redis.hset(KEYS.passkeys, { [id]: JSON.stringify(record) });
    },

    /** Remove a passkey (e.g. a lost/decommissioned device). */
    async removePasskey(id) {
      passkeysById.delete(id);
      if (!redis) return;
      await redis.hdel(KEYS.passkeys, id);
    },
  };
}

module.exports = { createStorage };
