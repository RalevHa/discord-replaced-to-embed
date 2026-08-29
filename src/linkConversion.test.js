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
