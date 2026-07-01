// Cross-channel flood detection — pure logic with no Discord dependency, so it can
// be unit-tested like rules.js. The textbook hijacked-account pattern is the SAME
// message blasted across many channels within a few seconds; we catch exactly that.

// Collapse a message into a comparison key: lowercase, trim, collapse whitespace.
// Returns '' for messages with no real text (e.g. attachment-only) so they're ignored.
function normalize(content) {
  return (content || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Track recent messages per (guild, user) and flag when the same text appears in
 * too many distinct channels inside a sliding time window.
 *
 * @param {object} opts
 * @param {number} opts.windowMs        How long a message stays "recent".
 * @param {number} opts.channelThreshold Distinct channels (same text) that trips the flag.
 * @param {() => number} [opts.now]     Clock injection point (tests pass a fake clock).
 */
function createFloodTracker({ windowMs, channelThreshold, now = () => Date.now() }) {
  // key "guildId:userId" -> array of { channelId, messageId, key, ts }
  const recent = new Map();

  return {
    /**
     * Record a message and report whether it completes a cross-channel flood.
     * `entries` are the matching {channelId, messageId} pairs (one per offending
     * message) so the caller can delete them grouped by channel.
     * @returns {{ flagged: boolean, entries?: Array<{channelId,messageId}>, channelCount?: number }}
     */
    record(guildId, userId, channelId, messageId, content) {
      const key = normalize(content);
      if (!key) return { flagged: false };

      const mapKey = `${guildId}:${userId}`;
      const ts = now();
      const cutoff = ts - windowMs;

      // Append, then drop anything outside the window.
      const entries = (recent.get(mapKey) || []).filter((e) => e.ts > cutoff);
      entries.push({ channelId, messageId, key, ts });
      recent.set(mapKey, entries);

      // Among entries with the SAME text, how many distinct channels?
      const sameText = entries.filter((e) => e.key === key);
      const channels = new Set(sameText.map((e) => e.channelId));

      if (channels.size >= channelThreshold) {
        return {
          flagged: true,
          entries: sameText.map((e) => ({ channelId: e.channelId, messageId: e.messageId })),
          channelCount: channels.size,
        };
      }
      return { flagged: false };
    },

    /** Forget a user's history (call after acting, so the rest of the burst is quiet). */
    clear(guildId, userId) {
      recent.delete(`${guildId}:${userId}`);
    },
  };
}

module.exports = { createFloodTracker, normalize };
