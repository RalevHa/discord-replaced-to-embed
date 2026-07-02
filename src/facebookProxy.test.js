const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isCrawler, buildProxyHtml, handleProxyRequest } = require('./facebookProxy');
const { encodeProxyPath } = require('./facebook');

test('isCrawler recognizes known link-preview bots', () => {
  assert.equal(isCrawler('Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)'), true);
  assert.equal(isCrawler('facebookexternalhit/1.1'), true);
  assert.equal(isCrawler('TelegramBot (like TwitterBot)'), true);
});

test('isCrawler rejects a normal browser UA', () => {
  assert.equal(
    isCrawler('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'),
    false
  );
  assert.equal(isCrawler(''), false);
  assert.equal(isCrawler(undefined), false);
});

test('buildProxyHtml includes Twitter Player Card tags when a video is present', () => {
  const html = buildProxyHtml(
    { title: 'A Reel', description: 'desc', image: 'https://img.example/x.jpg', video: 'https://video.example/x.mp4' },
    'https://www.facebook.com/reel/1'
  );
  assert.match(html, /name="twitter:card" content="player"/);
  assert.match(html, /property="twitter:player:stream" content="https:\/\/video\.example\/x\.mp4"/);
  assert.match(html, /property="og:video:secure_url" content="https:\/\/video\.example\/x\.mp4"/);
});

test('buildProxyHtml omits video tags when there is no video', () => {
  const html = buildProxyHtml(
    { title: 'A Post', description: 'desc', image: null, video: null },
    'https://www.facebook.com/user/posts/1'
  );
  assert.doesNotMatch(html, /twitter:card/);
  assert.doesNotMatch(html, /og:video/);
});

test('buildProxyHtml escapes HTML in extracted fields', () => {
  const html = buildProxyHtml(
    { title: '<script>alert(1)</script>', description: '', image: null, video: null },
    'https://www.facebook.com/x'
  );
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

// extractFacebookPost caches by normalized URL, so each test needs its own unique
// URL — Date.now() alone isn't enough since tests can share a millisecond.
let uniqueCounter = 0;
function uniquePostUrl() {
  uniqueCounter += 1;
  return `https://www.facebook.com/reel/${uniqueCounter}`;
}

// handleProxyRequest hits facebook.js's extractFacebookPost, which calls global.fetch —
// stub it the same way facebook.test.js does.
function mockFetch(html, { ok = true } = {}) {
  const original = global.fetch;
  global.fetch = async () => ({ ok, text: async () => html });
  return () => {
    global.fetch = original;
  };
}

function fakeResponse() {
  const res = {
    statusCode: null,
    headers: null,
    body: null,
    headersSent: false,
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers || null;
      this.headersSent = true;
      return this;
    },
    end(body) {
      this.body = body;
    },
  };
  return res;
}

test('handleProxyRequest redirects non-crawler UAs to the original URL', async () => {
  const res = fakeResponse();
  const url = uniquePostUrl();
  await handleProxyRequest(res, encodeProxyPath(url), 'Mozilla/5.0 (Windows NT 10.0)');
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.Location, url);
});

test('handleProxyRequest serves synthetic HTML to a crawler UA', async () => {
  const restore = mockFetch(`
    <html><head>
      <meta property="og:title" content="A Reel" />
      <meta property="og:video:secure_url" content="https://video.example/clip.mp4" />
    </head></html>
  `);
  try {
    const res = fakeResponse();
    const url = uniquePostUrl();
    await handleProxyRequest(res, encodeProxyPath(url), 'Mozilla/5.0 (compatible; Discordbot/2.0)');
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /twitter:player:stream/);
  } finally {
    restore();
  }
});

test('handleProxyRequest redirects a crawler UA when extraction fails', async () => {
  const restore = mockFetch('', { ok: false });
  try {
    const res = fakeResponse();
    const url = uniquePostUrl();
    await handleProxyRequest(res, encodeProxyPath(url), 'Mozilla/5.0 (compatible; Discordbot/2.0)');
    assert.equal(res.statusCode, 302);
    assert.equal(res.headers.Location, url);
  } finally {
    restore();
  }
});

test('handleProxyRequest returns 400 for an undecodable path', async () => {
  const res = fakeResponse();
  await handleProxyRequest(res, '%%%not-base64%%%', 'Mozilla/5.0 (compatible; Discordbot/2.0)');
  assert.equal(res.statusCode, 400);
});
