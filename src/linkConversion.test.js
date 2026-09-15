const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildConversion, buildReplyPayloads } = require('./linkConversion');

const baseConfig = { facebookEmbedEnabled: true };

// Spoilered Facebook links skip the network fetch entirely (see facebook.js),
// so these exercise buildConversion's newText/webhookSafeText handling without
// needing to mock a live request.

test('newText rewrites a RULES-matched link in place, preserving surrounding text', async () => {
  const { newText } = await buildConversion('check out https://x.com/user/status/123 !!', baseConfig);
  assert.equal(newText, 'check out https://fixupx.com/user/status/123 !!');
});

test('a non-spoilered Facebook link in newText is wrapped in <...> so it gets no second, broken embed', async () => {
  const { newText } = await buildConversion(
    'https://x.com/user/status/123 and https://www.facebook.com/user/posts/456',
    baseConfig
  );
  assert.equal(newText, 'https://fixupx.com/user/status/123 and <https://www.facebook.com/user/posts/456>');
});

test('a spoilered Facebook link in newText has its domain swapped to the fixup host in place, not wrapped in <...>', async () => {
  const { newText } = await buildConversion(
    'https://x.com/user/status/123 and ||https://www.facebook.com/user/posts/456||',
    baseConfig
  );
  assert.equal(
    newText,
    'https://fixupx.com/user/status/123 and ||https://facebed.seria.moe/user/posts/456||'
  );
});

test('Facebook links are left untouched when facebookEmbedEnabled is false', async () => {
  const { newText } = await buildConversion(
    'https://x.com/user/status/123 and ||https://www.facebook.com/user/posts/456||',
    { facebookEmbedEnabled: false }
  );
  assert.equal(newText, 'https://fixupx.com/user/status/123 and ||https://www.facebook.com/user/posts/456||');
});

// Regression test: a message that's ONLY a spoilered Facebook link must not
// print that link twice in webhook-repost content. The fixup swap happens in
// place inside newText, so webhook mode (which posts newText as-is) never
// needs to append a passthrough copy — that passthrough line is reply-mode-only,
// since a reply never resends the original text at all (see buildConversion).
test('a spoilered Facebook link with nothing else is not duplicated in webhook content', async () => {
  const input =
    '||https://www.facebook.com/ExtremeITReview/posts/pfbid026qBBNoXkxnq6rohhZFd4UNwhUE6JK9j7X64dCSxVV9xtjaWMkD58zE6yjrsU6RPil||';
  const { newText, textLinks } = await buildConversion(input, baseConfig);
  assert.equal(
    newText,
    '||https://facebed.seria.moe/ExtremeITReview/posts/pfbid026qBBNoXkxnq6rohhZFd4UNwhUE6JK9j7X64dCSxVV9xtjaWMkD58zE6yjrsU6RPil||'
  );
  assert.equal((newText.match(/pfbid026q/g) || []).length, 1);
  // A normal reply has no resent original text at all, so it still needs the
  // fixup link as its own content.
  assert.deepEqual(textLinks, [newText]);
});

// Regression test: a video/Reel post must not appear twice in webhook-repost
// content as both a suppressed <original> link and a separate proxy link line
// — the proxy link should replace the original in place (see
// rewriteFacebookLinksForRepost in facebook.js).
test('a non-spoilered video post link is replaced by its proxy link in place, not duplicated', async () => {
  const restore = mockFetchVideo();
  try {
    const input = 'https://fb.watch/JsAfNOk_Bs/';
    const { newText, facebookVideoLinks } = await buildConversion(input, {
      ...baseConfig,
      facebookProxyBaseUrl: 'https://fb.ralevisdev.com',
    });
    assert.equal(newText, facebookVideoLinks[0]);
    assert.equal((newText.match(/fb\.watch/g) || []).length, 0, 'original link must not remain in the text');
    assert.equal((newText.match(/fb\.ralevisdev\.com/g) || []).length, 1);
  } finally {
    restore();
  }
});

// Regression test: a video/Reel post used to post ONLY the raw video link,
// silently dropping the author/caption/reactions a bot-built embed carries —
// Discord's own unfurl of a bare video link shows the player but nothing else.
// Both should now go out together: the video link plays inline, the embed
// carries everything else.
test('a video post gets both its video link AND a bot-built embed with title/description', async () => {
  const restore = mockFetchVideo();
  try {
    const input = 'https://fb.watch/JsAfNOk_Bs/';
    const { facebookVideoLinks, facebookEmbeds } = await buildConversion(input, baseConfig);
    assert.equal(facebookVideoLinks.length, 1);
    assert.equal(facebookEmbeds.length, 1);
    assert.equal(facebookEmbeds[0].data.title, 'A Reel');
  } finally {
    restore();
  }
});

// Regression test for buildReplyPayloads: Discord only auto-unfurls a video
// link into an inline player when the message carrying it has no `embeds` of
// its own — combining both into one message silently drops the video (this is
// what broke right after the previous fix started attaching the info embed).
test('buildReplyPayloads splits a video link and an info embed into two messages, embed first', () => {
  const embed = { data: { title: 'A Reel' } };
  const payloads = buildReplyPayloads(['https://video.example/clip.mp4'], [embed], ['https://video.example/clip.mp4']);
  assert.equal(payloads.length, 2);
  assert.deepEqual(payloads[0].embeds, [embed]);
  assert.equal(payloads[0].content, undefined);
  assert.equal(payloads[1].content, 'https://video.example/clip.mp4');
  assert.equal(payloads[1].embeds, undefined);
});

test('buildReplyPayloads keeps a single message when there is no video (embed-only or text-only)', () => {
  const embed = { data: { title: 'A Photo Post' } };
  assert.equal(buildReplyPayloads([], [embed], []).length, 1);
  assert.equal(buildReplyPayloads(['https://fixupx.com/user/status/123'], [], []).length, 1);
});

function mockFetchVideo() {
  const original = global.fetch;
  global.fetch = async (url, opts) => {
    if (opts && opts.method === 'HEAD') {
      return { ok: true, headers: { get: () => 'video/mp4' } };
    }
    return {
      ok: true,
      text: async () =>
        '<html><head><meta property="og:title" content="A Reel"/><meta property="og:video:secure_url" content="https://video.example/clip.mp4"/></head></html>',
    };
  };
  return () => {
    global.fetch = original;
  };
}
