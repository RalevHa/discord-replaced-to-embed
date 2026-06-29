const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createFloodTracker, normalize } = require('./spam');

// A fake clock we can advance manually, injected via the `now` option.
function fakeClock(start = 1000) {
  let t = start;
  return { now: () => t, advance: (ms) => (t += ms) };
}

const G = 'guild1';
const U = 'userA';

test('same text across 3 channels within window is flagged', () => {
  const tracker = createFloodTracker({ windowMs: 15000, channelThreshold: 3 });
  assert.equal(tracker.record(G, U, 'c1', 'm1', 'free nitro http://scam').flagged, false);
  assert.equal(tracker.record(G, U, 'c2', 'm2', 'free nitro http://scam').flagged, false);
  const hit = tracker.record(G, U, 'c3', 'm3', 'free nitro http://scam');
  assert.equal(hit.flagged, true);
  assert.equal(hit.channelCount, 3);
  assert.deepEqual(
    hit.entries.map((e) => e.messageId).sort(),
    ['m1', 'm2', 'm3']
  );
});

test('same text in only 2 channels is not flagged (under threshold)', () => {
  const tracker = createFloodTracker({ windowMs: 15000, channelThreshold: 3 });
  tracker.record(G, U, 'c1', 'm1', 'hello there');
  assert.equal(tracker.record(G, U, 'c2', 'm2', 'hello there').flagged, false);
});

test('repeats in the SAME channel do not count as cross-channel', () => {
  const tracker = createFloodTracker({ windowMs: 15000, channelThreshold: 3 });
  tracker.record(G, U, 'c1', 'm1', 'spam');
  tracker.record(G, U, 'c1', 'm2', 'spam');
  assert.equal(tracker.record(G, U, 'c1', 'm3', 'spam').flagged, false);
});

test('messages spread beyond the window are pruned and do not flag', () => {
  const clock = fakeClock();
  const tracker = createFloodTracker({ windowMs: 15000, channelThreshold: 3, now: clock.now });
  tracker.record(G, U, 'c1', 'm1', 'spam');
  clock.advance(10000);
  tracker.record(G, U, 'c2', 'm2', 'spam');
  clock.advance(10000); // m1 is now 20s old -> outside the 15s window
  assert.equal(tracker.record(G, U, 'c3', 'm3', 'spam').flagged, false);
});

test('different text across channels is not flagged', () => {
  const tracker = createFloodTracker({ windowMs: 15000, channelThreshold: 3 });
  tracker.record(G, U, 'c1', 'm1', 'message one');
  tracker.record(G, U, 'c2', 'm2', 'message two');
  assert.equal(tracker.record(G, U, 'c3', 'm3', 'message three').flagged, false);
});

test('whitespace/case variations still match as the same text', () => {
  const tracker = createFloodTracker({ windowMs: 15000, channelThreshold: 3 });
  tracker.record(G, U, 'c1', 'm1', 'Free   NITRO');
  tracker.record(G, U, 'c2', 'm2', 'free nitro');
  assert.equal(tracker.record(G, U, 'c3', 'm3', '  FREE nitro  ').flagged, true);
});

test('empty / whitespace-only content is ignored', () => {
  const tracker = createFloodTracker({ windowMs: 15000, channelThreshold: 1 });
  assert.equal(tracker.record(G, U, 'c1', 'm1', '   ').flagged, false);
  assert.equal(tracker.record(G, U, 'c2', 'm2', '').flagged, false);
  assert.equal(tracker.record(G, U, 'c3', 'm3', null).flagged, false);
});

test('different users are tracked independently', () => {
  const tracker = createFloodTracker({ windowMs: 15000, channelThreshold: 3 });
  tracker.record(G, 'userA', 'c1', 'm1', 'spam');
  tracker.record(G, 'userB', 'c2', 'm2', 'spam');
  assert.equal(tracker.record(G, 'userA', 'c3', 'm3', 'spam').flagged, false);
});

test('clear() forgets a user so the burst stops re-triggering', () => {
  const tracker = createFloodTracker({ windowMs: 15000, channelThreshold: 3 });
  tracker.record(G, U, 'c1', 'm1', 'spam');
  tracker.record(G, U, 'c2', 'm2', 'spam');
  assert.equal(tracker.record(G, U, 'c3', 'm3', 'spam').flagged, true);
  tracker.clear(G, U);
  // After clearing, a 4th channel alone is not enough to re-flag.
  assert.equal(tracker.record(G, U, 'c4', 'm4', 'spam').flagged, false);
});

test('normalize collapses whitespace and lowercases', () => {
  assert.equal(normalize('  Hello   World  '), 'hello world');
  assert.equal(normalize('\n\tA\nB\t'), 'a b');
  assert.equal(normalize(''), '');
});
