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
    assert.deepEqual(data.images, ['https://scontent.example/img.jpg']);
  } finally {
    restore();
  }
});

test('extractFacebookPost collects every og:image tag for a multi-photo post', async () => {
  const restore = mockFetch(`
    <html><head>
      <meta property="og:title" content="Album" />
      <meta property="og:image" content="https://scontent.example/1.jpg" />
      <meta property="og:image" content="https://scontent.example/2.jpg" />
      <meta property="og:image" content="https://scontent.example/3.jpg" />
    </head></html>
  `);
  try {
    const data = await extractFacebookPost(uniquePostUrl());
    assert.equal(data.image, 'https://scontent.example/1.jpg');
    assert.deepEqual(data.images, [
      'https://scontent.example/1.jpg',
      'https://scontent.example/2.jpg',
      'https://scontent.example/3.jpg',
    ]);
  } finally {
    restore();
  }
});

test('extractFacebookPost captures the post date from the embedded story JSON', async () => {
  const restore = mockFetch(`
    <html><head>
      <meta property="og:title" content="Mark Zuckerberg" />
      <meta property="og:description" content="Every year I take on a personal challenge" />
    </head></html>
    <script>{"post_id":"10102577175875681","story":{"creation_time":1451861194,"unpublished_content_type":"PUBLISHED"}}</script>
  `);
  try {
    const data = await extractFacebookPost(uniquePostUrl());
    assert.equal(data.timestamp, 1451861194 * 1000);
  } finally {
    restore();
  }
});

test('extractFacebookPost leaves timestamp null when no story JSON is present', async () => {
  const restore = mockFetch(`
    <html><head>
      <meta property="og:title" content="Cool Post" />
      <meta property="og:description" content="A description" />
    </head></html>
  `);
  try {
    const data = await extractFacebookPost(uniquePostUrl());
    assert.equal(data.timestamp, null);
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

test('extractFacebookPost falls back to browser_native_hd_url when no og:video tag is present (Reels)', async () => {
  const restore = mockFetch(`
    <html><head>
      <meta property="og:type" content="video.other" />
      <meta property="og:title" content="A Reel" />
      <meta property="og:image" content="https://scontent.example/thumb.jpg" />
    </head>
    <script>{"browser_native_hd_url":"https:\\/\\/lookaside.fbsbx.com\\/lookaside\\/crawler\\/media\\/?media_id=123","browser_native_sd_url":"https:\\/\\/lookaside.fbsbx.com\\/lookaside\\/crawler\\/media\\/?media_id=123&sd=1"}</script>
    </html>
  `);
  try {
    const data = await extractFacebookPost(uniquePostUrl('reel'));
    assert.equal(
      data.video,
      'https://lookaside.fbsbx.com/lookaside/crawler/media/?media_id=123'
    );
  } finally {
    restore();
  }
});

test('extractFacebookPost falls back to embedded JSON message/image when no og: tags are present at all (photo? routes)', async () => {
  const restore = mockFetch(`
    <html><head><title>Facebook</title></head>
    <script>{"foo":{"message":{"text":"Caption with a \\u00e9 and a \\n newline"},"other":1}}</script>
    <script>{"image":{"uri":"https:\\/\\/lookaside.fbsbx.com\\/lookaside\\/crawler\\/media\\/?media_id=456"}}</script>
    </html>
  `);
  try {
    const data = await extractFacebookPost(uniquePostUrl('photo'));
    assert.equal(data.description, 'Caption with a é and a \n newline');
    assert.equal(data.image, 'https://lookaside.fbsbx.com/lookaside/crawler/media/?media_id=456');
    assert.equal(data.video, null);
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

test('buildEmbed shows the post date fixed to UTC+7 in the footer, labeled as such', () => {
  const [embed] = buildEmbed({
    title: 'Mark Zuckerberg',
    description: '',
    siteName: 'Facebook',
    url: 'https://facebook.com/x',
    timestamp: 1451861194000, // 2016-01-03T22:46:34Z -> 2016-01-04 05:46 in UTC+7
  });
  assert.equal(embed.toJSON().footer.text, 'Facebook • Jan 4, 2016, 5:46 AM (UTC+7)');
});

test('buildEmbed footer is just the site name when no post date was found', () => {
  const [embed] = buildEmbed({
    title: '',
    description: '',
    siteName: 'Facebook',
    url: 'https://facebook.com/x',
    timestamp: null,
  });
  assert.equal(embed.toJSON().footer.text, 'Facebook');
});

test('buildEmbed falls back to a generic description when none was extracted', () => {
  const [embed] = buildEmbed({ title: '', description: '', image: null, siteName: 'Facebook', url: 'https://facebook.com/x' });
  const json = embed.toJSON();
  assert.equal(json.description, '[View on Facebook]');
  assert.equal(json.color, 0x1877f2);
});

test('buildEmbed returns one gallery embed per extra photo, sharing the same URL', () => {
  const embeds = buildEmbed({
    title: 'A post',
    description: '',
    images: ['https://scontent.example/1.jpg', 'https://scontent.example/2.jpg', 'https://scontent.example/3.jpg'],
    siteName: 'Facebook',
    url: 'https://facebook.com/x',
  });
  assert.equal(embeds.length, 3);
  assert.equal(embeds[0].toJSON().image.url, 'https://scontent.example/1.jpg');
  assert.equal(embeds[0].toJSON().title, 'A post');
  assert.equal(embeds[1].toJSON().image.url, 'https://scontent.example/2.jpg');
  assert.equal(embeds[1].toJSON().url, 'https://facebook.com/x');
  assert.equal(embeds[1].toJSON().title, undefined);
});

test('buildEmbed caps the gallery at 4 images', () => {
  const embeds = buildEmbed({
    title: '',
    description: '',
    images: ['1', '2', '3', '4', '5'].map((n) => `https://scontent.example/${n}.jpg`),
    siteName: 'Facebook',
    url: 'https://facebook.com/x',
  });
  assert.equal(embeds.length, 4);
});
