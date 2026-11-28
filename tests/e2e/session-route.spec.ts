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

test('/sessions/[id] renders server-side per request with catalog record, title, moments, audio player, transcript, private headers, and clean axe across themes', async ({ page, request }) => {
  // Verify SSR HTML and private headers directly over HTTP
  const response = await request.get('/sessions/010815');
  expect(response.status()).toBe(200);
  expectPrivateHeaders(response, '/sessions/010815');
  const html = await response.text();
  expect(html).toContain('<title>Session 010815 (age 1;08.15) · The Seth Tapes</title>');
  expect(html).toContain('Blue locomotive and wooden bridge');
  expect(html).toContain('Crossing the cardboard bridge');

  // Visit in browser and check full page structure, heading order, and catalog record
  await page.goto('/sessions/010815');
  await expect(page).toHaveTitle('Session 010815 (age 1;08.15) · The Seth Tapes');
  await expect(page.getByRole('heading', { level: 1, name: 'Blue locomotive and wooden bridge' })).toBeVisible();

  const record = page.locator('dl.catalog-record');
  await expect(record).toBeVisible();
  await expect(record).toContainText('Session ID');
  await expect(record).toContainText('010815');
  await expect(record).toContainText('1 year, 8 months, 15 days');
  await expect(record).toContainText('1;08.15 · source age');
  await expect(record).not.toContainText('inferred from filename');
  await expect(record).toContainText('1983-01-15');
  await expect(record).toContainText('Archived research transcript');
  await expect(record).toContainText('Original MP3 · 0:36');
  await expect(record).toContainText('AI-written guide');
  await expect(record).toContainText('2 moments');

  // Verify section order: catalog record -> guide overview -> moments -> player -> transcript -> sources
  const sectionOrder = await page.evaluate(() => {
    const selectors = [
      'dl.catalog-record',
      '.guide-overview-section',
      '.moments-section',
      '.audio-panel',
      '.transcript-section',
      '.source-section',
    ];
    return selectors.map(selector => {
      const el = document.querySelector(selector);
      if (!el) throw new Error(`Missing ${selector}`);
      return el.getBoundingClientRect().top + window.scrollY;
    });
  });
  for (let i = 1; i < sectionOrder.length; i += 1) {
    expect(sectionOrder[i], `Section ${i} should follow section ${i - 1}`).toBeGreaterThan(sectionOrder[i - 1]);
  }

  // Verify heading hierarchy has a single H1 and no skipped levels
  const headingLevels = await page.evaluate(() =>
    [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].map(el => Number(el.tagName.slice(1))),
  );
  expect(headingLevels.filter(level => level === 1)).toHaveLength(1);
  expect(headingLevels[0]).toBe(1);
  for (let i = 1; i < headingLevels.length; i += 1) {
    expect(headingLevels[i] - headingLevels[i - 1], `Heading jump at index ${i}: ${headingLevels.join(',')}`).toBeLessThanOrEqual(1);
  }

  // Audio playback works directly on /sessions/010815
  await page.getByRole('button', { name: 'Play recording' }).click();
  const audioEl = page.locator('audio');
  await expect.poll(() => audioEl.evaluate(el => (el as HTMLAudioElement).paused)).toBe(false);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect.poll(() => audioEl.evaluate(el => (el as HTMLAudioElement).paused)).toBe(true);

  // Obsolete #access= fragment is stripped client-side while normal anchors stay intact
  await page.goto('/sessions/010815#access=obsolete-key');
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('');
  await page.goto('/sessions/010815#transcript-heading');
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#transcript-heading');

  // Verify 320px narrow reflow has no horizontal overflow
  await page.setViewportSize({ width: 320, height: 800 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 1280, height: 800 });

  await auditAllThemes(page, '/sessions/010815');
});

test('/sessions/[id] handles inferred ages, multiple recordings, unaged no-audio sessions, and canonical slug casing', async ({ page, request }) => {
  // TalkBank AI draft with WAV original + MP3 listening copy
  await page.goto('/sessions/020110-tb');
  await expect(page).toHaveTitle('Session 020110-tb (age 2;01.10) · The Seth Tapes');
  const tbRecord = page.locator('dl.catalog-record');
  await expect(tbRecord).toContainText('TalkBank AI draft');
  await expect(tbRecord).toContainText('Unreviewed machine draft');
  await expect(tbRecord).toContainText('MP3 listening copy · 0:18');
  await expect(tbRecord).toContainText('Original WAV · 0:01');

  // Local AI draft with inferred age (labelled & linked to methods) and no calendar date
  await page.goto('/sessions/020604-local');
  await expect(page).toHaveTitle('Session 020604-local (inferred age 2;06.04) · The Seth Tapes');
  const localRecord = page.locator('dl.catalog-record');
  await expect(localRecord).toContainText('2 years, 6 months, 4 days');
  await expect(localRecord).toContainText('(2;06.04)');
  const inferredLink = localRecord.getByRole('link', { name: /\(inferred from filename\)/i });
  await expect(inferredLink).toHaveAttribute('href', '/?document=methods-and-audit');
  await expect(localRecord.locator('dt', { hasText: /^Date$/ })).toHaveCount(0);
  await auditAllThemes(page, '/sessions/020604-local');

  // Unaged session with no associated recordings
  await page.goto('/sessions/011103');
  await expect(page).toHaveTitle('Session 011103 · The Seth Tapes');
  const unagedRecord = page.locator('dl.catalog-record');
  await expect(unagedRecord).toContainText('Not recorded');
  await expect(unagedRecord).toContainText('None associated (transcript only)');
  await auditAllThemes(page, '/sessions/011103');

  // Upper-case slug redirects to canonical lower-case slug with private headers
  const upperRes = await request.get('/sessions/020604-LOCAL', { maxRedirects: 0 });
  expect([307, 308]).toContain(upperRes.status());
  expect(upperRes.headers()['location']).toMatch(/\/sessions\/020604-local$/);
  expectPrivateHeaders(upperRes, '/sessions/020604-LOCAL redirect');
});

test('unknown /sessions/[id] returns HTTP 404 with private headers, helpful search link, and clean axe across themes', async ({ page, request }) => {
  const res = await request.get('/sessions/nonexistent-fixture-session');
  expect(res.status()).toBe(404);
  expectPrivateHeaders(res, '/sessions/nonexistent-fixture-session');

  const navRes = await page.goto('/sessions/nonexistent-fixture-session');
  expect(navRes?.status()).toBe(404);
  await expect(page).toHaveTitle('Session not found · The Seth Tapes');
  await expect(page.getByRole('heading', { level: 1, name: /This session could not be found/i })).toBeVisible();

  const searchLink = page.getByRole('link', { name: 'Search sessions' });
  await expect(searchLink).toBeVisible();
  await expect(searchLink).toHaveAttribute('href', '/?section=sessions');

  await auditAllThemes(page, '/sessions/nonexistent-fixture-session 404');

  // Following the search link lands on the archive search view
  await searchLink.click();
  await expect(page.getByRole('heading', { level: 2, name: 'Find a session' })).toBeVisible();
});

test('browse and search cards link to /sessions/<slug>, browser Back restores previous results, and browser storage holds no archive or query text', async ({ page }) => {
  await page.goto('/');

  // Search from overview -> 2 results for "locomotive"
  await page.getByRole('searchbox', { name: 'Search the archive' }).fill('locomotive');
  await page.locator('.home-search-form').getByRole('button', { name: 'Search' }).click();

  await expect(page.locator('.results-toolbar h3')).toHaveText('2 sessions');
  const firstCardLink = page.getByRole('link', { name: /Blue locomotive and wooden bridge/i });
  const secondCardLink = page.getByRole('link', { name: /Paper lighthouse and harbor bells/i });
  await expect(firstCardLink).toHaveAttribute('href', '/sessions/010815');
  await expect(secondCardLink).toHaveAttribute('href', '/sessions/020604-local');

  // Switch to List view and confirm list links also point to /sessions/<slug>
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await expect(page.locator('.sessions-compact-list a[href="/sessions/010815"]')).toBeVisible();
  await page.getByRole('button', { name: 'Details', exact: true }).click();

  // Navigate to /sessions/010815 via card link
  await firstCardLink.click();
  await expect(page).toHaveURL(/\/sessions\/010815$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Blue locomotive and wooden bridge' })).toBeVisible();

  // Confirm neither localStorage nor sessionStorage contains query text or archive text
  const storageDump = await page.evaluate(() => ({
    local: Object.entries(window.localStorage),
    session: Object.entries(window.sessionStorage),
  }));
  const serializedStorage = JSON.stringify(storageDump).toLowerCase();
  expect(serializedStorage).not.toContain('locomotive');
  expect(serializedStorage).not.toContain('wooden bridge');
  expect(serializedStorage).not.toContain('lighthouse');
  expect(storageDump.session).toEqual([]);

  // Browser Back returns to the previous "locomotive" search results
  await page.goBack();
  await expect(page).toHaveURL(/\/(?:\?.*)?$/);
  await expect(page.getByRole('heading', { level: 2, name: 'Find a session' })).toBeVisible();
  await expect(page.getByLabel('Search sessions and transcripts')).toHaveValue('locomotive');
  await expect(page.getByLabel('Sort by')).toHaveValue('relevance');
  await expect(page.locator('.results-toolbar h3')).toHaveText('2 sessions');
  await expect(page.getByRole('link', { name: /Blue locomotive and wooden bridge/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /Paper lighthouse and harbor bells/i })).toBeVisible();

  // Browse filters (theme + sort) also restore on browser Back after opening a session
  await page.getByRole('button', { name: /Clear filters/i }).click();
  await page.getByLabel('Theme', { exact: true }).selectOption('Play and imagination');
  await page.getByLabel('Sort by').selectOption('age-desc');
  await expect(page.locator('.results-toolbar h3')).toHaveText('2 sessions');
  const submarineLink = page.getByRole('link', { name: /Yellow submarine in the courtyard/i });
  await expect(submarineLink).toHaveAttribute('href', '/sessions/020110-tb');

  await submarineLink.click();
  await expect(page).toHaveURL(/\/sessions\/020110-tb$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Yellow submarine in the courtyard' })).toBeVisible();

  await page.goBack();
  await expect(page.getByRole('heading', { level: 2, name: 'Find a session' })).toBeVisible();
  await expect(page.getByLabel('Theme', { exact: true })).toHaveValue('Play and imagination');
  await expect(page.getByLabel('Sort by')).toHaveValue('age-desc');
  await expect(page.locator('.results-toolbar h3')).toHaveText('2 sessions');
});

test('build-output check proves no synthetic fixture phrases appear anywhere in .next/', async () => {
  const output = execFileSync(process.execPath, ['scripts/check-build-output.mjs'], {
    encoding: 'utf8',
  });
  const parsed = JSON.parse(output) as {
    ok: boolean;
    routeBuilt: string;
    prerenderedSessionHtmlPresent: boolean;
    filesScanned: number;
    phrasesChecked: number;
    leaks: unknown[];
  };
  expect(parsed.ok).toBe(true);
  expect(parsed.routeBuilt).toBe('/sessions/[id]/page');
  expect(parsed.prerenderedSessionHtmlPresent).toBe(false);
  expect(parsed.filesScanned).toBeGreaterThan(0);
  expect(parsed.phrasesChecked).toBeGreaterThanOrEqual(10);
  expect(parsed.leaks).toEqual([]);
});
