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
  // In-memory stats — the source of truth only when Redis is absent.
  const mem = { startedAt: Date.now(), total: 0, byLabel: {} };

  return {
    /** Whether state will survive a restart. */
    persistent: Boolean(redis),

    /** Hydrate the in-memory cache from Redis. Call once on startup. */
    async init() {
      if (!redis) return;
      try {
        const members = await redis.smembers(KEYS.disabled);
        for (const id of members) disabledGuilds.add(id);
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

    /** Read aggregate stats for the /stats command. */
    async getStats() {
      if (!redis) return { total: mem.total, byLabel: mem.byLabel, since: mem.startedAt };
      const [total, byLabel, since] = await Promise.all([
        redis.get(KEYS.total),
        redis.hgetall(KEYS.byLabel),
        redis.get(KEYS.since),
      ]);
      return {
        total: Number(total) || 0,
        byLabel: byLabel || {},
        since: Number(since) || mem.startedAt,
      };
    },
  };
}

module.exports = { createStorage };
