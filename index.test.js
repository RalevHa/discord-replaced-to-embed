const { test } = require('node:test');
const assert = require('node:assert/strict');
// Pure link logic lives in src/rules.js; importing it directly avoids booting Discord.
// (`./index` re-exports the same functions, so either import works.)
const { applyReplacements, TRIGGER } = require('./src/rules');

// Each case: [description, input, expectedOutput, expectedLabels]
// expectedLabels = [] means "nothing should change".
const cases = [
  // --- TikTok: one rule must cover every subdomain form ---
  ['tiktok bare',     'tiktok.com/@user/video/789',
                      'https://a.tnktok.com/@user/video/789', ['TikTok']],
  ['tiktok www',      'https://www.tiktok.com/@user/video/123',
                      'https://a.tnktok.com/@user/video/123', ['TikTok']],
  ['tiktok vt short', 'check https://vt.tiktok.com/ZSxxxxAbC/',
                      'check https://a.tnktok.com/ZSxxxxAbC/', ['TikTok']],
  ['tiktok vm short', 'vm.tiktok.com/ZSyyyy/',
                      'https://a.tnktok.com/ZSyyyy/', ['TikTok']],

  // --- other platforms ---
  ['bilibili',  'https://www.bilibili.com/video/BV1xx',
                'https://www.vxbilibili.com/video/BV1xx', ['Bilibili']],
  ['x/twitter', 'https://x.com/user/status/123',
                'https://fixupx.com/user/status/123', ['X (Twitter)']],
  ['pixiv',     'https://www.pixiv.net/en/artworks/123',
                'https://www.phixiv.net/en/artworks/123', ['Pixiv']],
  ['bluesky',   'https://bsky.app/profile/user/post/abc',
                'https://bskx.app/profile/user/post/abc', ['Bluesky']],

  // --- must NOT match ---
  ['lookalike domain', 'no nottiktok.com/should/not/match here',
                'no nottiktok.com/should/not/match here', []],
  ['unsupported site',  'https://example.com/foo',
                'https://example.com/foo', []],
  ['domain with no path', 'just x.com with no path',
                'just x.com with no path', []],

  // --- multiple links in one message ---
  ['two links', 'a x.com/a/1 and tiktok.com/b/2',
                'a https://fixupx.com/a/1 and https://a.tnktok.com/b/2',
                ['X (Twitter)', 'TikTok']],
];

for (const [name, input, expectedOut, expectedLabels] of cases) {
  test(name, () => {
    const { newText, replaced } = applyReplacements(input);
    assert.equal(newText, expectedOut, 'rewritten text mismatch');
    assert.deepEqual(
      replaced.map((r) => r.label).sort(),
      [...expectedLabels].sort(),
      'matched-rule labels mismatch',
    );
  });
}

test('spoilered link stays spoilered in the converted output', () => {
  const { replaced } = applyReplacements('||https://x.com/user/status/123||');
  assert.equal(replaced.length, 1);
  assert.equal(replaced[0].converted, '||https://fixupx.com/user/status/123||');
});

test('spoilered link with trailing words before the closing bars', () => {
  const { replaced } = applyReplacements(
    '||https://bsky.app/profile/rustyjuggs.bsky.social/post/3mpespi3u5s2k test ปิด||'
  );
  assert.equal(replaced.length, 1);
  assert.equal(
    replaced[0].converted,
    '||https://bskx.app/profile/rustyjuggs.bsky.social/post/3mpespi3u5s2k||'
  );
});

test('spoiler closes right after the link, trailing text stays outside it', () => {
  const { replaced } = applyReplacements(
    '||https://bsky.app/profile/rustyjuggs.bsky.social/post/3mpespi3u5s2k||test ปิด'
  );
  assert.equal(replaced.length, 1);
  assert.equal(
    replaced[0].converted,
    '||https://bskx.app/profile/rustyjuggs.bsky.social/post/3mpespi3u5s2k||'
  );
});

test('TRIGGER early-exit matches supported domains and skips others', () => {
  assert.ok(TRIGGER.test('hey vt.tiktok.com/x'), 'should detect tiktok');
  assert.ok(!TRIGGER.test('hey example.com/x'), 'should ignore unsupported');
});

// Facebook is handled natively (native embed via facebook.js), not as a rules.js
// rewrite — see facebook.test.js.
test('rules.js does not rewrite Facebook links (handled by facebook.js instead)', () => {
  assert.equal(applyReplacements('https://www.facebook.com/user/posts/123').replaced.length, 0);
});
