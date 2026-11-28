import { execFileSync } from 'node:child_process';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIResponse, type Page } from '@playwright/test';
import { setTheme, waitForThemeSettled } from './helpers/theme';

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

  // Entry points: Browse by age -> /sessions, Themes -> /search?topic=..., Research & methods -> /research + /about
  const browseByAge = page.getByRole('link', { name: /Browse by age/i });
  await expect(browseByAge).toHaveAttribute('href', '/sessions');
  const researchEntry = page.locator('.home-entry-grid').getByRole('link', { name: /Research & methods/i });
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

  // Live collection counts and one-paragraph provenance summary linking to /about
  await expect(page.locator('.source-key')).toContainText('4 sessions');
  await expect(page.locator('.source-key')).toContainText('3 original recordings');
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

test('legacy query parameters on / permanently redirect while empty params render the homepage', async ({ page }) => {
  // ?entry= permanently redirects to /sessions/<slug>
  await page.goto('/?entry=fixture-010815-locomotive');
  await expect(page).toHaveURL(/\/sessions\/010815$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Blue locomotive and wooden bridge' })).toBeVisible();

  // ?entry=&passage= permanently redirects to /sessions/<slug>#pN
  await page.goto('/?entry=fixture-010815-locomotive&passage=3');
  await expect(page).toHaveURL(/\/sessions\/010815#p3$/);
  const passage3 = page.locator('#p3');
  await expect(passage3).toBeVisible();
  await expect(passage3).toHaveClass(/\bis-linked\b/);

  // ?document= permanently redirects to /research/<id>
  await page.goto('/?document=fixture-provenance-guide');
  await expect(page).toHaveURL(/\/research\/fixture-provenance-guide$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Fixture annotation provenance guide' })).toBeVisible();

  // ?marker=&speaker= permanently redirects to /search?...
  await page.goto('/?marker=repetition&speaker=any');
  await expect(page).toHaveURL(/\/search\?marker=repetition&speaker=any$/);
  await expect(page.locator('.results-toolbar h2')).toHaveText('3 sessions');

  await page.goto('/?marker=repetition');
  await expect(page).toHaveURL(/\/search\?marker=repetition$/);
  await expect(page.locator('.results-toolbar h2')).toHaveText('2 sessions');

  // Legacy ?section=sessions|recordings|research redirect permanently to real routes
  await page.goto('/?section=sessions');
  await expect(page).toHaveURL(/\/sessions$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Sessions', exact: true })).toBeVisible();

  await page.goto('/?section=recordings');
  await expect(page).toHaveURL(/\/sessions$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Sessions', exact: true })).toBeVisible();

  await page.goto('/?section=research');
  await expect(page).toHaveURL(/\/research$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Research & context', exact: true })).toBeVisible();

  // Empty legacy key (?entry=) and bare / render the homepage directly
  await page.goto('/?entry=');
  await expect(page.locator('.home-search-form')).toHaveAttribute('action', '/search');
  await page.goto('/');
  await expect(page.locator('.home-search-form')).toHaveAttribute('action', '/search');
});

test('/sessions renders per request with private headers, six-month age-band headings in youngest-first order, explicit source/inferred ages, and /sessions/<slug> links', async ({ page, request }) => {
  const response = await request.get('/sessions');
  expect(response.status()).toBe(200);
  expectPrivateHeaders(response, '/sessions');
  const html = await response.text();
  expect(html).toContain('<title>Sessions · The Seth Tapes</title>');
  expect(html).toContain('1;6–1;11');
  expect(html).toContain('2;0–2;5');
  expect(html).toContain('2;6–2;11');
  expect(html).toContain('Age unknown');
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

  // Six-month age-band headings in chronological order with session counts, Age unknown last
  const bandHeadings = page.locator('.age-band-group h2');
  await expect(bandHeadings).toHaveText([
    '1;6–1;11 — 1 session',
    '2;0–2;5 — 1 session',
    '2;6–2;11 — 1 session',
    'Age unknown — 1 session',
  ]);

  // Age-band navigator links match the six-month band sections with VoiceOver-friendly spaced accessible names
  const jumpLinks = page.locator('.age-jump-nav a');
  await expect(jumpLinks).toHaveCount(4);
  await expect(jumpLinks.nth(0)).toHaveAttribute('href', '#age-1-6');
  await expect(jumpLinks.nth(0)).toHaveAccessibleName('1;6–1;11 — 1 session');
  await expect(jumpLinks.nth(1)).toHaveAttribute('href', '#age-2-0');
  await expect(jumpLinks.nth(1)).toHaveAccessibleName('2;0–2;5 — 1 session');
  await expect(jumpLinks.nth(2)).toHaveAttribute('href', '#age-2-6');
  await expect(jumpLinks.nth(2)).toHaveAccessibleName('2;6–2;11 — 1 session');
  await expect(jumpLinks.nth(3)).toHaveAttribute('href', '#age-unknown');
  await expect(jumpLinks.nth(3)).toHaveAccessibleName('Age unknown — 1 session');

  // Top navigation keeps stable, identical labels across every route without shifting count badges
  await expect(page.locator('.section-nav a')).toHaveText([
    'Overview',
    'Sessions',
    'Search',
    'Research & context',
    'About & methods',
  ]);
  await expect(page.locator('.section-nav a[href="/sessions"]')).toHaveAccessibleName('Sessions');
  await expect(page.locator('.section-nav .nav-count')).toHaveCount(0);

  // Sessions within each six-month band are youngest-first and link to /sessions/<slug>
  await expect(page.locator('#age-1-6 h3 a')).toHaveText(['Blue locomotive and wooden bridge']);
  await expect(page.locator('#age-1-6 h3 a').first()).toHaveAttribute('href', '/sessions/010815');

  await expect(page.locator('#age-2-0 h3 a')).toHaveText(['Yellow submarine in the courtyard']);
  await expect(page.locator('#age-2-0 h3 a').first()).toHaveAttribute('href', '/sessions/020110-tb');

  await expect(page.locator('#age-2-6 h3 a')).toHaveText(['Paper lighthouse and harbor bells']);
  await expect(page.locator('#age-2-6 h3 a').first()).toHaveAttribute('href', '/sessions/020604-local');

  await expect(page.locator('#age-unknown h3 a')).toHaveText(['Cardboard observatory without audio']);
  await expect(page.locator('#age-unknown h3 a').first()).toHaveAttribute('href', '/sessions/011103');

  // Source ages explicitly state "(source age)"; inferred ages show italicized "(inferred from filename)" with zero nested links
  const locomotiveMeta = page.locator('#age-1-6 .session-meta').first();
  await expect(locomotiveMeta).toContainText('Age 1 year, 8 months, 15 days (source age)');
  await expect(locomotiveMeta).not.toContainText('inferred from filename');

  const lighthouseCard = page.locator('#age-2-6 .session-card').first();
  await expect(lighthouseCard.locator('.session-meta')).toContainText('Age 2 years, 6 months, 4 days (inferred from filename)');
  await expect(lighthouseCard.locator('.inferred-age-link em')).toHaveText('(inferred from filename)');
  await expect(lighthouseCard).toContainText('Unreviewed machine draft');

  const nestedLinks = await page.evaluate(() => document.querySelectorAll('a a, button a, a button').length);
  expect(nestedLinks).toBe(0);

  // Obsolete #access= fragment is stripped while normal #age-2-0 anchor stays intact
  await page.goto('/sessions#access=obsolete-key');
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('');
  await page.goto('/sessions#age-2-0');
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#age-2-0');

  // Clicking a session opens /sessions/<slug> and Back returns to /sessions
  await page.locator('#age-1-6 h3 a').first().click();
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
  await expect(status).toHaveText('Showing all 4 sessions across 4 age bands, youngest first');

  // Switch to List view via keyboard Enter and verify VIEW_STORAGE_KEY persistence across reload (with zero archive text in storage)
  await listButton.focus();
  await expect(listButton).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(listButton).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.sessions-compact-list')).toHaveCount(4);

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
  await expect(page.locator('.sessions-compact-list')).toHaveCount(4);

  // Audit List view in 320px reflow and across all themes
  await page.setViewportSize({ width: 320, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 1280, height: 800 });
  await auditAllThemes(page, '/sessions (List view)');

  // Switch back to Details and verify storage updates
  await detailsButton.click();
  await expect(detailsButton).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.sessions-detail-list')).toHaveCount(4);
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
  await expect(status).toHaveText('Showing 2 of 4 sessions (archived research) across 2 age bands, youngest first');
  await expect(page.locator('.age-band-group h2')).toHaveText([
    '1;6–1;11 — 1 session',
    'Age unknown — 1 session',
  ]);
  await expect(page.locator('.age-band-group h3 a')).toHaveText([
    'Blue locomotive and wooden bridge',
    'Cardboard observatory without audio',
  ]);

  await originSelect.selectOption('local_ai_draft');
  await expect(page).toHaveURL(/\/sessions\?origin=local_ai_draft$/);
  await expect(status).toHaveText('Showing 1 of 4 sessions (local AI draft) across 1 age band, youngest first');
  await expect(page.locator('.age-band-group h2')).toHaveText(['2;6–2;11 — 1 session']);
  await expect(page.locator('.age-band-group h3 a')).toHaveText(['Paper lighthouse and harbor bells']);

  // Back restores archived_research; Forward restores local_ai_draft
  await page.goBack();
  await expect(page).toHaveURL(/\/sessions\?origin=archived_research$/);
  await expect(originSelect).toHaveValue('archived_research');
  await expect(page.locator('.age-band-group h3 a')).toHaveText([
    'Blue locomotive and wooden bridge',
    'Cardboard observatory without audio',
  ]);

  await page.goForward();
  await expect(page).toHaveURL(/\/sessions\?origin=local_ai_draft$/);
  await expect(originSelect).toHaveValue('local_ai_draft');
  await expect(page.locator('.age-band-group h3 a')).toHaveText(['Paper lighthouse and harbor bells']);

  // Clicking a filtered session and pressing Back preserves the filtered /sessions?origin= view
  await page.locator('.age-band-group h3 a').first().click();
  await expect(page).toHaveURL(/\/sessions\/020604-local$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/sessions\?origin=local_ai_draft$/);
  await expect(originSelect).toHaveValue('local_ai_draft');
  await expect(page.locator('.age-band-group h3 a')).toHaveText(['Paper lighthouse and harbor bells']);

  // Show all origins button clears filter cleanly
  await page.getByRole('button', { name: 'Show all origins' }).click();
  await expect(page).toHaveURL(/\/sessions$/);
  await expect(originSelect).toHaveValue('');
  await expect(status).toHaveText('Showing all 4 sessions across 4 age bands, youngest first');

  // Direct SSR load with valid ?origin= and with invalid ?origin=
  await page.goto('/sessions?origin=talkbank_ai_draft');
  await expect(originSelect).toHaveValue('talkbank_ai_draft');
  await expect(page.locator('.age-band-group h3 a')).toHaveText(['Yellow submarine in the courtyard']);

  await page.goto('/sessions?origin=not-a-valid-origin');
  await expect(originSelect).toHaveValue('');
  await expect(page.locator('.age-band-group h3 a')).toHaveCount(4);

  // Audit Details view in 320px reflow and across all themes
  await page.setViewportSize({ width: 320, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 1280, height: 800 });
  await auditAllThemes(page, '/sessions (Details view)');

  expect(consoleErrors, `Unexpected console errors: ${consoleErrors.join('; ')}`).toEqual([]);
  expect(pageErrors, `Unexpected page errors: ${pageErrors.join('; ')}`).toEqual([]);
});

test('RouteHeader navigation links remain identical in labels and stable in width across every route', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const expectedLabels = ['Overview', 'Sessions', 'Search', 'Research & context', 'About & methods'];
  const routes = [
    '/',
    '/sessions',
    '/sessions/010815',
    '/search',
    '/research',
    '/research/fixture-provenance-guide',
    '/about',
  ];

  let baselineNavWidth: number | null = null;
  let baselineSessionsWidth: number | null = null;

  for (const route of routes) {
    await page.goto(route);
    const navLinks = page.locator('.section-nav a');
    await expect(navLinks, `${route}: nav link labels`).toHaveText(expectedLabels);
    await expect(page.locator('.section-nav .nav-count'), `${route}: no shifting nav count`).toHaveCount(0);

    const widths = await page.evaluate(() => {
      const links = [...document.querySelectorAll<HTMLAnchorElement>('.section-nav a')];
      const sessionsLink = links.find(link => link.getAttribute('href') === '/sessions');
      if (!sessionsLink) throw new Error('Missing Sessions nav link');
      const firstRect = links[0].getBoundingClientRect();
      const lastRect = links[links.length - 1].getBoundingClientRect();
      return {
        sessionsWidth: sessionsLink.getBoundingClientRect().width,
        totalSpan: lastRect.right - firstRect.left,
      };
    });

    if (baselineSessionsWidth === null) {
      baselineSessionsWidth = widths.sessionsWidth;
      baselineNavWidth = widths.totalSpan;
    } else {
      // Allow <= 4px for active-route bolding (`font-weight: 650`) without shifting badges
      expect(
        Math.abs(widths.sessionsWidth - baselineSessionsWidth),
        `${route}: Sessions link width (${widths.sessionsWidth}) drifted from baseline (${baselineSessionsWidth})`,
      ).toBeLessThanOrEqual(4);
      expect(
        Math.abs(widths.totalSpan - baselineNavWidth!),
        `${route}: navbar total span (${widths.totalSpan}) drifted from baseline (${baselineNavWidth})`,
      ).toBeLessThanOrEqual(8);
    }
  }
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
