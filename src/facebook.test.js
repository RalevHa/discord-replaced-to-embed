const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  extractFacebookUrls,
  normalizeUrl,
  extractFacebookPost,
  buildEmbed,
  encodeProxyPath,
  decodeProxyPath,
} = require('./facebook');

test('extractFacebookUrls finds bare and scheme-prefixed links', () => {
  assert.deepEqual(extractFacebookUrls('check facebook.com/user/posts/123'), [
    'https://facebook.com/user/posts/123',
  ]);
  assert.deepEqual(extractFacebookUrls('see https://www.facebook.com/user/posts/123'), [
    'https://www.facebook.com/user/posts/123',
  ]);
});

test('extractFacebookUrls matches subdomains (m., web.) and fb.watch', () => {
  assert.deepEqual(extractFacebookUrls('https://m.facebook.com/watch/?v=123'), [
    'https://m.facebook.com/watch/?v=123',
  ]);
  assert.deepEqual(extractFacebookUrls('https://fb.watch/abc123/'), ['https://fb.watch/abc123/']);
});

test('extractFacebookUrls ignores lookalike domains', () => {
  assert.deepEqual(extractFacebookUrls('notfacebook.com/x and facebooky.com/y'), []);
});

test('extractFacebookUrls dedupes repeated links', () => {
  const text = 'facebook.com/a/1 again facebook.com/a/1';
  assert.deepEqual(extractFacebookUrls(text), ['https://facebook.com/a/1']);
});

test('extractFacebookUrls finds multiple distinct links in one message', () => {
  const text = 'facebook.com/a/1 and https://m.facebook.com/b/2';
  assert.deepEqual(extractFacebookUrls(text), [
    'https://facebook.com/a/1',
    'https://m.facebook.com/b/2',
  ]);
});

test('normalizeUrl strips tracking params', () => {
  assert.equal(
    normalizeUrl('https://www.facebook.com/user/posts/123?mibextid=abc&fbclid=xyz&ref=share'),
    'https://www.facebook.com/user/posts/123'
  );
});

test('normalizeUrl returns input unchanged if not a valid URL', () => {
  assert.equal(normalizeUrl('not a url'), 'not a url');
});

// extractFacebookPost caches by normalized URL, so each test needs its own unique
// URL — Date.now() alone isn't enough since tests can share a millisecond.
let uniqueCounter = 0;
function uniquePostUrl(path = 'user/posts') {
  uniqueCounter += 1;
  return `https://www.facebook.com/${path}/${uniqueCounter}`;
}

// extractFacebookPost hits the network, so these tests stub global.fetch. facebook.js
// calls `fetch` at invocation time (not captured at require time), so overriding it
// here takes effect immediately.
function mockFetch(html, { ok = true } = {}) {
  const original = global.fetch;
  global.fetch = async () => ({ ok, text: async () => html });
  return () => {
    global.fetch = original;
  };
}

test('extractFacebookPost parses og:title/description/image', async () => {
  const restore = mockFetch(`
    <html><head>
      <meta property="og:title" content="Cool Post" />
      <meta property="og:description" content="A description" />
      <meta property="og:image" content="https://scontent.example/img.jpg" />
      <meta property="og:site_name" content="Facebook" />
    </head></html>
  `);
  try {
    const data = await extractFacebookPost(uniquePostUrl());
    assert.equal(data.title, 'Cool Post');
    assert.equal(data.description, 'A description');
    assert.equal(data.image, 'https://scontent.example/img.jpg');
  } finally {
    restore();
  }
});

test('extractFacebookPost captures a Reel/video URL from og:video:secure_url', async () => {
  const restore = mockFetch(`
    <html><head>
      <meta property="og:title" content="A Reel" />
      <meta property="og:image" content="https://scontent.example/thumb.jpg" />
      <meta property="og:video:secure_url" content="https://video.example/clip.mp4" />
    </head></html>
  `);
  try {
    const data = await extractFacebookPost(uniquePostUrl('reel'));
    assert.equal(data.video, 'https://video.example/clip.mp4');
  } finally {
    restore();
  }
});

test('extractFacebookPost leaves video null when no og:video tag is present', async () => {
  const restore = mockFetch(`
    <html><head>
      <meta property="og:title" content="Cool Post" />
    </head></html>
  `);
  try {
    const data = await extractFacebookPost(uniquePostUrl());
    assert.equal(data.video, null);
  } finally {
    restore();
  }
});

test('extractFacebookPost returns null for a login-wall page', async () => {
  const restore = mockFetch(`
    <html><head>
      <meta property="og:title" content="Facebook" />
      <meta property="og:description" content="Log in or sign up to view this content." />
    </head></html>
  `);
  try {
    const data = await extractFacebookPost(uniquePostUrl());
    assert.equal(data, null);
  } finally {
    restore();
  }
});

test('extractFacebookPost returns null on a non-ok response', async () => {
  const restore = mockFetch('', { ok: false });
  try {
    const data = await extractFacebookPost(uniquePostUrl());
    assert.equal(data, null);
  } finally {
    restore();
  }
});

test('extractFacebookPost caches results per normalized URL', async () => {
  let calls = 0;
  const original = global.fetch;
  global.fetch = async () => {
    calls += 1;
    return { ok: true, text: async () => '<meta property="og:title" content="Cached Post" />' };
  };
  try {
    const url = uniquePostUrl('cache-test');
    const first = await extractFacebookPost(url);
    const second = await extractFacebookPost(`${url}?fbclid=abc`); // normalizes to same key
    assert.equal(first.title, 'Cached Post');
    assert.equal(second.title, 'Cached Post');
    assert.equal(calls, 1, 'second call should be served from cache, not re-fetch');
  } finally {
    global.fetch = original;
  }
});

test('encodeProxyPath/decodeProxyPath round-trip a Facebook URL', () => {
  const url = 'https://www.facebook.com/reel/123456789?fbclid=abc';
  assert.equal(decodeProxyPath(encodeProxyPath(url)), url);
});

test('encodeProxyPath produces a URL-safe path segment', () => {
  const encoded = encodeProxyPath('https://www.facebook.com/reel/123?a=1&b=2');
  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
});

test('buildEmbed falls back to a generic description when none was extracted', () => {
  const embed = buildEmbed({ title: '', description: '', image: null, siteName: 'Facebook', url: 'https://facebook.com/x' });
  const json = embed.toJSON();
  assert.equal(json.description, '[View on Facebook]');
  assert.equal(json.color, 0x1877f2);
});
