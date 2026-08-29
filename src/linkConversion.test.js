const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildConversion, buildWebhookContent } = require('./linkConversion');

const baseConfig = { facebookEmbedEnabled: true };

// Spoilered Facebook links skip the network fetch entirely (see facebook.js),
// so these exercise buildConversion's newText/webhookSafeText handling without
// needing to mock a live request.

test('newText rewrites a RULES-matched link in place, preserving surrounding text', async () => {
  const { newText } = await buildConversion('check out https://x.com/user/status/123 !!', baseConfig);
  assert.equal(newText, 'check out https://fixupx.com/user/status/123 !!');
});

test('a raw Facebook link in newText is wrapped in <...> so it gets no second, broken embed', async () => {
  const { newText } = await buildConversion(
    'https://x.com/user/status/123 and ||https://www.facebook.com/user/posts/456||',
    baseConfig
  );
  assert.equal(
    newText,
    'https://fixupx.com/user/status/123 and ||<https://www.facebook.com/user/posts/456>||'
  );
});

test('Facebook links are left untouched when facebookEmbedEnabled is false', async () => {
  const { newText } = await buildConversion(
    'https://x.com/user/status/123 and ||https://www.facebook.com/user/posts/456||',
    { facebookEmbedEnabled: false }
  );
  assert.equal(newText, 'https://fixupx.com/user/status/123 and ||https://www.facebook.com/user/posts/456||');
});

test('buildWebhookContent joins the rewritten text with any Facebook video links', () => {
  assert.equal(
    buildWebhookContent('hello https://fixupx.com/a', ['https://cdn.example/video.mp4']),
    'hello https://fixupx.com/a\nhttps://cdn.example/video.mp4'
  );
  assert.equal(buildWebhookContent('hello https://fixupx.com/a', []), 'hello https://fixupx.com/a');
});

// A spoilered Facebook link gets routed to a public fixup host (facebed.seria.moe)
// instead of a raw passthrough of the same facebook.com URL, so Discord's own
// native unfurl handles it — which DOES inherit the spoiler, unlike a bot-built
// embed. The original raw URL still sits (suppressed) in newText; the fixup link
// is genuinely different content, not a duplicate of it.
test('a spoilered Facebook link is routed to a fixup host, not reposted raw', async () => {
  const input = '||https://www.facebook.com/ExtremeITReview/posts/pfbid026qBBNoXkxnq6rohhZFd4UNwhUE6JK9j7X64dCSxVV9xtjaWMkD58zE6yjrsU6RPil||';
  const { newText, facebookVideoLinks } = await buildConversion(input, baseConfig);
  assert.equal(
    newText,
    '||<https://www.facebook.com/ExtremeITReview/posts/pfbid026qBBNoXkxnq6rohhZFd4UNwhUE6JK9j7X64dCSxVV9xtjaWMkD58zE6yjrsU6RPil>||'
  );
  assert.deepEqual(facebookVideoLinks, [
    '||https://facebed.seria.moe/ExtremeITReview/posts/pfbid026qBBNoXkxnq6rohhZFd4UNwhUE6JK9j7X64dCSxVV9xtjaWMkD58zE6yjrsU6RPil||',
  ]);
  // Both lines present (suppressed original + live fixup) — not an exact duplicate.
  assert.equal(
    buildWebhookContent(newText, facebookVideoLinks),
    `${newText}\n${facebookVideoLinks[0]}`
  );
});
