import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

type ThemeChoice = 'system' | 'light' | 'dark';

async function waitForThemeSettled(page: Page, expectedDark: boolean) {
  const expectedPaper = expectedDark ? 'rgb(24, 31, 26)' : 'rgb(247, 244, 237)';
  const expectedPaperLight = expectedDark ? 'rgb(34, 44, 36)' : 'rgb(252, 250, 245)';
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
    .toBe(expectedPaper);
  const shareButton = page.locator('.share-button');
  if (await shareButton.count()) {
    await expect
      .poll(() => shareButton.evaluate(el => getComputedStyle(el).backgroundColor))
      .toBe(expectedPaperLight);
  }
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
  const select = page.getByLabel('Appearance');
  await select.selectOption(theme);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  const isDark = expectedDark ?? theme === 'dark';
  await waitForThemeSettled(page, isDark);
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

async function auditBothThemes(page: Page, viewLabel: string) {
  await setTheme(page, 'light');
  await expectNoSeriousAxeViolations(page, `${viewLabel} (light)`);
  await setTheme(page, 'dark');
  await expectNoSeriousAxeViolations(page, `${viewLabel} (dark)`);
  await setTheme(page, 'light');
}

test('overview loads, theme toggle switches light/dark/system themes, and axe is clean', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1, name: /the seth tapes/i })).toBeVisible();
  await expect(page.locator('.source-key')).toContainText('4 sessions');
  await expect(page.locator('.source-key')).toContainText('3 original recordings');
  await expect(page.locator('.source-key')).toContainText('2 archived research');
  await expect(page.locator('.source-key')).toContainText('1 TalkBank AI draft');
  await expect(page.locator('.source-key')).toContainText('1 local AI draft');
  await expect(page.getByRole('link', { name: /Browse by age/i })).toHaveAttribute('href', '/sessions');
  await expect(page.locator('.source-key').getByRole('link', { name: /About sources, methods, and privacy/i })).toHaveAttribute('href', '/about');

  await setTheme(page, 'light');
  const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(lightBg).toBe('rgb(247, 244, 237)');
  await expectNoSeriousAxeViolations(page, 'overview (light)');

  await setTheme(page, 'dark');
  const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(darkBg).toBe('rgb(24, 31, 26)');
  await expectNoSeriousAxeViolations(page, 'overview (dark)');

  // Persisted theme survives reload
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByLabel('Appearance')).toHaveValue('dark');

  // System theme follows prefers-color-scheme
  await page.emulateMedia({ colorScheme: 'dark' });
  await setTheme(page, 'system', true);
  const systemDarkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(systemDarkBg).toBe('rgb(24, 31, 26)');
  await expectNoSeriousAxeViolations(page, 'overview (system dark)');

  await page.emulateMedia({ colorScheme: 'light' });
  await waitForThemeSettled(page, false);
  const systemLightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(systemLightBg).toBe('rgb(247, 244, 237)');
  await expectNoSeriousAxeViolations(page, 'overview (system light)');
});

test('search returns results and moves focus to the results heading', async ({ page }) => {
  await page.goto('/search');
  await expect(page.getByRole('heading', { level: 1, name: 'Search the archive' })).toBeVisible();

  const archiveSearch = page.getByLabel('Search sessions and transcripts');
  await archiveSearch.fill('locomotive');
  await page.locator('.search-form').getByRole('button', { name: 'Search' }).click();

  const resultsHeading = page.locator('.results-toolbar h2');
  await expect(resultsHeading).toHaveText('2 sessions');
  await expect(resultsHeading).toBeFocused();
  await expect(page.getByRole('link', { name: /Blue locomotive and wooden bridge/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /Paper lighthouse and harbor bells/i })).toBeVisible();

  await auditBothThemes(page, 'search results');

  // Submitting a second query updates results and moves focus to results heading
  await archiveSearch.fill('submarine');
  await page.locator('.search-form').getByRole('button', { name: 'Search' }).click();

  await expect(resultsHeading).toHaveText('1 session');
  await expect(resultsHeading).toBeFocused();
  await expect(page.getByRole('link', { name: /Yellow submarine in the courtyard/i })).toBeVisible();

  // Linguistic filter finds explicit CHI repetition notation
  await page.locator('.linguistic-filters > summary').click();
  await page.getByRole('button', { name: 'Repetition notation' }).click();
  await archiveSearch.fill('');
  await page.locator('.search-form').getByRole('button', { name: 'Search' }).click();
  await expect(resultsHeading).toHaveText('2 sessions');
  await expect(resultsHeading).toBeFocused();
  await expect(page.getByRole('link', { name: 'Blue locomotive and wooden bridge', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Cardboard observatory without audio', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /Read in the transcript: passage 1, Blue locomotive/i })).toBeVisible();
});

test('opening a session plays fixture audio without Blob, serves private downloads, and handles no-audio sessions', async ({ page, request }) => {
  await page.goto('/');
  await page.locator('.section-nav').getByRole('link', { name: /Sessions/i }).click();
  await expect(page).toHaveURL(/\/sessions$/);
  await expect(page.getByRole('link', { name: /Blue locomotive and wooden bridge/i })).toBeVisible();
  await page.getByRole('link', { name: /Blue locomotive and wooden bridge/i }).click();

  await expect(page).toHaveURL(/\/sessions\/010815$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Blue locomotive and wooden bridge' })).toBeVisible();
  await expect(page.locator('.detail-header')).toContainText('1 year, 8 months, 15 days');
  await expect(page.getByRole('heading', { level: 2, name: 'Moments' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 3, name: 'Crossing the cardboard bridge' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 3, name: 'Counting station lanterns' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Read in the transcript: Crossing the cardboard bridge/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Listen from/i })).toHaveCount(0);

  // Simpler reading view hides CHAT notation by default; toggling shows it
  const passage3 = page.locator('#p3');
  await expect(passage3).not.toContainText('[//]');
  await page.getByLabel('Show linguistic notation').check();
  await expect(passage3).toContainText('[//]');
  await expect(passage3).toContainText('Note: pointing toward the cardboard arch');

  // Fixture audio loads and decodes real synthetic MP3 audio without Vercel Blob
  const audioJsonPromise = page.waitForResponse(
    res => res.url().includes('/api/assets/fixture-audio-locomotive-mp3?json=1') && res.status() === 200,
  );
  await page.getByRole('button', { name: 'Play recording' }).click();
  const audioJsonRes = await audioJsonPromise;
  const audioJson = await audioJsonRes.json() as { url: string; expiresAt: number };
  expect(audioJson.url).toBe('/api/assets/fixture-audio-locomotive-mp3?local=1');

  const audioEl = page.locator('audio');
  await expect(audioEl).toHaveAttribute('src', '/api/assets/fixture-audio-locomotive-mp3?local=1');
  await expect.poll(() => audioEl.evaluate(el => (el as HTMLAudioElement).readyState)).toBeGreaterThanOrEqual(1);
  await expect.poll(() => audioEl.evaluate(el => (el as HTMLAudioElement).duration)).toBeGreaterThan(30);
  await expect.poll(() => audioEl.evaluate(el => (el as HTMLAudioElement).paused)).toBe(false);
  await expect.poll(() => audioEl.evaluate(el => (el as HTMLAudioElement).currentTime)).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: 'Forward 30 seconds' })).toBeEnabled();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect.poll(() => audioEl.evaluate(el => (el as HTMLAudioElement).paused)).toBe(true);

  // Verify Range streaming and private headers on local fixture audio and downloadable source
  const rangeRes = await request.get('/api/assets/fixture-audio-locomotive-mp3?local=1', {
    headers: { Range: 'bytes=0-1023' },
  });
  expect(rangeRes.status()).toBe(206);
  expect(rangeRes.headers()['cache-control']).toMatch(/\bno-store\b/i);
  expect(rangeRes.headers()['cdn-cache-control']).toMatch(/\bno-store\b/i);
  expect(rangeRes.headers()['x-robots-tag']).toMatch(/\bnoindex\b/i);
  expect(rangeRes.headers()['referrer-policy']).toBe('no-referrer');
  expect(rangeRes.headers()['content-range']).toMatch(/^bytes 0-1023\//);

  const downloadRes = await request.get('/api/assets/fixture-source-locomotive-cha?download=1');
  expect(downloadRes.status()).toBe(200);
  expect(downloadRes.headers()['cache-control']).toMatch(/\bno-store\b/i);
  expect(downloadRes.headers()['x-robots-tag']).toMatch(/\bnoindex\b/i);
  expect(downloadRes.headers()['referrer-policy']).toBe('no-referrer');
  expect(downloadRes.headers()['content-disposition']).toContain('attachment');
  expect(await downloadRes.text()).toContain('blue [/] blue locomotive');

  await auditBothThemes(page, 'session detail with audio');

  // Session with no audio renders clearly and passes axe
  await page.goto('/?entry=fixture-011103-observatory');
  await expect(page).toHaveURL(/\/sessions\/011103$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Cardboard observatory without audio' })).toBeVisible();
  await expect(page.getByText('The archive has a transcript for this session, but no corresponding recording.')).toBeVisible();
  await auditBothThemes(page, 'session detail without audio');
});

test('passage deep link (?entry=...&passage=3) redirects to /sessions/<slug>#p3, highlights and focuses passage 3, and supports notation toggle', async ({ page }) => {
  await page.goto('/?entry=fixture-010815-locomotive&passage=3');
  await expect(page).toHaveURL(/\/sessions\/010815#p3$/);

  const passage3 = page.locator('#p3');
  await expect(passage3).toBeVisible();
  await expect(passage3).toHaveClass(/\bis-linked\b/);
  await expect(passage3).toBeFocused();
  await expect(page.getByText('Showing transcript passage 3, with surrounding passages for context.')).toBeVisible();
  await page.getByLabel('Show linguistic notation').check();
  await expect(passage3).toContainText('where [//] where is the bridge (.) papa ?');

  await auditBothThemes(page, 'passage deep link');
});

test('research section and document reader render markdown tables and downloads with zero serious axe violations', async ({ page, request }) => {
  await page.goto('/research');

  await expect(page.getByRole('heading', { level: 1, name: 'Research & context' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Fixture annotation provenance guide' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Fixture research reading list' })).toBeVisible();
  await auditBothThemes(page, 'research section');

  // Open standalone document reader via card link
  await page.getByRole('link', { name: 'Fixture annotation provenance guide' }).click();
  await expect(page).toHaveURL(/\/research\/fixture-provenance-guide$/);
  const docHeading = page.locator('.document-detail h1');
  await expect(docHeading).toHaveText('Fixture annotation provenance guide');

  // Verify the markdown table has 3 intact columns including escaped pipe inside code span
  const table = page.locator('.document-detail .table-scroll table');
  await expect(table).toBeVisible();
  await expect(table.locator('thead th')).toHaveText(['Layer', 'Notation example', 'Provenance note']);
  await expect(table.locator('tbody tr')).toHaveCount(3);
  await expect(table.locator('tbody tr').nth(2).locator('td').nth(1)).toHaveText('plain text | JSON');

  // Verify downloadable document asset works with private headers
  const docDownloadLink = page.locator('.document-detail .document-downloads a').first();
  await expect(docDownloadLink).toHaveAttribute('href', '/api/assets/fixture-doc-provenance-md');
  const docAssetRes = await request.get('/api/assets/fixture-doc-provenance-md');
  expect(docAssetRes.status()).toBe(200);
  expect(docAssetRes.headers()['cache-control']).toMatch(/\bno-store\b/i);
  expect(docAssetRes.headers()['x-robots-tag']).toMatch(/\bnoindex\b/i);
  expect(await docAssetRes.text()).toContain('Fixture annotation provenance guide');

  await auditBothThemes(page, 'research document reader');
});
