import { execFileSync } from 'node:child_process';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIResponse, type Page } from '@playwright/test';

type ThemeChoice = 'system' | 'light' | 'dark';

async function waitForThemeSettled(page: Page, expectedDark: boolean) {
  const expectedPaper = expectedDark ? 'rgb(24, 31, 26)' : 'rgb(247, 244, 237)';
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
    .toBe(expectedPaper);
  await page.evaluate(async () => {
    const running = document
      .getAnimations()
      .filter(animation => animation.playState === 'running' && Number.isFinite(Number(animation.effect?.getComputedTiming().duration)));
    await Promise.race([
      Promise.all(running.map(animation => animation.finished.catch(() => undefined))),
      new Promise(resolve => setTimeout(resolve, 400)),
    ]);
  });
}

async function setTheme(page: Page, theme: ThemeChoice, expectedDark?: boolean) {
  await page.getByLabel('Appearance').selectOption(theme);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await waitForThemeSettled(page, expectedDark ?? theme === 'dark');
}

async function expectNoSeriousAxeViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).analyze();
  const severe = results.violations.filter(
    violation => violation.impact === 'serious' || violation.impact === 'critical',
  );
  const summary = severe
    .map(
      v =>
        `${v.id} (${v.impact}): ${v.help} -> ${v.nodes
          .slice(0, 3)
          .map(node => node.target.join(' '))
          .join('; ')}`,
    )
    .join('\n');
  expect(severe, `Unexpected serious/critical axe violations on ${label}:\n${summary}`).toEqual([]);
}

async function auditAllThemes(page: Page, label: string) {
  await setTheme(page, 'light');
  await expectNoSeriousAxeViolations(page, `${label} (light)`);
  await setTheme(page, 'dark');
  await expectNoSeriousAxeViolations(page, `${label} (dark)`);
  await page.emulateMedia({ colorScheme: 'dark' });
  await setTheme(page, 'system', true);
  await expectNoSeriousAxeViolations(page, `${label} (system dark)`);
  await page.emulateMedia({ colorScheme: 'light' });
  await waitForThemeSettled(page, false);
  await expectNoSeriousAxeViolations(page, `${label} (system light)`);
  await setTheme(page, 'light');
}

function expectPrivateHeaders(response: APIResponse, label: string) {
  const headers = response.headers();
  expect(headers['cache-control'] || '', `${label}: Cache-Control no-store`).toMatch(/\bno-store\b/i);
  expect(headers['cdn-cache-control'] || '', `${label}: CDN-Cache-Control no-store`).toMatch(/\bno-store\b/i);
  expect(headers['vercel-cdn-cache-control'] || '', `${label}: Vercel-CDN-Cache-Control no-store`).toMatch(/\bno-store\b/i);
  expect(headers['x-robots-tag'] || '', `${label}: X-Robots-Tag noindex`).toMatch(/\bnoindex\b/i);
  expect(headers['referrer-policy'], `${label}: Referrer-Policy no-referrer`).toBe('no-referrer');
}

function resolveLocationPath(rawLocation: string | undefined, baseURL: string): string {
  expect(rawLocation, 'Expected Location header on 308 redirect').toBeTruthy();
  const parsed = new URL(rawLocation!, baseURL);
  expect(parsed.origin).toBe(new URL(baseURL).origin);
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

test('every legacy root query shape returns permanent HTTP 308 with exact Location and private headers', async ({ request, baseURL }) => {
  const originBase = baseURL || 'http://127.0.0.1:3103';

  const cases: Array<{ path: string; expectedLocation: string; label: string }> = [
    {
      path: '/?entry=fixture-010815-locomotive',
      expectedLocation: '/sessions/010815',
      label: 'legacy ?entry=<legacyId>',
    },
    {
      path: '/?entry=fixture-010815-locomotive&passage=3',
      expectedLocation: '/sessions/010815#p3',
      label: 'legacy ?entry=<legacyId>&passage=3',
    },
    {
      path: '/?entry=020604-LOCAL&passage=2',
      expectedLocation: '/sessions/020604-local#p2',
      label: 'legacy ?entry=<slug>&passage=2',
    },
    {
      path: '/?entry=fixture-010815-locomotive&passage=0',
      expectedLocation: '/sessions/010815',
      label: 'legacy ?entry= with invalid passage=0',
    },
    {
      path: '/?entry=fixture-010815-locomotive&passage=-3',
      expectedLocation: '/sessions/010815',
      label: 'legacy ?entry= with negative passage',
    },
    {
      path: '/?entry=fixture-010815-locomotive&passage=3&from=%2Fsearch%3Fq%3Dbridge',
      expectedLocation: '/sessions/010815?from=%2Fsearch%3Fq%3Dbridge#p3',
      label: 'legacy ?entry=&passage=&from= preserves validated from',
    },
    {
      path: '/?entry=fixture-010815-locomotive&from=https%3A%2F%2Fevil.example%2Fsearch',
      expectedLocation: '/sessions/010815',
      label: 'legacy ?entry= drops external from',
    },
    {
      path: '/?document=fixture-provenance-guide',
      expectedLocation: '/research/fixture-provenance-guide',
      label: 'legacy ?document=<id>',
    },
    {
      path: '/?document=FIXTURE-RESEARCH-NOTES',
      expectedLocation: '/research/fixture-research-notes',
      label: 'legacy uppercase ?document=<id>',
    },
    {
      path: '/?document=methods-and-audit',
      expectedLocation: '/research/methods-and-audit',
      label: 'legacy ?document=methods-and-audit',
    },
    {
      path: '/?marker=repetition&speaker=any',
      expectedLocation: '/search?marker=repetition&speaker=any',
      label: 'legacy ?marker=repetition&speaker=any',
    },
    {
      path: '/?marker=repetition&speaker=child',
      expectedLocation: '/search?marker=repetition',
      label: 'legacy ?marker=repetition&speaker=child',
    },
    {
      path: '/?marker=repetition',
      expectedLocation: '/search?marker=repetition',
      label: 'legacy ?marker=repetition alone',
    },
    {
      path: '/?marker=repetition&topic=Bogus',
      expectedLocation: '/search?marker=repetition',
      label: 'legacy ?marker= strips invalid topic before 308',
    },
    {
      path: '/?marker=repetition&topic=Play+and+imagination',
      expectedLocation: '/search?topic=Play+and+imagination&marker=repetition',
      label: 'legacy ?marker= preserves valid curated topic',
    },
    {
      path: '/?entry=fixture-010815-locomotive&document=fixture-provenance-guide&marker=repetition',
      expectedLocation: '/sessions/010815',
      label: 'precedence entry > document > marker',
    },
    {
      path: '/?document=fixture-provenance-guide&marker=repetition&speaker=any',
      expectedLocation: '/research/fixture-provenance-guide',
      label: 'precedence document > marker',
    },
  ];

  for (const tc of cases) {
    const res = await request.get(tc.path, { maxRedirects: 0 });
    expect(res.status(), `${tc.label}: HTTP 308`).toBe(308);
    expectPrivateHeaders(res, tc.label);
    expect(resolveLocationPath(res.headers()['location'], originBase), tc.label).toBe(tc.expectedLocation);
  }
});

test('browser navigation through legacy ?entry=, ?passage=, ?document=, and ?marker= lands on the new routes with expected content', async ({ page }) => {
  // 1. Legacy ?entry=&passage= lands on /sessions/<slug>#p3, highlights & focuses passage 3
  await page.goto('/?entry=fixture-010815-locomotive&passage=3');
  await expect(page).toHaveURL(/\/sessions\/010815#p3$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Blue locomotive and wooden bridge' })).toBeVisible();
  const passage3 = page.locator('#p3');
  await expect(passage3).toHaveClass(/\bis-linked\b/);
  await expect(passage3).toBeFocused();
  await expect(page.locator('.transcript-live-status')).toContainText('Showing transcript passage 3');

  // 2. Legacy ?entry=&passage=#access= replaces #access= with #p3 cleanly
  await page.goto('/?entry=fixture-010815-locomotive&passage=2#access=obsolete-family-key');
  await expect(page).toHaveURL(/\/sessions\/010815#p2$/);
  await expect(page.locator('#p2')).toHaveClass(/\bis-linked\b/);
  await expect(page.locator('#p2')).toBeFocused();

  // 3. Legacy ?entry=#access= redirects to /sessions/<slug> and strips #access=
  await page.goto('/?entry=fixture-020110-submarine#access=obsolete-family-key');
  await expect(page).toHaveURL(/\/sessions\/020110-tb$/);
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('');
  await expect(page.getByRole('heading', { level: 1, name: 'Yellow submarine in the courtyard' })).toBeVisible();

  // 4. Legacy ?document=#access= redirects to /research/<id> and strips #access=
  await page.goto('/?document=fixture-provenance-guide#access=obsolete-family-key');
  await expect(page).toHaveURL(/\/research\/fixture-provenance-guide$/);
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('');
  await expect(page.getByRole('heading', { level: 1, name: 'Fixture annotation provenance guide' })).toBeVisible();

  // 5. Legacy ?document=methods-and-audit lands on /research/methods-and-audit
  await page.goto('/?document=methods-and-audit');
  await expect(page).toHaveURL(/\/research\/methods-and-audit$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Sources and methods' })).toBeVisible();

  // 6. Legacy ?marker=repetition&speaker=any#access= lands on /search?marker=repetition&speaker=any with 3 matching sessions
  await page.goto('/?marker=repetition&speaker=any#access=obsolete-family-key');
  await expect(page).toHaveURL(/\/search\?marker=repetition&speaker=any$/);
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('');
  await expect(page.locator('details.linguistic-filters')).toHaveAttribute('open', '');
  await expect(page.getByLabel('Speaker for this marker')).toHaveValue('any');
  await expect(page.locator('.results-toolbar h2')).toHaveText('3 sessions');

  // 7. Legacy ?marker=repetition lands on /search?marker=repetition with default child-only scope (2 sessions)
  await page.goto('/?marker=repetition');
  await expect(page).toHaveURL(/\/search\?marker=repetition$/);
  await expect(page.locator('.results-toolbar h2')).toHaveText('2 sessions');
});

test('obsolete #access= fragment is stripped client-side on every page while preserving other fragments and never storing tokens', async ({ page }) => {
  // Strip bare #access= across every top-level route
  for (const route of [
    '/',
    '/sessions',
    '/sessions/010815',
    '/search?q=locomotive',
    '/research',
    '/research/fixture-provenance-guide',
    '/about',
  ]) {
    await page.goto(`${route}#access=obsolete-secret-token`);
    await expect.poll(() => page.evaluate(() => window.location.hash), `${route} strips #access=`).toBe('');
    expect(page.url()).not.toContain('obsolete-secret-token');
  }

  // Preserve non-access fragment on `/`
  await page.goto('/#main');
  await expect(page.getByRole('heading', { level: 1, name: /the seth tapes/i })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#main');

  // Preserve #inferred-ages and #access-and-analytics on `/about` (must not falsely strip #access-and-analytics!)
  await page.goto('/about#inferred-ages');
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#inferred-ages');

  await page.goto('/about#access-and-analytics');
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#access-and-analytics');

  // Strip #access= from compound fragment on `/about` while preserving target section anchor
  await page.goto('/about#access=obsolete-secret-token&how-to-cite');
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#how-to-cite');

  // Strip #access= from compound fragment on `/sessions/[id]` BEFORE hydration so #p3 activates immediately
  await page.goto('/sessions/010815#access=obsolete-secret-token&p3');
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#p3');
  await expect(page.locator('#p3')).toHaveClass(/\bis-linked\b/);
  await expect(page.locator('#p3')).toBeFocused();

  // Preserve #t=0:12 intact on `/sessions/[id]`
  await page.goto('/sessions/010815#t=0:12');
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#t=0:12');
  await expect(page.locator('.audio-time-readout')).toHaveText('0:12 / 0:36');

  // Live hashchange to #access= strips it, and #access=...&p4 activates #p4
  await page.evaluate(() => { window.location.hash = '#access=live-secret'; });
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('');

  await page.evaluate(() => { window.location.hash = '#access=live-secret&p4'; });
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#p4');
  await expect(page.locator('#p4')).toHaveClass(/\bis-linked\b/);
  await expect(page.locator('#p4')).toBeFocused();

  // Browser storage never captures obsolete access tokens or archive text
  const storageDump = await page.evaluate(() => ({
    local: Object.entries(window.localStorage),
    session: Object.entries(window.sessionStorage),
  }));
  const serialized = JSON.stringify(storageDump).toLowerCase();
  expect(serialized).not.toContain('obsolete-secret-token');
  expect(serialized).not.toContain('live-secret');
  expect(serialized).not.toContain('locomotive');
  expect(storageDump.session).toEqual([]);
});

test('unknown legacy ?entry= and ?document= IDs return HTTP 404 with private headers, helpful /search link, 320px reflow, and clean axe across themes', async ({ page, request }) => {
  // Unknown ?entry= HTTP status & headers
  const missingEntryApi = await request.get('/?entry=nonexistent-legacy-session', { maxRedirects: 0 });
  expect(missingEntryApi.status()).toBe(404);
  expectPrivateHeaders(missingEntryApi, '/?entry=nonexistent-legacy-session');
  const missingEntryHtml = await missingEntryApi.text();
  expect(missingEntryHtml).toContain('Session not found · The Seth Tapes');
  expect(missingEntryHtml).toMatch(/href="\/search"|\\"href\\":\\"\/search\\"/);

  // Unknown ?document= HTTP status & headers
  const missingDocApi = await request.get('/?document=nonexistent-legacy-document', { maxRedirects: 0 });
  expect(missingDocApi.status()).toBe(404);
  expectPrivateHeaders(missingDocApi, '/?document=nonexistent-legacy-document');
  const missingDocHtml = await missingDocApi.text();
  expect(missingDocHtml).toContain('Document not found · Research · The Seth Tapes');
  expect(missingDocHtml).toMatch(/href="\/search"|\\"href\\":\\"\/search\\"/);

  // Browser visit to unknown ?entry= with #access= strips hash, renders helpful 404, passes axe in all themes, and links to /search
  const entryNav = await page.goto('/?entry=nonexistent-legacy-session#access=obsolete-key');
  expect(entryNav?.status()).toBe(404);
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('');
  await expect(page).toHaveTitle('Session not found · The Seth Tapes');
  await expect(page.getByRole('heading', { level: 1, name: /This archive link could not be found/i })).toBeVisible();

  const searchLink = page.locator('.not-found-actions a[href="/search"]');
  await expect(searchLink).toBeVisible();
  await expect(searchLink).toHaveText(/Search the archive/i);

  // 320px narrow reflow has zero horizontal overflow
  await page.setViewportSize({ width: 320, height: 800 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 1280, height: 800 });

  await auditAllThemes(page, 'unknown legacy ?entry= 404');

  // Following the /search link lands on the working Search page
  await searchLink.click();
  await expect(page).toHaveURL(/\/search$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Search the archive' })).toBeVisible();

  // Browser visit to unknown ?document= renders helpful 404 and passes axe
  const docNav = await page.goto('/?document=nonexistent-legacy-document');
  expect(docNav?.status()).toBe(404);
  await expect(page).toHaveTitle('Document not found · Research · The Seth Tapes');
  await expect(page.getByRole('heading', { level: 1, name: /This archive link could not be found/i })).toBeVisible();
  await expect(page.locator('.not-found-actions a[href="/search"]')).toBeVisible();
  await auditAllThemes(page, 'unknown legacy ?document= 404');
});

test('build-output guard verifies / is dynamic with zero prerendered HTML and zero archive text leaks', async () => {
  const output = execFileSync(process.execPath, ['scripts/check-build-output.mjs'], {
    encoding: 'utf8',
  });
  const parsed = JSON.parse(output) as {
    ok: boolean;
    routesBuilt: string[];
    prerenderedRootHtmlPresent: boolean;
    prerenderedDynamicHtmlPresent: boolean;
    filesScanned: number;
    phrasesChecked: number;
    leaks: unknown[];
  };
  expect(parsed.ok).toBe(true);
  expect(parsed.routesBuilt).toContain('/page');
  expect(parsed.prerenderedRootHtmlPresent).toBe(false);
  expect(parsed.prerenderedDynamicHtmlPresent).toBe(false);
  expect(parsed.filesScanned).toBeGreaterThan(0);
  expect(parsed.leaks).toEqual([]);
});
