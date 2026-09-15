const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  extractFacebookUrls,
  extractFacebookMatches,
  normalizeUrl,
  extractFacebookPost,
  buildEmbed,
  encodeProxyPath,
  decodeProxyPath,
  rewriteFacebookLinksForRepost,
  spoilerFixUrl,
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

test('spoilerFixUrl swaps the domain for the public fixup host, dropping subdomains', () => {
  assert.equal(
    spoilerFixUrl('https://www.facebook.com/user/posts/123'),
    'https://facebed.seria.moe/user/posts/123'
  );
  assert.equal(spoilerFixUrl('https://fb.watch/abc123/'), 'https://facebed.seria.moe/abc123/');
});

test('rewriteFacebookLinksForRepost wraps a non-spoilered link in <...> without touching other text', () => {
  const text = 'see https://facebook.com/user/posts/123 for details';
  assert.equal(
    rewriteFacebookLinksForRepost(text, extractFacebookMatches(text)),
    'see <https://facebook.com/user/posts/123> for details'
  );
  assert.equal(rewriteFacebookLinksForRepost('no facebook link here', []), 'no facebook link here');
});

test('rewriteFacebookLinksForRepost swaps a spoilered link to the fixup host in place, keeping the || bars', () => {
  const text = '||https://www.facebook.com/user/posts/123||';
  const matches = [{ url: 'https://www.facebook.com/user/posts/123', spoiler: true }];
  assert.equal(rewriteFacebookLinksForRepost(text, matches), '||https://facebed.seria.moe/user/posts/123||');
});

test('rewriteFacebookLinksForRepost swaps a video post link for its video/proxy link in place, not wrapped in <...>', () => {
  const text = 'check https://fb.watch/abc123/ out';
  const matches = extractFacebookMatches(text);
  const videoLinkByUrl = new Map([['https://fb.watch/abc123/', 'https://fb.ralevisdev.com/fb/xyz']]);
  assert.equal(
    rewriteFacebookLinksForRepost(text, matches, videoLinkByUrl),
    'check https://fb.ralevisdev.com/fb/xyz out'
  );
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
function mockFetch(html, { ok = true, videoOk = true, captureHeaders } = {}) {
  const original = global.fetch;
  global.fetch = async (url, opts) => {
    if (opts && opts.method === 'HEAD') {
      return { ok: videoOk, headers: { get: () => (videoOk ? 'video/mp4' : 'text/html') } };
    }
    if (captureHeaders) captureHeaders(opts.headers);
    return { ok, text: async () => html };
  };
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

test('extractFacebookPost collects every photo from all_subattachments when og:image is only the cover photo', async () => {
  const restore = mockFetch(`
    <html><head>
      <meta property="og:title" content="Album post" />
      <meta property="og:description" content="Caption" />
      <meta property="og:image" content="https://lookaside.fbsbx.com/lookaside/crawler/media/?media_id=1" />
    </head></html>
    <script>{"attachment":{"all_subattachments":{"count":2,"nodes":[{"media":{"image":{"uri":"https:\\/\\/lookaside.fbsbx.com\\/lookaside\\/crawler\\/media\\/?media_id=1"}}},{"media":{"image":{"uri":"https:\\/\\/lookaside.fbsbx.com\\/lookaside\\/crawler\\/media\\/?media_id=2"}}}]}}}</script>
  `);
  try {
    const data = await extractFacebookPost(uniquePostUrl());
    assert.deepEqual(data.images, [
      'https://lookaside.fbsbx.com/lookaside/crawler/media/?media_id=1',
      'https://lookaside.fbsbx.com/lookaside/crawler/media/?media_id=2',
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
    <script>{"story":{"creation_time":1600000000,"attachments":[{"media":{"browser_native_hd_url":"https:\\/\\/lookaside.fbsbx.com\\/lookaside\\/crawler\\/media\\/?media_id=123","browser_native_sd_url":"https:\\/\\/lookaside.fbsbx.com\\/lookaside\\/crawler\\/media\\/?media_id=123&sd=1"}}]}}</script>
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

test('extractFacebookPost discards a browser_native video URL that fails the HEAD verification', async () => {
  const restore = mockFetch(
    `
    <html><head>
      <meta property="og:type" content="video.other" />
      <meta property="og:title" content="A Reel" />
    </head>
    <script>{"story":{"creation_time":1600000000,"attachments":[{"media":{"browser_native_hd_url":"https:\\/\\/lookaside.fbsbx.com\\/lookaside\\/crawler\\/media\\/?media_id=123"}}]}}</script>
    </html>
  `,
    { videoOk: false }
  );
  try {
    const data = await extractFacebookPost(uniquePostUrl('reel'));
    assert.equal(data.video, null);
  } finally {
    restore();
  }
});

test('extractFacebookPost with skipVideoVerification posts the browser_native video URL even when the HEAD check fails', async () => {
  const restore = mockFetch(
    `
    <html><head>
      <meta property="og:type" content="video.other" />
      <meta property="og:title" content="A Reel" />
    </head>
    <script>{"story":{"creation_time":1600000000,"attachments":[{"media":{"browser_native_hd_url":"https:\\/\\/lookaside.fbsbx.com\\/lookaside\\/crawler\\/media\\/?media_id=123"}}]}}</script>
    </html>
  `,
    { videoOk: false }
  );
  try {
    const data = await extractFacebookPost(uniquePostUrl('reel'), { skipVideoVerification: true });
    assert.equal(data.video, 'https://lookaside.fbsbx.com/lookaside/crawler/media/?media_id=123');
  } finally {
    restore();
  }
});

test('extractFacebookPost prefers the HD progressive_url (logged-in cookie page) over browser_native_hd_url, unverified', async () => {
  const url = uniquePostUrl('reel');
  const id = url.split('/').pop();
  const restore = mockFetch(
    `
    <html><head>
      <meta property="og:type" content="video.other" />
      <meta property="og:title" content="A Reel" />
    </head>
    <script>{"story":{"creation_time":1600000000,"attachments":[{"media":{"browser_native_hd_url":"https:\\/\\/lookaside.fbsbx.com\\/lookaside\\/crawler\\/media\\/?media_id=${id}"}}]}}</script>
    <script>{"dash_manifest_urls":[{"manifest_url":"https:\\/\\/www.facebook.com\\/dash_mpd_debug.mpd?v=${id}&dummy=.mpd"}],"progressive_urls":[{"progressive_url":"https:\\/\\/scontent.example\\/sd.mp4","metadata":{"quality":"SD"}},{"progressive_url":"https:\\/\\/scontent.example\\/hd.mp4","metadata":{"quality":"HD"}}]}</script>
    </html>
  `,
    { videoOk: false } // the crawler-stub HEAD check would fail — progressive_url must not depend on it
  );
  try {
    const data = await extractFacebookPost(url);
    assert.equal(data.video, 'https://scontent.example/hd.mp4');
  } finally {
    restore();
  }
});

test("extractFacebookPost's progressive_url lookup ignores a different video's block (e.g. an 'up next' reel bundled in the same page)", async () => {
  const url = uniquePostUrl('reel');
  const id = url.split('/').pop();
  const otherId = `${id}9`;
  const restore = mockFetch(`
    <html><head><meta property="og:title" content="A Reel" /></head>
    <script>{"dash_manifest_urls":[{"manifest_url":"https:\\/\\/www.facebook.com\\/dash_mpd_debug.mpd?v=${otherId}&dummy=.mpd"}],"progressive_urls":[{"progressive_url":"https:\\/\\/scontent.example\\/wrong.mp4","metadata":{"quality":"HD"}}]}</script>
    <script>{"dash_manifest_urls":[{"manifest_url":"https:\\/\\/www.facebook.com\\/dash_mpd_debug.mpd?v=${id}&dummy=.mpd"}],"progressive_urls":[{"progressive_url":"https:\\/\\/scontent.example\\/right.mp4","metadata":{"quality":"HD"}}]}</script>
    </html>
  `);
  try {
    const data = await extractFacebookPost(url);
    assert.equal(data.video, 'https://scontent.example/right.mp4');
  } finally {
    restore();
  }
});

test('extractFacebookPost sends a browser User-Agent and Cookie header when a cookie is configured', async () => {
  let sentHeaders;
  const restore = mockFetch('<html><head><meta property="og:title" content="A post"/></head></html>', {
    captureHeaders: (h) => {
      sentHeaders = h;
    },
  });
  try {
    await extractFacebookPost(uniquePostUrl(), { cookie: 'c_user=123; xs=abc' });
    assert.equal(sentHeaders.Cookie, 'c_user=123; xs=abc');
    assert.doesNotMatch(sentHeaders['User-Agent'], /facebookexternalhit/);
  } finally {
    restore();
  }
});

test('extractFacebookPost uses the crawler User-Agent and no Cookie header by default', async () => {
  let sentHeaders;
  const restore = mockFetch('<html><head><meta property="og:title" content="A post"/></head></html>', {
    captureHeaders: (h) => {
      sentHeaders = h;
    },
  });
  try {
    await extractFacebookPost(uniquePostUrl());
    assert.match(sentHeaders['User-Agent'], /facebookexternalhit/);
    assert.equal(sentHeaders.Cookie, undefined);
  } finally {
    restore();
  }
});

test('extractFacebookPost does not pick up a browser_native video URL from a comment on a text-only post', async () => {
  const restore = mockFetch(`
    <html><head>
      <meta property="og:title" content="Text only post" />
      <meta property="og:description" content="Just words, no video" />
    </head></html>
    <script>{"story":{"creation_time":1600000000,"attachments":[]}}</script>
    <script>{"comments":{"edges":[{"node":{"attachments":[{"media":{"browser_native_hd_url":"https:\\/\\/lookaside.fbsbx.com\\/lookaside\\/crawler\\/media\\/?media_id=999"}}]}}]}}</script>
  `);
  try {
    const data = await extractFacebookPost(uniquePostUrl());
    assert.equal(data.video, null);
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

// Regression test: a page fetched with a logged-in cookie (see extractFacebookPost's
// `cookie` option) for a plain permalink post has no og:image at all (Comet SPA
// shell), and bundles a "story" fragment for the viewer's OWN nav bookmark —
// which has a generic "image" (their avatar) sitting before the real post's
// "story" fragment in the page. The old unscoped "image" lookup picked up that
// avatar; scoped photo_image lookup must find the real post photo instead.
test("extractFacebookPost's embedded-JSON fallback ignores an unrelated, earlier generic \"image\" (e.g. the viewer's own nav bookmark, outside any story) and uses the post's own photo_image", async () => {
  const restore = mockFetch(`
    <html><head><title>Facebook</title></head>
    <script>{"sidebar":{"bookmark_type":"type_self_timeline","image":{"uri":"https:\\/\\/scontent.example\\/avatar.jpg"}}}</script>
    <script>{"story":{"message":{"text":"The real caption"},"attachments":[{"target":{"__typename":"Photo"},"styles":{"attachment":{"media":{"photo_image":{"uri":"https:\\/\\/scontent.example\\/real-photo.jpg"}}}}}]}}</script>
    </html>
  `);
  try {
    const data = await extractFacebookPost(uniquePostUrl('posts'));
    assert.equal(data.description, 'The real caption');
    assert.equal(data.image, 'https://scontent.example/real-photo.jpg');
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
  assert.equal(embed.toJSON().footer.text, 'Facebook • 4 Jan 2016, 05:46 (UTC+7)');
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

test('buildEmbed omits the image when the post has a video — the video link\'s own preview already shows it', () => {
  const embeds = buildEmbed({
    title: 'A Reel',
    description: '',
    image: 'https://scontent.example/thumb.jpg',
    images: ['https://scontent.example/thumb.jpg'],
    video: 'https://video.example/clip.mp4',
    siteName: 'Facebook',
    url: 'https://facebook.com/reel/1',
  });
  assert.equal(embeds.length, 1);
  assert.equal(embeds[0].toJSON().image, undefined);
});

test('buildEmbed still shows the image for a photo-only post (no video)', () => {
  const [embed] = buildEmbed({
    title: 'A photo post',
    description: '',
    image: 'https://scontent.example/thumb.jpg',
    images: ['https://scontent.example/thumb.jpg'],
    siteName: 'Facebook',
    url: 'https://facebook.com/x',
  });
  assert.equal(embed.toJSON().image.url, 'https://scontent.example/thumb.jpg');
});

test('buildEmbed appends a compact emoji engagement line to the footer when counts are present', () => {
  const [embed] = buildEmbed({
    title: 'A post',
    description: '',
    siteName: 'Facebook',
    url: 'https://facebook.com/x',
    timestamp: null,
    reactions: 20348,
    comments: 174,
    shares: 386,
  });
  assert.equal(embed.toJSON().footer.text, 'Facebook\n❤️ 20.3K • 💬 174 • 🔁 386');
});

test('buildEmbed leaves the footer as just the date/site line when no engagement counts were extracted', () => {
  const [embed] = buildEmbed({
    title: 'A post',
    description: '',
    siteName: 'Facebook',
    url: 'https://facebook.com/x',
    reactions: null,
    comments: null,
    shares: null,
  });
  assert.equal(embed.toJSON().footer.text, 'Facebook');
});

test('buildEmbed shows reactions/comments without a shares segment when shares is null (no cookie configured)', () => {
  const [embed] = buildEmbed({
    title: 'A post',
    description: '',
    siteName: 'Facebook',
    url: 'https://facebook.com/x',
    timestamp: null,
    reactions: 20348,
    comments: 174,
    shares: null,
  });
  assert.equal(embed.toJSON().footer.text, 'Facebook\n❤️ 20.3K • 💬 174');
});

test('humanFormat abbreviates large counts to one decimal (K/M), leaves small counts as-is', () => {
  const [under1k] = buildEmbed({ siteName: 'Facebook', url: 'https://facebook.com/x', reactions: 174 });
  assert.match(under1k.toJSON().footer.text, /❤️ 174(?!\d)/);
  const [thousands] = buildEmbed({ siteName: 'Facebook', url: 'https://facebook.com/x', reactions: 20348 });
  assert.match(thousands.toJSON().footer.text, /❤️ 20\.3K/);
  const [millions] = buildEmbed({ siteName: 'Facebook', url: 'https://facebook.com/x', reactions: 1_200_000 });
  assert.match(millions.toJSON().footer.text, /❤️ 1\.2M/);
  const [exactRound] = buildEmbed({ siteName: 'Facebook', url: 'https://facebook.com/x', reactions: 20000 });
  assert.match(exactRound.toJSON().footer.text, /❤️ 20K(?!\d)/);
});

test('extractFacebookPost reads reactions/comments from the anonymous crawler-view fragment (no cookie)', async () => {
  const restore = mockFetch(`
    <html><head>
      <meta property="og:title" content="A post" />
    </head>
    <script>{"feedback":{"id":"ZmVlZGJhY2s6MTIz","comment_rendering_instance":{"comments":{"total_count":174}},"i18n_reaction_count":"20K","reaction_count":{"count":20347,"is_empty":false}}}</script>
    </html>
  `);
  try {
    const data = await extractFacebookPost(uniquePostUrl());
    assert.equal(data.comments, 174);
    assert.equal(data.reactions, 20347);
    assert.equal(data.shares, null);
  } finally {
    restore();
  }
});

test('extractFacebookPost reads reactions/comments/shares from the logged-in fragment when a cookie is configured', async () => {
  const restore = mockFetch(`
    <html><head>
      <meta property="og:title" content="A Reel" />
    </head>
    <script>{"story":{"creation_time":1600000000,"id":"ZmVlZGJhY2s6MTIyMjMyMTM1NTQyMzY1NDA4","viewer_actor":{"id":"1"},"unified_reactors":{"count":20348}}}</script>
    <script>{"feedback":{"total_comment_count":174,"id":"ZmVlZGJhY2s6MTIyMjMyMTM1NTQyMzY1NDA4","share_count_reduced":"386"}}</script>
    <script>{"feedback":{"total_comment_count":150,"id":"ZmVlZGJhY2s6OTk5","share_count_reduced":"24"}}</script>
    </html>
  `);
  try {
    const data = await extractFacebookPost(uniquePostUrl('reel'), { cookie: 'c_user=1; xs=2' });
    assert.equal(data.reactions, 20348);
    assert.equal(data.comments, 174);
    assert.equal(data.shares, 386);
  } finally {
    restore();
  }
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
