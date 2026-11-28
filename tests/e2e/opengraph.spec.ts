import { execFileSync } from 'node:child_process';
import { expect, test, type APIResponse } from '@playwright/test';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const EXPECTED_OG_ALT = 'The Seth Tapes — A childhood-language archive from the Peters/Wilson corpus';
const EXPECTED_OG_TITLE = 'The Seth Tapes';
const EXPECTED_OG_DESCRIPTION = 'A childhood-language archive from the Peters/Wilson corpus.';

const ARCHIVE_ROUTES = [
  '/',
  '/sessions',
  '/sessions/010815',
  '/search?q=locomotive',
  '/research',
  '/research/fixture-provenance-guide',
  '/about',
] as const;

const USER_AGENTS = [
  { label: 'standard', ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
  { label: 'facebookexternalhit', ua: 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)' },
  { label: 'Slackbot', ua: 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)' },
  { label: 'Twitterbot', ua: 'Twitterbot/1.0' },
] as const;

const FORBIDDEN_ARCHIVE_STRINGS = [
  'locomotive',
  'submarine',
  'lighthouse',
  'observatory',
  'Fixture annotation provenance guide',
  'Explains how invented transcript origins',
] as const;

function parsePngDimensions(bytes: Buffer): { width: number; height: number } {
  expect(bytes.length).toBeGreaterThanOrEqual(24);
  expect(bytes.subarray(0, 8).equals(PNG_SIGNATURE), 'valid PNG signature').toBe(true);
  expect(bytes.subarray(12, 16).toString('ascii'), 'PNG IHDR chunk').toBe('IHDR');
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

function extractHeadMeta(html: string, attr: 'property' | 'name', key: string): string | null {
  const headMatch = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(html);
  const head = headMatch ? headMatch[1] : '';
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `<meta\\s+[^>]*${attr}="${escapedKey}"[^>]*content="([^"]*)"|<meta\\s+[^>]*content="([^"]*)"[^>]*${attr}="${escapedKey}"`,
    'i',
  );
  const match = re.exec(head);
  return match ? (match[1] ?? match[2] ?? null) : null;
}

function expectArchivePrivateHeaders(response: APIResponse, label: string) {
  const headers = response.headers();
  expect(headers['cache-control'] || '', `${label}: Cache-Control no-store`).toMatch(/\bno-store\b/i);
  expect(headers['cdn-cache-control'] || '', `${label}: CDN-Cache-Control no-store`).toMatch(/\bno-store\b/i);
  expect(headers['vercel-cdn-cache-control'] || '', `${label}: Vercel-CDN-Cache-Control no-store`).toMatch(/\bno-store\b/i);
  expect(headers['x-robots-tag'] || '', `${label}: X-Robots-Tag noindex`).toMatch(/\bnoindex\b/i);
  expect(headers['referrer-policy'], `${label}: Referrer-Policy no-referrer`).toBe('no-referrer');
}

test('/opengraph-image and /twitter-image serve valid 1200x630 PNGs with noindex and no-referrer while robots.txt keeps Disallow: /', async ({ request }) => {
  for (const route of ['/opengraph-image', '/twitter-image'] as const) {
    const res = await request.get(route);
    expect(res.status(), `${route} status`).toBe(200);
    expect(res.headers()['content-type'] || '', `${route} content-type`).toMatch(/^image\/png\b/i);
    expect(res.headers()['x-robots-tag'] || '', `${route} X-Robots-Tag`).toMatch(/\bnoindex\b/i);
    expect(res.headers()['referrer-policy'], `${route} Referrer-Policy`).toBe('no-referrer');

    const bytes = await res.body();
    expect(bytes.length, `${route} byte size`).toBeGreaterThan(10_000);
    expect(parsePngDimensions(bytes), `${route} dimensions`).toEqual({ width: 1200, height: 630 });
  }

  const robotsRes = await request.get('/robots.txt');
  expect(robotsRes.status()).toBe(200);
  const robotsText = await robotsRes.text();
  expect(robotsText).toMatch(/User-agent:\s*\*/i);
  expect(robotsText).toMatch(/^Disallow:\s*\/\s*$/im);
});

test('every route emits complete absolute <head> OG and Twitter metadata for standard and crawler UAs with zero archive text and intact private headers', async ({ request }) => {
  const discoveredImagePaths = new Set<string>();

  for (const { label: uaLabel, ua } of USER_AGENTS) {
    for (const route of ARCHIVE_ROUTES) {
      const label = `${uaLabel} ${route}`;
      const res = await request.get(route, { headers: { 'User-Agent': ua } });
      expect(res.status(), `${label} HTTP 200`).toBe(200);
      expectArchivePrivateHeaders(res, label);

      const html = await res.text();
      const ogTitle = extractHeadMeta(html, 'property', 'og:title');
      const ogDescription = extractHeadMeta(html, 'property', 'og:description');
      const ogType = extractHeadMeta(html, 'property', 'og:type');
      const ogSiteName = extractHeadMeta(html, 'property', 'og:site_name');
      const ogImage = extractHeadMeta(html, 'property', 'og:image');
      const ogWidth = extractHeadMeta(html, 'property', 'og:image:width');
      const ogHeight = extractHeadMeta(html, 'property', 'og:image:height');
      const ogImageType = extractHeadMeta(html, 'property', 'og:image:type');
      const ogImageAlt = extractHeadMeta(html, 'property', 'og:image:alt');
      const twitterCard = extractHeadMeta(html, 'name', 'twitter:card');
      const twitterTitle = extractHeadMeta(html, 'name', 'twitter:title');
      const twitterDescription = extractHeadMeta(html, 'name', 'twitter:description');
      const twitterImage = extractHeadMeta(html, 'name', 'twitter:image');

      expect(ogTitle, `${label} og:title`).toBe(EXPECTED_OG_TITLE);
      expect(ogDescription, `${label} og:description`).toBe(EXPECTED_OG_DESCRIPTION);
      expect(ogType, `${label} og:type`).toBe('website');
      expect(ogSiteName, `${label} og:site_name`).toBe(EXPECTED_OG_TITLE);
      expect(ogWidth, `${label} og:image:width`).toBe('1200');
      expect(ogHeight, `${label} og:image:height`).toBe('630');
      expect(ogImageType, `${label} og:image:type`).toBe('image/png');
      expect(ogImageAlt, `${label} og:image:alt`).toBe(EXPECTED_OG_ALT);
      expect(twitterCard, `${label} twitter:card`).toBe('summary_large_image');
      expect(twitterTitle, `${label} twitter:title`).toBe(EXPECTED_OG_TITLE);
      expect(twitterDescription, `${label} twitter:description`).toBe(EXPECTED_OG_DESCRIPTION);

      expect(ogImage, `${label} absolute https og:image`).toMatch(/^https:\/\/[^/]+\/opengraph-image(?:\?.*)?$/);
      expect(twitterImage, `${label} absolute https twitter:image`).toMatch(/^https:\/\/[^/]+\/twitter-image(?:\?.*)?$/);

      const ogUrl = new URL(ogImage!);
      const twUrl = new URL(twitterImage!);
      discoveredImagePaths.add(`${ogUrl.pathname}${ogUrl.search}`);
      discoveredImagePaths.add(`${twUrl.pathname}${twUrl.search}`);

      const combinedMeta = [
        ogTitle,
        ogDescription,
        ogSiteName,
        ogImageAlt,
        twitterTitle,
        twitterDescription,
        ogImage,
        twitterImage,
      ].join(' ');
      for (const forbidden of FORBIDDEN_ARCHIVE_STRINGS) {
        expect(combinedMeta.toLowerCase(), `${label} must never leak "${forbidden}" in OG/Twitter tags`).not.toContain(
          forbidden.toLowerCase(),
        );
      }
    }
  }

  // Confirm every emitted og:image and twitter:image path resolves to a valid 1200x630 PNG.
  expect(discoveredImagePaths.size).toBeGreaterThanOrEqual(2);
  for (const imagePath of discoveredImagePaths) {
    const res = await request.get(imagePath);
    expect(res.status(), `${imagePath} HTTP 200`).toBe(200);
    expect(res.headers()['content-type'] || '').toMatch(/^image\/png\b/i);
    expect(parsePngDimensions(await res.body())).toEqual({ width: 1200, height: 630 });
  }
});

test('browser document head exposes OG and Twitter tags cleanly without console errors and check-build-output reports zero leaks', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('/sessions/010815');
  await expect(page).toHaveTitle('Session 010815 (age 1;08.15) · The Seth Tapes');

  const headMeta = await page.evaluate(() => ({
    ogTitle: document.head.querySelector('meta[property="og:title"]')?.getAttribute('content') ?? null,
    ogDescription: document.head.querySelector('meta[property="og:description"]')?.getAttribute('content') ?? null,
    ogImage: document.head.querySelector('meta[property="og:image"]')?.getAttribute('content') ?? null,
    ogWidth: document.head.querySelector('meta[property="og:image:width"]')?.getAttribute('content') ?? null,
    ogHeight: document.head.querySelector('meta[property="og:image:height"]')?.getAttribute('content') ?? null,
    twitterCard: document.head.querySelector('meta[name="twitter:card"]')?.getAttribute('content') ?? null,
    twitterImage: document.head.querySelector('meta[name="twitter:image"]')?.getAttribute('content') ?? null,
  }));

  expect(headMeta.ogTitle).toBe(EXPECTED_OG_TITLE);
  expect(headMeta.ogDescription).toBe(EXPECTED_OG_DESCRIPTION);
  expect(headMeta.ogImage).toMatch(/^https:\/\/[^/]+\/opengraph-image(?:\?.*)?$/);
  expect(headMeta.ogWidth).toBe('1200');
  expect(headMeta.ogHeight).toBe('630');
  expect(headMeta.twitterCard).toBe('summary_large_image');
  expect(headMeta.twitterImage).toMatch(/^https:\/\/[^/]+\/twitter-image(?:\?.*)?$/);
  expect(consoleErrors).toEqual([]);

  const output = execFileSync(process.execPath, ['scripts/check-build-output.mjs'], {
    encoding: 'utf8',
  });
  const parsed = JSON.parse(output) as {
    ok: boolean;
    prerenderedDynamicHtmlPresent: boolean;
    leaks: unknown[];
  };
  expect(parsed.ok).toBe(true);
  expect(parsed.prerenderedDynamicHtmlPresent).toBe(false);
  expect(parsed.leaks).toEqual([]);
});
