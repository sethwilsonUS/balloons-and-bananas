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

test('view=concordance renders a semantic age-ordered table with exact columns, provenance, inferred ages, #p<N> deep links, 320px reflow, and clean axe across themes', async ({ page, request }) => {
  // SSR headers, privacy-safe title (never exposing query), and zero archive text in SSR HTML
  const url = '/search?q=locomotive&view=concordance';
  const ssrRes = await request.get(url);
  expect(ssrRes.status()).toBe(200);
  expectPrivateHeaders(ssrRes, url);
  const ssrHtml = await ssrRes.text();
  expect(ssrHtml).toContain('<title>Concordance · The Seth Tapes</title>');
  expect(ssrHtml).not.toMatch(/<title>[^<]*locomotive/i);
  expect(ssrHtml).not.toContain('Blue locomotive and wooden bridge');
  expect(ssrHtml).not.toContain('Paper lighthouse and harbor bells');

  await page.goto(url);
  await expect(page).toHaveTitle('Concordance · The Seth Tapes');
  await expect(page.getByRole('button', { name: 'Concordance', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.results-toolbar h2')).toHaveText('3 matching passages');
  await expect(page.locator('.search-status')).toHaveText('1–3 of 3 matching passages');

  // Glossary compliance: "KWIC" must never appear in visible UI copy
  const bodyText = await page.locator('main').innerText();
  expect(bodyText).not.toMatch(/\bKWIC\b/i);

  // Semantic table structure for VoiceOver table navigation
  const region = page.getByRole('region', { name: 'Concordance table' });
  await expect(region).toHaveAttribute('tabindex', '0');

  const table = region.locator('table.concordance-table');
  await expect(table).toBeVisible();
  const caption = table.locator('caption');
  await expect(caption).toContainText('3 passages across 2 sessions');
  await expect(caption).toContainText('ordered by child age');

  const colHeaders = table.locator('thead th[scope="col"]');
  await expect(colHeaders).toHaveText([
    'Session',
    'Age',
    'Speaker',
    'Left context',
    'Match',
    'Right context',
  ]);

  const bodyRows = table.locator('tbody tr');
  await expect(bodyRows).toHaveCount(3);

  // Row 1: 010815 passage 1 (age 1;08.15, archived research, CHI)
  const row1 = bodyRows.nth(0);
  await expect(row1.locator('th[scope="row"]')).toContainText('010815, passage 1');
  await expect(row1.locator('th[scope="row"]')).toContainText('Archived research');
  await expect(row1.locator('td').nth(0)).toHaveText('1 year, 8 months, 15 days');
  await expect(row1.locator('td').nth(1)).toHaveText('Child (CHI, target child)');
  await expect(row1.locator('td').nth(2)).toHaveText('blue [/] blue');
  await expect(row1.locator('td').nth(3).locator('mark')).toHaveText('locomotive');
  await expect(row1.locator('td').nth(4)).toHaveText('!');

  // Row 2: 010815 passage 2 (same age, passage 2, Parent FAT)
  const row2 = bodyRows.nth(1);
  await expect(row2.locator('th[scope="row"]')).toContainText('010815, passage 2');
  await expect(row2.locator('td').nth(1)).toHaveText('Parent (FAT, father)');
  await expect(row2.locator('td').nth(2)).toHaveText('where does the');
  await expect(row2.locator('td').nth(3).locator('mark')).toHaveText('locomotive');
  await expect(row2.locator('td').nth(4)).toHaveText('go next ?');

  // Row 3: 020604-local passage 3 (inferred age 2;06.04, unreviewed local AI draft, unidentified speaker)
  const row3 = bodyRows.nth(2);
  await expect(row3.locator('th[scope="row"]')).toContainText('020604-local, passage 3');
  await expect(row3.locator('th[scope="row"]')).toContainText('Local AI draft (unreviewed)');
  await expect(row3.locator('td').nth(0)).toContainText('2 years, 6 months, 4 days');
  await expect(row3.locator('td').nth(0)).toContainText('(inferred from filename)');
  await expect(row3.locator('td').nth(0).locator('a.inferred-age-link')).toHaveAttribute('href', '/about#inferred-ages');
  await expect(row3.locator('td').nth(1)).toHaveText('Unidentified');
  await expect(row3.locator('td').nth(2)).toHaveText('Can the blue');
  await expect(row3.locator('td').nth(3).locator('mark')).toHaveText('locomotive');
  await expect(row3.locator('td').nth(4)).toHaveText('meet the ferry at the pier?');

  // Each row links to /sessions/<slug>?from=...#p<N>, and following the link highlights #p3 and returns cleanly
  const row3Link = row3.locator('th[scope="row"] a');
  const rawHref = await row3Link.getAttribute('href');
  expect(rawHref).toBeTruthy();
  const parsedUrl = new URL(rawHref!, 'http://localhost');
  expect(parsedUrl.pathname).toBe('/sessions/020604-local');
  expect(parsedUrl.hash).toBe('#p3');
  expect(parsedUrl.searchParams.get('from')).toBe('/search?q=locomotive&view=concordance');

  await row3Link.click();
  await expect(page).toHaveURL(/\/sessions\/020604-local\?from=%2Fsearch%3Fq%3Dlocomotive%26view%3Dconcordance#p3$/);
  await expect(page.locator('#p3')).toHaveClass(/\bis-linked\b/);
  const backToResults = page.locator('nav[aria-label="In this session"]').getByRole('link', { name: 'Back to results' });
  await expect(backToResults).toHaveAttribute('href', '/search?q=locomotive&view=concordance');

  await backToResults.click();
  await expect(page).toHaveURL(/\/search\?q=locomotive&view=concordance$/);
  await expect(page.locator('table.concordance-table tbody tr')).toHaveCount(3);

  // Zero browser storage leaks and never clobbers browse view preference with 'concordance'
  const storageDump = await page.evaluate(() => ({
    local: Object.entries(window.localStorage),
    session: Object.entries(window.sessionStorage),
  }));
  const serializedStorage = JSON.stringify(storageDump).toLowerCase();
  expect(serializedStorage).not.toContain('locomotive');
  expect(serializedStorage).not.toContain('concordance');
  expect(storageDump.session).toEqual([]);

  // 320px narrow viewport reflow has no page-level horizontal overflow (table scrolls inside its own container)
  await page.setViewportSize({ width: 320, height: 800 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 1280, height: 800 });

  // Respect prefers-reduced-motion and pass axe across light, dark, and system themes
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expectNoSeriousAxeViolations(page, 'concordance (reduced motion)');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await auditAllThemes(page, '/search?q=locomotive&view=concordance');
});

test('concordance explains why empty queries are unavailable, excludes guide-only hits, and restores state across Back/Forward', async ({ page }) => {
  await page.goto('/search?view=concordance');
  await expect(page).toHaveTitle('Concordance · The Seth Tapes');
  await expect(page.locator('.results-toolbar h2')).toHaveText('Concordance');
  await expect(page.locator('.search-status')).toHaveText('Enter a search query to view a concordance.');
  await expect(page.locator('table.concordance-table')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 3, name: 'Enter an exact search query for a concordance' })).toBeVisible();

  await auditAllThemes(page, '/search?view=concordance (empty query)');

  // Focus search box button moves focus straight to the search input
  await page.getByRole('button', { name: 'Focus search box' }).click();
  await expect(page.getByLabel('Search sessions and transcripts')).toBeFocused();

  // Switch to Details view works directly from the empty-query guidance
  await page.getByRole('button', { name: 'Switch to Details view' }).click();
  await expect(page).toHaveURL(/\/search$/);
  await expect(page.locator('.results-toolbar h2')).toHaveText('4 sessions');

  // Browser Back returns to empty concordance view
  await page.goBack();
  await expect(page).toHaveURL(/\/search\?view=concordance$/);
  await expect(page.getByRole('heading', { level: 3, name: 'Enter an exact search query for a concordance' })).toBeVisible();

  // Guide-only phrase ("wooden track") produces 0 concordance rows (never guide or semantic hits)
  const searchInput = page.getByLabel('Search sessions and transcripts');
  await searchInput.fill('wooden track');
  await page.locator('.search-form').getByRole('button', { name: 'Search' }).click();
  await expect(page).toHaveURL(/\/search\?q=wooden\+track&view=concordance$/);
  await expect(page.locator('.results-toolbar h2')).toHaveText('0 matching passages');
  await expect(page.locator('.search-status')).toHaveText('0 matching passages');
  await expect(page.locator('table.concordance-table')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 3, name: 'No exact transcript matches found' })).toBeVisible();

  // View in Details finds the guide match
  await page.getByRole('button', { name: 'View in Details' }).click();
  await expect(page).toHaveURL(/\/search\?q=wooden\+track$/);
  await expect(page.locator('.results-toolbar h2')).toHaveText('1 session');

  // Switch to a transcript match in Details -> Concordance -> Back restores Details
  await searchInput.fill('locomotive');
  await page.locator('.search-form').getByRole('button', { name: 'Search' }).click();
  await expect(page).toHaveURL(/\/search\?q=locomotive$/);
  await expect(page.locator('.results-toolbar h2')).toHaveText('2 sessions');

  await page.getByRole('button', { name: 'Concordance', exact: true }).click();
  await expect(page).toHaveURL(/\/search\?q=locomotive&view=concordance$/);
  await expect(page.locator('.results-toolbar h2')).toHaveText('3 matching passages');

  await page.goBack();
  await expect(page).toHaveURL(/\/search\?q=locomotive$/);
  await expect(page.getByRole('button', { name: 'Details', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.results-toolbar h2')).toHaveText('2 sessions');
});

test('origin, speaker, age-range, and linguistic marker filters apply to concordance rows, including exact CHAT notation queries', async ({ page }) => {
  await page.goto('/search?q=locomotive&view=concordance');
  const rows = page.locator('table.concordance-table tbody tr');
  await expect(rows).toHaveCount(3);

  // Speaker filter: Seth (CHI) only excludes Parent (FAT) and unidentified Local AI draft
  await page.getByLabel('Speaker', { exact: true }).selectOption('child');
  await expect(page).toHaveURL(/\/search\?q=locomotive&speaker=child&view=concordance$/);
  await expect(rows).toHaveCount(1);
  await expect(rows.nth(0).locator('th[scope="row"]')).toContainText('010815, passage 1');

  // Restore Any speaker / unidentified
  await page.getByLabel('Speaker', { exact: true }).selectOption('any');
  await expect(page).toHaveURL(/\/search\?q=locomotive&view=concordance$/);
  await expect(rows).toHaveCount(3);

  // Transcript origin filter
  await page.getByLabel('Transcript origin').selectOption('local_ai_draft');
  await expect(page).toHaveURL(/\/search\?q=locomotive&origin=local_ai_draft&view=concordance$/);
  await expect(rows).toHaveCount(1);
  await expect(rows.nth(0).locator('th[scope="row"]')).toContainText('020604-local, passage 3');

  // Clear origin and apply age-range filter (24+ months includes inferred age 2;06.04 and excludes 1;08.15)
  await page.getByLabel('Transcript origin').selectOption('');
  await expect(rows).toHaveCount(3);
  await page.getByLabel('From age').selectOption('24');
  await expect(page).toHaveURL(/\/search\?q=locomotive&ageMin=24&view=concordance$/);
  await expect(rows).toHaveCount(1);
  await expect(rows.nth(0).locator('th[scope="row"]')).toContainText('020604-local, passage 3');

  // Clear age filter and apply linguistic marker filter (Question mark defaults to CHI -> 0; Any speaker -> 2 passages)
  await page.getByLabel('From age').selectOption('');
  await expect(rows).toHaveCount(3);
  await page.locator('details.linguistic-filters > summary').click();
  await page.getByRole('button', { name: 'Question mark', exact: true }).click();
  await expect(page).toHaveURL(/\/search\?q=locomotive&marker=question&view=concordance$/);
  await expect(page.getByLabel('Speaker', { exact: true })).toHaveValue('child');
  await expect(page.locator('.results-toolbar h2')).toHaveText('0 matching passages');

  await page.getByLabel('Speaker', { exact: true }).selectOption('any');
  await expect(page).toHaveURL(/\/search\?q=locomotive&marker=question&speaker=any&view=concordance$/);
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).locator('th[scope="row"]')).toContainText('010815, passage 2');
  await expect(rows.nth(1).locator('th[scope="row"]')).toContainText('020604-local, passage 3');

  // Switching to Repetition notation intersects at the passage level -> only 010815#p1
  await page.getByRole('button', { name: 'Repetition notation', exact: true }).click();
  await expect(page).toHaveURL(/\/search\?q=locomotive&marker=repetition&speaker=any&view=concordance$/);
  await expect(rows).toHaveCount(1);
  await expect(rows.nth(0).locator('th[scope="row"]')).toContainText('010815, passage 1');

  // Exact CHAT notation query [/] spans all three sessions with unaged session sorted last
  await page.goto('/search?q=%5B%2F%5D&view=concordance');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0).locator('th[scope="row"]')).toContainText('010815, passage 1');
  await expect(rows.nth(1).locator('th[scope="row"]')).toContainText('020110-tb, passage 1');
  await expect(rows.nth(1).locator('th[scope="row"]')).toContainText('TalkBank AI draft (unreviewed)');
  await expect(rows.nth(2).locator('th[scope="row"]')).toContainText('011103, passage 3');
  await expect(rows.nth(2).locator('td').nth(0)).toHaveText('Not recorded');
});

test('concordance paginates with total count, cancels in-flight requests cleanly, handles malformed responses, validates /api/concordance, and leaks zero archive text in build output', async ({ page, request, baseURL }) => {
  const makeMockRows = (startIndex: number, count: number) =>
    Array.from({ length: count }, (_, idx) => {
      const n = startIndex + idx;
      return {
        sessionId: `fixture-010815-locomotive`,
        sessionSlug: `010815`,
        sessionTitle: 'Blue locomotive and wooden bridge',
        sourceName: '010815.cha',
        origin: 'archived_research' as const,
        ages: ['1;08.15'],
        inferredAge: null,
        passageNumber: n,
        speaker: 'Child (CHI, target child)',
        start: n,
        leftContext: `turn ${n} blue`,
        match: 'locomotive',
        rightContext: 'on the bridge .',
      };
    });

  await page.route('**/api/concordance', async route => {
    const body = JSON.parse(route.request().postData() || '{}') as { page?: number };
    const currentPage = body.page === 2 ? 2 : 1;
    const total = 65;
    const pageSize = 50;
    const rows = currentPage === 1 ? makeMockRows(1, 50) : makeMockRows(51, 15);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        rows,
        total,
        sessionCount: 4,
        page: currentPage,
        pages: 2,
        pageSize,
      }),
    });
  });

  await page.goto('/search?q=locomotive&view=concordance');
  await expect(page.locator('.results-toolbar h2')).toHaveText('65 matching passages');
  await expect(page.locator('.search-status')).toHaveText('1–50 of 65 matching passages · page 1 of 2');
  await expect(page.locator('table.concordance-table caption')).toContainText('showing passages 1–50 of 65 across 4 sessions (page 1 of 2)');
  await expect(page.locator('table.concordance-table tbody tr')).toHaveCount(50);

  // Navigate to Page 2
  const pagination = page.locator('nav[aria-label="Concordance result pages"]');
  await expect(pagination).toContainText('Page 1 of 2');
  await pagination.getByRole('button', { name: 'Next' }).click();
  await expect(page).toHaveURL(/\/search\?q=locomotive&view=concordance&page=2$/);
  await expect(page.locator('.search-status')).toHaveText('51–65 of 65 matching passages · page 2 of 2');
  await expect(page.locator('table.concordance-table caption')).toContainText('showing passages 51–65 of 65 across 4 sessions (page 2 of 2)');
  await expect(page.locator('table.concordance-table tbody tr')).toHaveCount(15);
  await expect(page.locator('.results-toolbar h2')).toBeFocused();

  // Browser Back restores Page 1
  await page.goBack();
  await expect(page).toHaveURL(/\/search\?q=locomotive&view=concordance$/);
  await expect(page.locator('.search-status')).toHaveText('1–50 of 65 matching passages · page 1 of 2');
  await expect(page.locator('table.concordance-table tbody tr')).toHaveCount(50);
  await page.unroute('**/api/concordance');

  // Synchronized cancellation test: switch Details -> Concordance (held) -> Details and prove abort
  await page.goto('/search?q=locomotive');
  await expect(page.locator('.results-toolbar h2')).toHaveText('2 sessions');

  let releaseSlowConcordance = () => {};
  let concordanceIntercepted = false;
  let concordanceRequest: import('@playwright/test').Request | null = null;
  let concordanceAborted = false;
  let concordanceFulfilled = false;
  const onRequestFailed = (req: import('@playwright/test').Request) => {
    if (concordanceRequest && req === concordanceRequest) {
      concordanceAborted = true;
    }
  };
  page.on('requestfailed', onRequestFailed);

  await page.route('**/api/concordance', async route => {
    concordanceIntercepted = true;
    concordanceRequest = route.request();
    await new Promise<void>(resolve => { releaseSlowConcordance = resolve; });
    try {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ rows: [], total: 0, sessionCount: 0, page: 1, pages: 1, pageSize: 50 }),
      });
      concordanceFulfilled = true;
    } catch {
      // Expected when the cancelled request aborts before fulfillment.
    }
  });

  await page.getByRole('button', { name: 'Concordance', exact: true }).click();
  await expect(page.locator('.search-status')).toHaveText('Updating view…');
  await expect.poll(() => concordanceIntercepted).toBe(true);

  await page.getByRole('button', { name: 'Details', exact: true }).click();
  await expect.poll(() => concordanceAborted).toBe(true);
  await expect(page.locator('.results-toolbar h2')).toHaveText('2 sessions');
  await expect(page.locator('table.concordance-table')).toHaveCount(0);
  releaseSlowConcordance();
  expect(concordanceFulfilled).toBe(false);

  page.off('requestfailed', onRequestFailed);
  await page.unroute('**/api/concordance');

  // Malformed 200 payload from /api/concordance renders error panel, hides stale rows, and recovers on retry
  await page.route('**/api/concordance', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ total: 1, sessionCount: 1, page: 1, pages: 1, pageSize: 50, rows: [{}] }),
    });
  });

  await page.goto('/search?q=locomotive&view=concordance');
  await expect(page.locator('.error-panel')).toBeVisible();
  await expect(page.locator('table.concordance-table')).toHaveCount(0);

  await page.unroute('**/api/concordance');
  await page.getByRole('button', { name: 'Try search again' }).click();
  await expect(page.locator('.error-panel')).toHaveCount(0);
  await expect(page.locator('table.concordance-table tbody tr')).toHaveCount(3);

  // Direct /api/concordance HTTP boundary validation (403 foreign origin, 400 invalid inputs, 200 with private headers)
  const origin = new URL(baseURL!).origin;
  const foreignRes = await request.post('/api/concordance', {
    headers: { Origin: 'https://unrelated.invalid', 'Content-Type': 'application/json' },
    data: { query: 'locomotive' },
  });
  expect(foreignRes.status()).toBe(403);
  expectPrivateHeaders(foreignRes, '/api/concordance foreign origin');

  for (const invalidPayload of [
    { query: 42 },
    { origin: 'invalid' },
    { speaker: 'unknown' },
    { marker: 'fake' },
    { ageMin: -1 },
    { ageMin: 30, ageMax: 20 },
    { pageSize: 18 },
  ]) {
    const res = await request.post('/api/concordance', {
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      data: invalidPayload,
    });
    expect(res.status(), `Expected 400 for ${JSON.stringify(invalidPayload)}`).toBe(400);
    expectPrivateHeaders(res, `/api/concordance invalid ${JSON.stringify(invalidPayload)}`);
  }

  const okRes = await request.post('/api/concordance', {
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    data: { query: 'locomotive' },
  });
  expect(okRes.status()).toBe(200);
  expectPrivateHeaders(okRes, '/api/concordance valid');
  const okBody = await okRes.json() as { total: number; rows: Array<{ sessionSlug: string; passageNumber: number }> };
  expect(okBody.total).toBe(3);
  expect(okBody.rows.map(r => `${r.sessionSlug}#p${r.passageNumber}`)).toEqual([
    '010815#p1',
    '010815#p2',
    '020604-local#p3',
  ]);

  // Verify build output still has zero archive text leaks and zero prerendered dynamic HTML
  const output = execFileSync(process.execPath, ['scripts/check-build-output.mjs'], {
    encoding: 'utf8',
  });
  const parsed = JSON.parse(output) as {
    ok: boolean;
    routesBuilt: string[];
    prerenderedSearchHtmlPresent: boolean;
    prerenderedDynamicHtmlPresent: boolean;
    leaks: unknown[];
  };
  expect(parsed.ok).toBe(true);
  expect(parsed.routesBuilt).toContain('/search/page');
  expect(parsed.prerenderedSearchHtmlPresent).toBe(false);
  expect(parsed.prerenderedDynamicHtmlPresent).toBe(false);
  expect(parsed.leaks).toEqual([]);
});
