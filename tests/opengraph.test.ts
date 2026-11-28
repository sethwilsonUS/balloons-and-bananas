import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import OpenGraphImage, {
  alt as ogAlt,
  contentType as ogContentType,
  size as ogSize,
} from '../src/app/opengraph-image';
import TwitterImage, {
  alt as twitterAlt,
  contentType as twitterContentType,
  size as twitterSize,
} from '../src/app/twitter-image';
import {
  loadOgFonts,
  OG_SANS_FAMILY,
  OG_SERIF_FAMILY,
} from '../src/app/og-fonts';
import { renderOpenGraphImageResponse } from '../src/lib/og-card';
import {
  DEFAULT_SITE_HOST,
  DEFAULT_SITE_URL,
  parseSiteOrigin,
  resolveCanonicalSiteHost,
  resolveMetadataBase,
} from '../src/lib/site';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WOFF_V1_SIGNATURE = Buffer.from('wOFF', 'ascii');

function parsePngDimensions(bytes: Buffer): { width: number; height: number } {
  assert.ok(bytes.length >= 24, `Expected at least 24 PNG bytes, got ${bytes.length}`);
  assert.equal(bytes.subarray(0, 8).equals(PNG_SIGNATURE), true, 'Expected valid PNG magic signature');
  assert.equal(bytes.subarray(12, 16).toString('ascii'), 'IHDR', 'Expected PNG IHDR chunk');
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

test('parseSiteOrigin, resolveMetadataBase, and resolveCanonicalSiteHost enforce precedence and reject unsafe inputs', () => {
  assert.equal(parseSiteOrigin('https://sethtapes.org/some/path?x=1#y')?.href, 'https://sethtapes.org/');
  assert.equal(parseSiteOrigin('http://localhost:3000/foo')?.href, 'http://localhost:3000/');
  assert.equal(parseSiteOrigin('balloons-and-bananas.vercel.app', { allowBareHost: true })?.href, 'https://balloons-and-bananas.vercel.app/');
  assert.equal(parseSiteOrigin('balloons-and-bananas.vercel.app'), null);

  // Reject malformed, non-HTTP(S), credentialed, or invalid-hostname values
  for (const bad of [
    '',
    '   ',
    'javascript:alert(1)',
    'data:text/html,hi',
    'https://user:pass@example.com',
    'https://..',
    'https://-bad.example.com',
    'https://example..com',
    'evil.com/path',
    'user@evil.com',
    'example.com:99999',
  ]) {
    assert.equal(parseSiteOrigin(bad, { allowBareHost: true }), null, `Expected rejection for "${bad}"`);
  }

  // Empty env falls back to canonical production URL & host
  assert.equal(resolveMetadataBase({}).href, `${DEFAULT_SITE_URL}/`);
  assert.equal(resolveCanonicalSiteHost({}), DEFAULT_SITE_HOST);

  // Explicit NEXT_PUBLIC_SITE_URL wins for both metadataBase and canonical host
  const customEnv = {
    NEXT_PUBLIC_SITE_URL: 'https://archive.example.org/ignored',
    VERCEL_ENV: 'preview',
    VERCEL_URL: 'preview-abc.vercel.app',
    VERCEL_PROJECT_PRODUCTION_URL: 'balloons-and-bananas.vercel.app',
  };
  assert.equal(resolveMetadataBase(customEnv).href, 'https://archive.example.org/');
  assert.equal(resolveCanonicalSiteHost(customEnv), 'archive.example.org');

  // Preview deployments use VERCEL_URL for metadataBase (so previews verify their own OG image)
  // while keeping the canonical production host in the printed card footer.
  const previewEnv = {
    VERCEL_ENV: 'preview',
    VERCEL_URL: 'balloons-and-bananas-git-renovation-35.vercel.app',
    VERCEL_PROJECT_PRODUCTION_URL: 'balloons-and-bananas.vercel.app',
  };
  assert.equal(resolveMetadataBase(previewEnv).href, 'https://balloons-and-bananas-git-renovation-35.vercel.app/');
  assert.equal(resolveCanonicalSiteHost(previewEnv), 'balloons-and-bananas.vercel.app');

  // Production deployments prefer VERCEL_PROJECT_PRODUCTION_URL over ephemeral VERCEL_URL
  const prodEnv = {
    VERCEL_ENV: 'production',
    VERCEL_URL: 'balloons-and-bananas-abc123.vercel.app',
    VERCEL_PROJECT_PRODUCTION_URL: 'balloons-and-bananas.vercel.app',
  };
  assert.equal(resolveMetadataBase(prodEnv).href, 'https://balloons-and-bananas.vercel.app/');
  assert.equal(resolveCanonicalSiteHost(prodEnv), 'balloons-and-bananas.vercel.app');

  // Invalid NEXT_PUBLIC_SITE_URL falls through cleanly to VERCEL_URL / default
  assert.equal(
    resolveMetadataBase({
      NEXT_PUBLIC_SITE_URL: 'not-a-valid-url',
      VERCEL_URL: 'branch-preview.vercel.app',
    }).href,
    'https://branch-preview.vercel.app/',
  );
  assert.equal(
    resolveCanonicalSiteHost({
      NEXT_PUBLIC_SITE_URL: 'javascript:alert(1)',
      VERCEL_URL: 'branch-preview.vercel.app',
    }),
    DEFAULT_SITE_HOST,
  );
});

test('loadOgFonts loads bundled WOFF v1 font subsets cleanly and degrades to [] on read failure', async () => {
  const fonts = await loadOgFonts({ bypassCache: true });
  assert.equal(fonts.length, 3);
  assert.deepEqual(
    fonts.map(font => ({ name: font.name, weight: font.weight, style: font.style })),
    [
      { name: OG_SERIF_FAMILY, weight: 500, style: 'normal' },
      { name: OG_SANS_FAMILY, weight: 400, style: 'normal' },
      { name: OG_SANS_FAMILY, weight: 500, style: 'normal' },
    ],
  );
  for (const font of fonts) {
    const bytes = Buffer.from(font.data);
    assert.ok(bytes.length > 5_000, `Expected non-empty WOFF v1 font buffer for ${font.name}`);
    assert.equal(
      bytes.subarray(0, 4).equals(WOFF_V1_SIGNATURE),
      true,
      `Expected WOFF v1 ("wOFF") magic header for ${font.name}, never WOFF2`,
    );
  }

  const fallback = await loadOgFonts({
    readFontFile: async () => {
      throw new Error('simulated ENOENT');
    },
  });
  assert.deepEqual(fallback, []);
});

test('opengraph-image and twitter-image export literal Next.js metadata, share Node.js renderer, reuse Ticket 36 cassette, and render a valid 1200x630 PNG', async () => {
  assert.equal(TwitterImage, OpenGraphImage);
  assert.deepEqual(ogSize, { width: 1200, height: 630 });
  assert.deepEqual(twitterSize, { width: 1200, height: 630 });
  assert.equal(ogContentType, 'image/png');
  assert.equal(twitterContentType, 'image/png');
  assert.equal(ogAlt, 'The Seth Tapes — A childhood-language archive from the Peters/Wilson corpus');
  assert.equal(twitterAlt, ogAlt);

  // Confirm Next.js static analysis requirements: literal exports, Node.js runtime (no edge),
  // zero remote fetches, and direct reuse of Ticket 36's renderCassetteTapeArtwork.
  const [ogSrc, twSrc, ogCardSrc, nextConfigSrc] = await Promise.all([
    readFile(path.resolve('src/app/opengraph-image.tsx'), 'utf8'),
    readFile(path.resolve('src/app/twitter-image.tsx'), 'utf8'),
    readFile(path.resolve('src/lib/og-card.tsx'), 'utf8'),
    readFile(path.resolve('next.config.ts'), 'utf8'),
  ]);
  for (const [name, src] of [
    ['src/app/opengraph-image.tsx', ogSrc],
    ['src/app/twitter-image.tsx', twSrc],
  ] as const) {
    assert.match(src, /^export const alt = '/m, `${name}: literal export const alt`);
    assert.match(src, /^export const size = \{ width: 1200, height: 630 \};/m, `${name}: literal export const size`);
    assert.match(src, /^export const contentType = 'image\/png';/m, `${name}: literal export const contentType`);
    assert.doesNotMatch(src, /export const runtime\s*=\s*['"]edge['"]/, `${name}: must not use edge runtime`);
    assert.doesNotMatch(src, /\bfetch\s*\(/, `${name}: must not fetch remote assets at render time`);
  }
  assert.doesNotMatch(ogCardSrc, /\bfetch\s*\(/, 'src/lib/og-card.tsx must not fetch remote assets');
  assert.match(ogCardSrc, /renderCassetteTapeArtwork/, 'og-card.tsx must reuse renderCassetteTapeArtwork');
  assert.doesNotMatch(ogCardSrc, /<path\b/, 'og-card.tsx must not duplicate cassette SVG geometry');
  assert.match(nextConfigSrc, /outputFileTracingIncludes/, 'next.config.ts must declare outputFileTracingIncludes');
  assert.match(nextConfigSrc, /'\/opengraph-image':\s*\['\.\/src\/app\/og-fonts\/\*\*\/\*'\]/);
  assert.match(nextConfigSrc, /'\/twitter-image':\s*\['\.\/src\/app\/og-fonts\/\*\*\/\*'\]/);

  // Render the actual PNG via ImageResponse and verify magic bytes and 1200x630 IHDR.
  const response = await OpenGraphImage();
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /^image\/png/i);
  const bytes = Buffer.from(await response.arrayBuffer());
  const dims = parsePngDimensions(bytes);
  assert.deepEqual(dims, { width: 1200, height: 630 });
  assert.ok(bytes.length > 10_000, `Expected full rendered PNG (>10KB), got ${bytes.length} bytes`);

  // Regression check: when bundled fonts cannot be loaded (`fonts: []`), omitting the `fonts`
  // option lets Next.js fall back to its built-in default font instead of throwing in Satori.
  const fallbackRes = renderOpenGraphImageResponse({ fonts: [] });
  assert.equal(fallbackRes.status, 200);
  assert.match(fallbackRes.headers.get('content-type') || '', /^image\/png/i);
  const fallbackBytes = Buffer.from(await fallbackRes.arrayBuffer());
  assert.deepEqual(parsePngDimensions(fallbackBytes), { width: 1200, height: 630 });
  assert.ok(fallbackBytes.length > 10_000, `Expected valid fallback PNG (>10KB), got ${fallbackBytes.length} bytes`);
});
