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

async function expectContinuousHeadingHierarchy(page: Page, label: string) {
  const headingLevels = await page.evaluate(() =>
    [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].map(el => Number(el.tagName.slice(1))),
  );
  expect(headingLevels.filter(level => level === 1), `${label}: single H1`).toHaveLength(1);
  expect(headingLevels[0], `${label}: starts with H1`).toBe(1);
  for (let i = 1; i < headingLevels.length; i += 1) {
    expect(
      headingLevels[i] - headingLevels[i - 1],
      `${label}: heading jump at index ${i} (${headingLevels.join(',')})`,
    ).toBeLessThanOrEqual(1);
  }
}

test('functional homepage / renders per request with private headers, search form, entry points, live counts, provenance, 320px reflow, and clean axe', async ({ page, request }) => {
  // Verify SSR HTML and private headers directly over HTTP
  const response = await request.get('/');
  expect(response.status()).toBe(200);
  expectPrivateHeaders(response, '/');
  const html = await response.text();
  expect(html).toContain('<title>The Seth Tapes</title>');
  expect(html).toContain('A childhood-language archive from the Peters/Wilson corpus');
  expect(html).toContain('action="/search"');
  expect(html).toContain('href="/sessions"');
  expect(html).toContain('href="/research"');
  expect(html).toContain('href="/about"');
  // Homepage SSR must not dump individual session titles or transcripts
  expect(html).not.toContain('Blue locomotive and wooden bridge');
  expect(html).not.toContain('where is the bridge');

  await page.goto('/');
  await expect(page).toHaveTitle('The Seth Tapes');
  await expect(page.getByRole('heading', { level: 1, name: 'The Seth Tapes', exact: true })).toBeVisible();
  await expect(page.locator('.masthead > p')).toHaveText('A childhood-language archive from the Peters/Wilson corpus');
  await expectContinuousHeadingHierarchy(page, '/');

  // Entry points: Browse by age -> /sessions, Research & context -> /research, Themes -> /search?topic=...
  const browseByAge = page.getByRole('link', { name: /Browse by age/i });
  await expect(browseByAge).toHaveAttribute('href', '/sessions');
  const researchEntry = page.locator('.home-entry-grid').getByRole('link', { name: /Research & context/i });
  await expect(researchEntry).toHaveAttribute('href', '/research');

  const themeLinks = page.locator('.theme-discovery .theme-shortcuts a');
  await expect(themeLinks).toHaveCount(8);
  await expect(themeLinks.filter({ hasText: 'Imagination' })).toHaveAttribute(
    'href',
    '/search?topic=Play%20and%20imagination',
  );
  await expect(themeLinks.filter({ hasText: 'Curiosity' })).toHaveAttribute(
    'href',
    '/search?topic=Learning%20and%20questions',
  );

  // Live collection counts and provenance summary linking to /about
  await expect(page.locator('.collection-note')).toContainText('4 sessions');
  await expect(page.locator('.collection-note')).toContainText('3 original recordings');
  await expect(page.locator('.source-key')).toContainText('2 archived research');
  await expect(page.locator('.source-key')).toContainText('1 TalkBank AI draft');
  await expect(page.locator('.source-key')).toContainText('1 local AI draft');
  await expect(page.locator('.source-key').getByRole('link', { name: /About sources, methods, and privacy/i })).toHaveAttribute('href', '/about');

  // Obsolete #access= fragment is stripped cleanly on /
  await page.goto('/#access=obsolete-key');
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('');

  // Verify 320px narrow viewport reflow has zero horizontal overflow
  await page.setViewportSize({ width: 320, height: 800 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 1280, height: 800 });

  await auditAllThemes(page, 'functional homepage /');

  // Submitting the single search form navigates directly to /search?q=... and returns matching sessions
  const searchBox = page.getByRole('searchbox', { name: 'Search the archive' });
  await searchBox.fill('locomotive');
  await Promise.all([
    page.waitForURL(/\/search\?q=locomotive$/),
    page.locator('.home-search-form').getByRole('button', { name: 'Search' }).click(),
  ]);
  await expect(page).toHaveURL(/\/search\?q=locomotive$/);
  await expect(page.locator('.results-toolbar h2')).toHaveText('2 sessions');

  // Return home and follow a theme link into /search?topic=...
  await page.goto('/');
  await page.locator('.theme-discovery .theme-shortcuts a').filter({ hasText: 'Imagination' }).click();
  await expect(page).toHaveURL(/\/search\?topic=Play(?:\+|%20)and(?:\+|%20)imagination$/);
  await expect(page.locator('.results-toolbar h2')).toHaveText('2 sessions');

  // Return home and follow Browse by age into /sessions
  await page.goto('/');
  await page.getByRole('link', { name: /Browse by age/i }).click();
  await expect(page).toHaveURL(/\/sessions$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Sessions' })).toBeVisible();
});

test('legacy query parameters on / still reach ArchiveApp until Ticket 15 redirects land', async ({ page }) => {
  // ?entry= -> Back to sessions preserves ?section=sessions and saved filters across reload
  await page.goto('/?entry=fixture-010815-locomotive');
  await expect(page.getByRole('heading', { level: 2, name: 'Blue locomotive and wooden bridge' })).toBeVisible();
  await page.getByRole('button', { name: /Back to sessions/i }).click();
  await expect(page).toHaveURL(/\/\?section=sessions$/);
  await expect(page.getByRole('heading', { level: 2, name: 'Find a session' })).toBeVisible();
  await page.getByLabel('Search sessions and transcripts').fill('submarine');
  await page.locator('.search-form').getByRole('button', { name: 'Search' }).click();
  await expect(page.locator('.results-toolbar h3')).toHaveText('1 session');
  await page.reload();
  await expect(page).toHaveURL(/\/\?section=sessions$/);
  await expect(page.getByRole('heading', { level: 2, name: 'Find a session' })).toBeVisible();
  await expect(page.getByLabel('Search sessions and transcripts')).toHaveValue('submarine');
  await expect(page.locator('.results-toolbar h3')).toHaveText('1 session');

  // ?entry=&passage=
  await page.goto('/?entry=fixture-010815-locomotive&passage=3');
  const passage3 = page.locator('#p3');
  await expect(passage3).toBeVisible();
  await expect(passage3).toHaveClass(/\bis-linked\b/);

  // ?document= -> Back to research & context preserves ?section=research across reload
  await page.goto('/?document=fixture-provenance-guide');
  await expect(page.locator('.document-detail > h2')).toHaveText('Fixture annotation provenance guide');
  await page.getByRole('button', { name: /Back to research & context/i }).click();
  await expect(page).toHaveURL(/\/\?section=research$/);
  await page.reload();
  await expect(page.getByRole('heading', { level: 2, name: 'Research & context' })).toBeVisible();

  // ?marker=&speaker= (any speaker matches 3 fixture sessions; clearing filters keeps ?section=sessions across reload)
  await page.goto('/?marker=repetition&speaker=any');
  await expect(page.locator('.results-toolbar h3')).toHaveText('3 sessions');
  await page.getByRole('button', { name: /Clear filters/i }).click();
  await expect(page).toHaveURL(/\/\?section=sessions$/);
  await expect(page.locator('.results-toolbar h3')).toHaveText('4 sessions');
  await page.reload();
  await expect(page.getByRole('heading', { level: 2, name: 'Find a session' })).toBeVisible();

  await page.goto('/?marker=repetition');
  await expect(page.locator('.results-toolbar h3')).toHaveText('2 sessions');

  // Empty legacy key (?entry=) and bare / still render the new functional homepage rather than legacy SPA
  await page.goto('/?entry=');
  await expect(page.locator('.home-search-form')).toHaveAttribute('action', '/search');
  await page.goto('/');
  await expect(page.locator('.home-search-form')).toHaveAttribute('action', '/search');
});

test('/sessions renders per request with private headers, year-of-age headings in youngest-first order, labelled inferred ages, and /sessions/<slug> links', async ({ page, request }) => {
  const response = await request.get('/sessions');
  expect(response.status()).toBe(200);
  expectPrivateHeaders(response, '/sessions');
  const html = await response.text();
  expect(html).toContain('<title>Sessions · The Seth Tapes</title>');
  expect(html).toContain('Age 1');
  expect(html).toContain('Age 2');
  expect(html).toContain('Age not recorded');
  expect(html).toContain('/sessions/010815');

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.goto('/sessions');
  await expect(page).toHaveTitle('Sessions · The Seth Tapes');
  await expect(page.getByRole('heading', { level: 1, name: 'Sessions', exact: true })).toBeVisible();
  await expectContinuousHeadingHierarchy(page, '/sessions');

  // Year-of-age group headings in chronological order, unaged last
  const groupHeadings = page.locator('.age-year-group h2');
  await expect(groupHeadings).toHaveText(['Age 1', 'Age 2', 'Age not recorded']);

  // Jump-to-age navigation links match the year-of-age sections with spaced VoiceOver accessible names
  const jumpLinks = page.locator('.age-jump-nav a');
  await expect(jumpLinks).toHaveCount(3);
  await expect(jumpLinks.nth(0)).toHaveAttribute('href', '#age-1');
  await expect(jumpLinks.nth(0)).toHaveAccessibleName('Age 1 1 session');
  await expect(jumpLinks.nth(1)).toHaveAttribute('href', '#age-2');
  await expect(jumpLinks.nth(1)).toHaveAccessibleName('Age 2 2 sessions');
  await expect(jumpLinks.nth(2)).toHaveAttribute('href', '#age-unrecorded');
  await expect(jumpLinks.nth(2)).toHaveAccessibleName('Age not recorded 1 session');

  // Top navigation count keeps an explicit space so VoiceOver never concatenates "Sessions4"
  await expect(page.locator('.section-nav a[href="/sessions"]')).toHaveAccessibleName('Sessions 4');

  // Sessions within each year group are youngest-first and link to /sessions/<slug>
  await expect(page.locator('#age-1 h3 a')).toHaveText(['Blue locomotive and wooden bridge']);
  await expect(page.locator('#age-1 h3 a').first()).toHaveAttribute('href', '/sessions/010815');

  await expect(page.locator('#age-2 h3 a')).toHaveText([
    'Yellow submarine in the courtyard',
    'Paper lighthouse and harbor bells',
  ]);
  await expect(page.locator('#age-2 h3 a').nth(0)).toHaveAttribute('href', '/sessions/020110-tb');
  await expect(page.locator('#age-2 h3 a').nth(1)).toHaveAttribute('href', '/sessions/020604-local');

  await expect(page.locator('#age-unrecorded h3 a')).toHaveText(['Cardboard observatory without audio']);
  await expect(page.locator('#age-unrecorded h3 a').first()).toHaveAttribute('href', '/sessions/011103');

  // Source ages have no inferred label; inferred ages show italicized "(inferred from filename)" with zero nested links
  const locomotiveMeta = page.locator('#age-1 .session-meta').first();
  await expect(locomotiveMeta).toContainText('Age 1 year, 8 months, 15 days');
  await expect(locomotiveMeta).not.toContainText('inferred from filename');

  const lighthouseCard = page.locator('#age-2 .session-card').nth(1);
  await expect(lighthouseCard.locator('.session-meta')).toContainText('Age 2 years, 6 months, 4 days (inferred from filename)');
  await expect(lighthouseCard.locator('.inferred-age-link em')).toHaveText('(inferred from filename)');
  await expect(lighthouseCard).toContainText('Unreviewed machine draft');

  const nestedLinks = await page.evaluate(() => document.querySelectorAll('a a, button a, a button').length);
  expect(nestedLinks).toBe(0);

  // Obsolete #access= fragment is stripped while normal #age-2 anchor stays intact
  await page.goto('/sessions#access=obsolete-key');
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('');
  await page.goto('/sessions#age-2');
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#age-2');

  // Clicking a session opens /sessions/<slug> and Back returns to /sessions
  await page.locator('#age-1 h3 a').first().click();
  await expect(page).toHaveURL(/\/sessions\/010815$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Blue locomotive and wooden bridge' })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/sessions(?:#.*)?$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Sessions' })).toBeVisible();

  expect(consoleErrors, `Unexpected console errors: ${consoleErrors.join('; ')}`).toEqual([]);
  expect(pageErrors, `Unexpected page errors: ${pageErrors.join('; ')}`).toEqual([]);
});

test('/sessions preserves Details/List preference via VIEW_STORAGE_KEY, filters by transcript origin with Back/Forward, passes 320px reflow, and is axe-clean across themes', async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.goto('/sessions');

  const detailsButton = page.getByRole('button', { name: 'Details', exact: true });
  const listButton = page.getByRole('button', { name: 'List', exact: true });
  const originSelect = page.getByLabel('Transcript origin');
  const status = page.locator('.sessions-browse-status');

  await expect(detailsButton).toHaveAttribute('aria-pressed', 'true');
  await expect(status).toHaveText('Showing all 4 sessions across 3 age groups, youngest first');

  // Switch to List view via keyboard Enter and verify VIEW_STORAGE_KEY persistence across reload (with zero archive text in storage)
  await listButton.focus();
  await expect(listButton).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(listButton).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.sessions-compact-list')).toHaveCount(3);

  const storedView = await page.evaluate(() => window.localStorage.getItem('balloons-and-bananas:recordings-view'));
  expect(storedView).toBe('list');

  const storageDump = await page.evaluate(() => ({
    local: Object.entries(window.localStorage),
    session: Object.entries(window.sessionStorage),
  }));
  const serializedStorage = JSON.stringify(storageDump).toLowerCase();
  expect(serializedStorage).not.toContain('locomotive');
  expect(serializedStorage).not.toContain('lighthouse');
  expect(storageDump.session).toEqual([]);

  await page.reload();
  await expect(listButton).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.sessions-compact-list')).toHaveCount(3);

  // Audit List view in 320px reflow and across all themes
  await page.setViewportSize({ width: 320, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 1280, height: 800 });
  await auditAllThemes(page, '/sessions (List view)');

  // Switch back to Details and verify storage updates
  await detailsButton.click();
  await expect(detailsButton).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.sessions-detail-list')).toHaveCount(3);
  expect(await page.evaluate(() => window.localStorage.getItem('balloons-and-bananas:recordings-view'))).toBe('details');

  // Explicitly clicking Details when storage holds a stale 'list' value overwrites storage so reload stays Details
  await page.evaluate(() => window.localStorage.setItem('balloons-and-bananas:recordings-view', 'list'));
  await detailsButton.click();
  expect(await page.evaluate(() => window.localStorage.getItem('balloons-and-bananas:recordings-view'))).toBe('details');
  await page.reload();
  await expect(detailsButton).toHaveAttribute('aria-pressed', 'true');

  // Transcript origin filter updates DOM, live status, and URL, and supports Back/Forward
  await originSelect.selectOption('archived_research');
  await expect(page).toHaveURL(/\/sessions\?origin=archived_research$/);
  await expect(status).toHaveText('Showing 2 of 4 sessions (archived research) across 2 age groups, youngest first');
  await expect(page.locator('.age-year-group h2')).toHaveText(['Age 1', 'Age not recorded']);
  await expect(page.locator('.age-year-group h3 a')).toHaveText([
    'Blue locomotive and wooden bridge',
    'Cardboard observatory without audio',
  ]);

  await originSelect.selectOption('local_ai_draft');
  await expect(page).toHaveURL(/\/sessions\?origin=local_ai_draft$/);
  await expect(status).toHaveText('Showing 1 of 4 sessions (local AI draft) across 1 age group, youngest first');
  await expect(page.locator('.age-year-group h2')).toHaveText(['Age 2']);
  await expect(page.locator('.age-year-group h3 a')).toHaveText(['Paper lighthouse and harbor bells']);

  // Back restores archived_research; Forward restores local_ai_draft
  await page.goBack();
  await expect(page).toHaveURL(/\/sessions\?origin=archived_research$/);
  await expect(originSelect).toHaveValue('archived_research');
  await expect(page.locator('.age-year-group h3 a')).toHaveText([
    'Blue locomotive and wooden bridge',
    'Cardboard observatory without audio',
  ]);

  await page.goForward();
  await expect(page).toHaveURL(/\/sessions\?origin=local_ai_draft$/);
  await expect(originSelect).toHaveValue('local_ai_draft');
  await expect(page.locator('.age-year-group h3 a')).toHaveText(['Paper lighthouse and harbor bells']);

  // Clicking a filtered session and pressing Back preserves the filtered /sessions?origin= view
  await page.locator('.age-year-group h3 a').first().click();
  await expect(page).toHaveURL(/\/sessions\/020604-local$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/sessions\?origin=local_ai_draft$/);
  await expect(originSelect).toHaveValue('local_ai_draft');
  await expect(page.locator('.age-year-group h3 a')).toHaveText(['Paper lighthouse and harbor bells']);

  // Show all origins button clears filter cleanly
  await page.getByRole('button', { name: 'Show all origins' }).click();
  await expect(page).toHaveURL(/\/sessions$/);
  await expect(originSelect).toHaveValue('');
  await expect(status).toHaveText('Showing all 4 sessions across 3 age groups, youngest first');

  // Direct SSR load with valid ?origin= and with invalid ?origin=
  await page.goto('/sessions?origin=talkbank_ai_draft');
  await expect(originSelect).toHaveValue('talkbank_ai_draft');
  await expect(page.locator('.age-year-group h3 a')).toHaveText(['Yellow submarine in the courtyard']);

  await page.goto('/sessions?origin=not-a-valid-origin');
  await expect(originSelect).toHaveValue('');
  await expect(page.locator('.age-year-group h3 a')).toHaveCount(4);

  // Audit Details view in 320px reflow and across all themes
  await page.setViewportSize({ width: 320, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 1280, height: 800 });
  await auditAllThemes(page, '/sessions (Details view)');

  expect(consoleErrors, `Unexpected console errors: ${consoleErrors.join('; ')}`).toEqual([]);
  expect(pageErrors, `Unexpected page errors: ${pageErrors.join('; ')}`).toEqual([]);
});

test('build-output check proves /, /sessions, and /sessions/[id] are dynamic with zero prerendered HTML or archive leaks', async () => {
  const output = execFileSync(process.execPath, ['scripts/check-build-output.mjs'], {
    encoding: 'utf8',
  });
  const parsed = JSON.parse(output) as {
    ok: boolean;
    routesBuilt: string[];
    prerenderedRootHtmlPresent: boolean;
    prerenderedSessionsBrowseHtmlPresent: boolean;
    prerenderedSessionHtmlPresent: boolean;
    filesScanned: number;
    phrasesChecked: number;
    leaks: unknown[];
  };
  expect(parsed.ok).toBe(true);
  expect(parsed.routesBuilt).toEqual(
    expect.arrayContaining(['/page', '/sessions/page', '/sessions/[id]/page']),
  );
  expect(parsed.prerenderedRootHtmlPresent).toBe(false);
  expect(parsed.prerenderedSessionsBrowseHtmlPresent).toBe(false);
  expect(parsed.prerenderedSessionHtmlPresent).toBe(false);
  expect(parsed.filesScanned).toBeGreaterThan(0);
  expect(parsed.phrasesChecked).toBeGreaterThanOrEqual(10);
  expect(parsed.leaks).toEqual([]);
});
