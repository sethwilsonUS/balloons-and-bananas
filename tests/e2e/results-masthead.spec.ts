import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { setTheme } from './helpers/theme';

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

async function auditBothThemes(page: Page, label: string) {
  await setTheme(page, 'light');
  await expectNoSeriousAxeViolations(page, `${label} (light)`);
  await setTheme(page, 'dark');
  await expectNoSeriousAxeViolations(page, `${label} (dark)`);
  await setTheme(page, 'light');
}

test('archive uses one name, displays the masthead subtitle, and sets descriptive per-view document titles', async ({ page, request }) => {
  // Initial SSR HTML title does not say "An unlisted collection"
  const rootRes = await request.get('/');
  expect(rootRes.status()).toBe(200);
  const html = await rootRes.text();
  expect(html).toContain('<title>The Seth Tapes</title>');
  expect(html).not.toContain('An unlisted collection');
  expect(html).not.toContain('Balloons &amp; Bananas');

  await page.goto('/');

  // Masthead name, subtitle, top-bar brand, and footer all present one name
  await expect(page.getByRole('heading', { level: 1, name: 'The Seth Tapes', exact: true })).toBeVisible();
  await expect(page.locator('.masthead > p')).toHaveText('A childhood-language archive from the Peters/Wilson corpus');
  await expect(page.locator('.brand-button')).toHaveText('The Seth Tapes');
  await expect(page.locator('.site-footer')).toContainText('The Seth Tapes');
  await expect(page.locator('body')).not.toContainText('Balloons & Bananas');
  await expect(page).toHaveTitle('The Seth Tapes');

  // Dedicated /sessions browse route
  await page.locator('.section-nav').getByRole('link', { name: /Sessions/i }).click();
  await expect(page).toHaveURL(/\/sessions$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Sessions' })).toBeVisible();
  await expect(page).toHaveTitle('Sessions · The Seth Tapes');

  // Search route (filtered) uses a descriptive title without leaking the raw query
  await page.goto('/search');
  await expect(page.getByRole('heading', { level: 1, name: 'Search the archive' })).toBeVisible();
  const archiveSearch = page.getByLabel('Search sessions and transcripts');
  await archiveSearch.fill('wooden track');
  await page.locator('.search-form').getByRole('button', { name: 'Search' }).click();
  await expect(page.locator('.results-toolbar h2')).toHaveText('1 session');
  await expect(page).toHaveTitle('Search results · The Seth Tapes');

  // Clicking a search card opens the dedicated /sessions/<slug> route with its canonical title
  await page.getByRole('link', { name: /Blue locomotive and wooden bridge/i }).click();
  await expect(page).toHaveURL(/\/sessions\/010815(?:\?.*)?$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Blue locomotive and wooden bridge' })).toBeVisible();
  await expect(page).toHaveTitle('Session 010815 (age 1;08.15) · The Seth Tapes');

  // Legacy ?entry= link permanently redirects to /sessions/<slug> with its canonical title
  await page.goto('/?entry=fixture-010815-locomotive');
  await expect(page).toHaveURL(/\/sessions\/010815$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Blue locomotive and wooden bridge' })).toBeVisible();
  await expect(page).toHaveTitle('Session 010815 (age 1;08.15) · The Seth Tapes');

  // Research & context route
  await page.goto('/research');
  await expect(page.getByRole('heading', { level: 1, name: 'Research & context' })).toBeVisible();
  await expect(page).toHaveTitle('Research & context · The Seth Tapes');

  // Document reader route sets "<Document title> · Research · The Seth Tapes"
  await page.getByRole('link', { name: 'Fixture annotation provenance guide' }).click();
  await expect(page).toHaveURL(/\/research\/fixture-provenance-guide$/);
  await expect(page.locator('.document-detail h1')).toHaveText('Fixture annotation provenance guide');
  await expect(page).toHaveTitle('Fixture annotation provenance guide · Research · The Seth Tapes');

  // Direct link to an unknown legacy session returns 404 with a clear not-found title
  const missingLegacyRes = await page.goto('/?entry=nonexistent-fixture-session');
  expect(missingLegacyRes?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1, name: /This archive link could not be found/i })).toBeVisible();
  await expect(page).toHaveTitle('Session not found · The Seth Tapes');
});

test('results view removes duplicated theme chip row while preserving overview shortcuts and Theme filter', async ({ page }) => {
  await page.goto('/');

  // Overview keeps its Browse by theme shortcuts linking to /search?topic=...
  const overviewShortcuts = page.locator('.theme-discovery .theme-shortcuts a');
  await expect(overviewShortcuts).toHaveCount(8);
  await expect(overviewShortcuts.filter({ hasText: 'Imagination' })).toHaveAttribute(
    'href',
    '/search?topic=Play%20and%20imagination',
  );

  // Search results route keeps the Theme select filter without duplicating the Browse by theme chip row
  await page.goto('/search');
  await expect(page.getByRole('heading', { level: 1, name: 'Search the archive' })).toBeVisible();

  // Duplicated Browse by theme chip row is gone from results
  await expect(page.locator('.browse-themes')).toHaveCount(0);
  await expect(page.locator('.browse-section .theme-shortcuts')).toHaveCount(0);

  // The Theme select filter remains present and works cleanly
  const themeSelect = page.getByLabel('Theme', { exact: true });
  await expect(themeSelect).toBeVisible();
  await themeSelect.selectOption('Play and imagination');
  await expect(page.locator('.results-toolbar h2')).toHaveText('2 sessions');

  // Changing the Theme select updates results cleanly
  await themeSelect.selectOption('Vision and access');
  await expect(page.locator('.results-toolbar h2')).toHaveText('1 session');
  await expect(page.getByRole('link', { name: /Cardboard observatory without audio/i })).toBeVisible();

  await auditBothThemes(page, 'results without duplicate theme chips');
});

test('excerpts do not repeat the card overview or concatenate titles, while moment and transcript excerpts still appear', async ({ page }) => {
  await page.goto('/search');
  const searchInput = page.getByLabel('Search sessions and transcripts');
  const submit = page.locator('.search-form').getByRole('button', { name: 'Search' });

  // 1. Overview-only hit ("wooden track" appears only in Blue locomotive's overview)
  await searchInput.fill('wooden track');
  await submit.click();
  await expect(page.locator('.results-toolbar h2')).toHaveText('1 session');
  const overviewCard = page.locator('.session-card').first();
  await expect(overviewCard.locator('.card-overview')).toContainText('wooden track');
  await expect(overviewCard.locator('.search-excerpt')).toHaveCount(0);

  // 2. Title-only hit ("Yellow submarine in the courtyard") never concatenates title text into an excerpt
  await searchInput.fill('Yellow submarine in the courtyard');
  await submit.click();
  await expect(page.locator('.results-toolbar h2')).toHaveText('1 session');
  const titleCard = page.locator('.session-card').first();
  await expect(titleCard.locator('h3')).toContainText('Yellow submarine in the courtyard');
  await expect(titleCard.locator('.search-excerpt')).toHaveCount(0);

  // 3. Moment-only hit ("periscope") shows the moment excerpt without repeating the overview or title
  await searchInput.fill('periscope');
  await submit.click();
  await expect(page.locator('.results-toolbar h2')).toHaveText('1 session');
  const momentCard = page.locator('.session-card').first();
  const momentExcerpt = momentCard.locator('.search-excerpt');
  await expect(momentExcerpt).toBeVisible();
  await expect(momentExcerpt.locator('.excerpt-label')).toHaveText('From the guide');
  await expect(momentExcerpt.locator('p')).toContainText('Submarine periscope check:');
  await expect(momentExcerpt.locator('p')).not.toContainText('Yellow submarine in the courtyard');
  await expect(momentExcerpt.locator('p')).not.toContainText('diving beneath garden stepping stones');

  // 4. Transcript-only hit ("morning ferry" matches Paper lighthouse via moment & transcript; "pier" is transcript-only)
  await searchInput.fill('pier');
  await submit.click();
  await expect(page.locator('.results-toolbar h2')).toHaveText('1 session');
  const transcriptCard = page.locator('.session-card').first();
  const transcriptExcerpt = transcriptCard.locator('.search-excerpt');
  await expect(transcriptExcerpt).toBeVisible();
  await expect(transcriptExcerpt.locator('.excerpt-label')).toHaveText('From the transcript');
  await expect(transcriptExcerpt.locator('p')).toContainText('meet the ferry at the pier');

  await auditBothThemes(page, 'results excerpts');
});

test('switching Details and List views never leaves a stale "Searching…" status, even with slow paginated responses', async ({ page }) => {
  await page.goto('/search');

  const status = page.locator('.search-status');
  const detailsButton = page.getByRole('button', { name: 'Details', exact: true });
  const listButton = page.getByRole('button', { name: 'List', exact: true });

  await expect(status).toHaveText('1–4 of 4 sessions');
  await expect(detailsButton).toHaveAttribute('aria-pressed', 'true');

  // Switching Details -> List -> Details with all results on page 1 never enters "Searching…"
  await listButton.click();
  await expect(listButton).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.sessions-compact-list')).toBeVisible();
  await expect(status).toHaveText('1–4 of 4 sessions');
  await expect(status).not.toContainText('Searching');

  await detailsButton.click();
  await expect(detailsButton).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.session-card').first()).toBeVisible();
  await expect(status).toHaveText('1–4 of 4 sessions');
  await expect(status).not.toContainText('Searching');

  // With an active query, switching Details <-> List never flashes or leaves "Searching…"
  await page.getByLabel('Search sessions and transcripts').fill('locomotive');
  await page.locator('.search-form').getByRole('button', { name: 'Search' }).click();
  await expect(status).toHaveText('1–2 of 2 sessions');

  await listButton.click();
  await expect(status).toHaveText('1–2 of 2 sessions');
  await expect(status).not.toContainText('Searching');

  await detailsButton.click();
  await expect(status).toHaveText('1–2 of 2 sessions');
  await expect(status).not.toContainText('Searching');

  // Simulate a large paginated archive (>18 items) with a slow List fetch and rapid List -> Details toggle
  await page.getByRole('button', { name: /Clear filters/i }).click();
  await expect(status).toHaveText('1–4 of 4 sessions');

  let releaseSlowList = () => {};
  let slowListStarted = false;
  const makeSyntheticResults = (count: number) => Array.from({ length: count }, (_, i) => ({
    session: {
      id: `fixture-010815-locomotive-${i + 1}`,
      slug: `0108${String(i + 1).padStart(2, '0')}`,
      legacyId: `fixture-010815-locomotive-${i + 1}`,
      sourceName: `0108${String(i + 1).padStart(2, '0')}.cha`,
      title: `Synthetic session ${i + 1}`,
      overview: 'Synthetic paginated session for view-switch testing.',
      origin: 'archived_research',
      topics: ['Play and imagination'],
      dates: ['1983-01-15'],
      ages: ['1;08.15'],
      inferredAge: null,
      recordings: [],
      preferredRecordingId: null,
    },
    excerpt: '',
    matchedIn: 'browse',
  }));

  await page.route('**/api/search', async route => {
    const body = JSON.parse(route.request().postData() || '{}') as { pageSize?: number; page?: number };
    const pageSize = body.pageSize === 36 ? 36 : 18;
    const total = 40;
    if (pageSize === 36 && !slowListStarted) {
      slowListStarted = true;
      await new Promise<void>(resolve => { releaseSlowList = resolve; });
    }
    try {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          total,
          page: 1,
          pages: Math.ceil(total / pageSize),
          pageSize,
          results: makeSyntheticResults(Math.min(pageSize, total)),
        }),
      });
    } catch {
      // Aborted in-flight request when switching back to Details before fulfillment.
    }
  });

  // Trigger a fresh search so the mocked 40-item Details page (18 items) loads
  await page.getByLabel('Transcript origin').selectOption('archived_research');
  await expect(status).toHaveText('1–18 of 40 sessions · page 1 of 3');

  // Switch Details -> List: while awaiting the 36-item response, status says "Updating view…" (never "Searching…")
  await listButton.click();
  await expect(status).toHaveText('Updating view…');
  await expect.poll(() => slowListStarted).toBe(true);

  // Rapidly switch back to Details before the slow List fetch resolves: cancels and restores settled status immediately
  await detailsButton.click();
  await expect(status).toHaveText('1–18 of 40 sessions · page 1 of 3');
  releaseSlowList();

  // Now switch Details -> List cleanly and verify settled List status
  await listButton.click();
  await expect(status).toHaveText('1–36 of 40 sessions · page 1 of 2');
  await expect(page.locator('.results-list')).toHaveAttribute('aria-busy', 'false');

  // Switching List -> Details settles immediately with zero refetch or "Searching…"
  await detailsButton.click();
  await expect(status).toHaveText('1–18 of 40 sessions · page 1 of 3');

  await page.unroute('**/api/search');
  await auditBothThemes(page, 'results view switching');
});

test('theme shortcut chips wrap into balanced rows with no single orphan chip across common viewport widths', async ({ page }) => {
  await page.goto('/');
  const chips = page.locator('.theme-discovery .theme-shortcuts a');
  await expect(chips).toHaveCount(8);

  const viewports = [
    { name: 'desktop 1440px', width: 1440, height: 900, expectedRows: [4, 4] },
    { name: 'desktop 1280px', width: 1280, height: 800, expectedRows: [4, 4] },
    { name: 'small desktop 1024px', width: 1024, height: 800, expectedRows: [4, 4] },
    { name: 'tablet 768px', width: 768, height: 900, expectedRows: [4, 4] },
    { name: 'mobile 375px', width: 375, height: 812, expectedRows: [2, 2, 2, 2] },
  ];

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const layout = await page.evaluate(() => {
      const links = [...document.querySelectorAll<HTMLAnchorElement>('.theme-discovery .theme-shortcuts a')];
      const rows = new Map<number, number>();
      let minHeight = Infinity;
      for (const link of links) {
        const rect = link.getBoundingClientRect();
        minHeight = Math.min(minHeight, rect.height);
        const existingKey = [...rows.keys()].find(top => Math.abs(top - rect.top) <= 6);
        const key = existingKey ?? Math.round(rect.top);
        rows.set(key, (rows.get(key) ?? 0) + 1);
      }
      const counts = [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, count]) => count);
      const overflowsX = document.documentElement.scrollWidth > document.documentElement.clientWidth;
      return { counts, minHeight, overflowsX };
    });

    expect(layout.counts, `Expected balanced rows at ${viewport.name}`).toEqual(viewport.expectedRows);
    expect(Math.min(...layout.counts), `No single orphan chip at ${viewport.name}`).toBeGreaterThanOrEqual(2);
    expect(layout.minHeight, `Accessible tap target height >= 44px at ${viewport.name}`).toBeGreaterThanOrEqual(44);
    expect(layout.overflowsX, `No horizontal overflow at ${viewport.name}`).toBe(false);
  }

  await page.setViewportSize({ width: 1280, height: 800 });
  await auditBothThemes(page, 'overview theme shortcuts');
});
