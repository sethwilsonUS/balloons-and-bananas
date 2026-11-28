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

test('/search renders per request with private headers, shared-URL restore, heading hierarchy, zero browser storage leaks, 320px reflow, and clean axe across themes', async ({ page, request }) => {
  // Unfiltered /search SSR headers, privacy-safe title, and zero leaked archive text
  const baseRes = await request.get('/search');
  expect(baseRes.status()).toBe(200);
  expectPrivateHeaders(baseRes, '/search');
  const baseHtml = await baseRes.text();
  expect(baseHtml).toContain('<title>Search · The Seth Tapes</title>');
  expect(baseHtml).not.toContain('Blue locomotive and wooden bridge');
  expect(baseHtml).not.toContain('Paper lighthouse and harbor bells');

  // Filtered /search?... SSR headers and query-free title
  const sharedUrl = '/search?q=locomotive&origin=local_ai_draft&ageMin=24&ageMax=35&view=list';
  const filteredRes = await request.get(sharedUrl);
  expect(filteredRes.status()).toBe(200);
  expectPrivateHeaders(filteredRes, sharedUrl);
  const filteredHtml = await filteredRes.text();
  expect(filteredHtml).toContain('<title>Search results · The Seth Tapes</title>');
  expect(filteredHtml).not.toMatch(/<title>[^<]*locomotive/i);

  // Invalid ?topic= emits the same unfiltered SSR title as client hydration (no title flip)
  const invalidTopicRes = await request.get('/search?topic=Nonexistent');
  expect(invalidTopicRes.status()).toBe(200);
  expectPrivateHeaders(invalidTopicRes, '/search?topic=Nonexistent');
  expect(await invalidTopicRes.text()).toContain('<title>Search · The Seth Tapes</title>');

  const validTopicRes = await request.get('/search?topic=Play+and+imagination');
  expect(validTopicRes.status()).toBe(200);
  expect(await validTopicRes.text()).toContain('<title>Search results · The Seth Tapes</title>');

  // Opening the shared URL directly restores every control and reproduces exact results
  await page.goto(sharedUrl);
  await expect(page).toHaveTitle('Search results · The Seth Tapes');
  await expect(page.getByRole('heading', { level: 1, name: 'Search the archive' })).toBeVisible();
  await expect(page.getByLabel('Search sessions and transcripts')).toHaveValue('locomotive');
  await expect(page.getByLabel('Transcript origin')).toHaveValue('local_ai_draft');
  await expect(page.getByLabel('From age')).toHaveValue('24');
  await expect(page.getByLabel('To age')).toHaveValue('35');
  await expect(page.getByLabel('Sort by')).toHaveValue('relevance');
  await expect(page.getByRole('button', { name: 'List', exact: true })).toHaveAttribute('aria-pressed', 'true');

  await expect(page.locator('.results-toolbar h2')).toHaveText('1 session');
  await expect(page.locator('.sessions-compact-list')).toBeVisible();
  await expect(page.getByRole('link', { name: /Paper lighthouse and harbor bells/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /Blue locomotive and wooden bridge/i })).toHaveCount(0);

  // Heading hierarchy: single H1, no skipped levels (h1 -> h2 -> h3)
  const headingLevels = await page.evaluate(() =>
    [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].map(el => Number(el.tagName.slice(1))),
  );
  expect(headingLevels.filter(level => level === 1)).toHaveLength(1);
  expect(headingLevels[0]).toBe(1);
  for (let i = 1; i < headingLevels.length; i += 1) {
    expect(headingLevels[i] - headingLevels[i - 1], `Heading jump at index ${i}: ${headingLevels.join(',')}`).toBeLessThanOrEqual(1);
  }

  // Browser storage never stores query or archive text
  const storageDump = await page.evaluate(() => ({
    local: Object.entries(window.localStorage),
    session: Object.entries(window.sessionStorage),
  }));
  const serializedStorage = JSON.stringify(storageDump).toLowerCase();
  expect(serializedStorage).not.toContain('locomotive');
  expect(serializedStorage).not.toContain('lighthouse');
  expect(storageDump.session).toEqual([]);

  // Obsolete #access= fragment is stripped client-side while preserving search params
  await page.goto('/search?q=locomotive#access=obsolete-key');
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('');
  await expect(page).toHaveURL(/\/search\?q=locomotive$/);
  await expect(page.locator('.results-toolbar h2')).toHaveText('2 sessions');

  // 320px narrow viewport reflow has no horizontal overflow
  await page.setViewportSize({ width: 320, height: 800 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 1280, height: 800 });

  await auditAllThemes(page, '/search?q=locomotive');
});

test('filter changes update the URL cleanly, empty query acts as filtered browsing, invalid params are ignored, and Back/Forward restore earlier states', async ({ page }) => {
  await page.goto('/search');
  const resultsHeading = page.locator('.results-toolbar h2');
  const cardLinks = page.locator('.session-card h3 a');

  // Empty /search browses all 4 sessions youngest-first (unaged last)
  await expect(resultsHeading).toHaveText('4 sessions');
  await expect(cardLinks).toHaveText([
    'Blue locomotive and wooden bridge',
    'Yellow submarine in the courtyard',
    'Paper lighthouse and harbor bells',
    'Cardboard observatory without audio',
  ]);
  await expect(page).toHaveTitle('Search · The Seth Tapes');

  // Step 1: Filter by Theme with empty query -> filtered browsing in URL
  await page.getByLabel('Theme', { exact: true }).selectOption('Play and imagination');
  await expect(page).toHaveURL(/\/search\?topic=Play\+and\+imagination$/);
  await expect(resultsHeading).toHaveText('2 sessions');
  await expect(page).toHaveTitle('Search results · The Seth Tapes');
  await expect(cardLinks).toHaveText([
    'Blue locomotive and wooden bridge',
    'Yellow submarine in the courtyard',
  ]);

  // Step 2: Add From age = 24 months (2;00)
  await page.getByLabel('From age').selectOption('24');
  await expect(page).toHaveURL(/\/search\?topic=Play\+and\+imagination&ageMin=24$/);
  await expect(resultsHeading).toHaveText('1 session');
  await expect(cardLinks).toHaveText(['Yellow submarine in the courtyard']);

  // Step 3: Switch to List view (URL gains view=list, no "Searching…")
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await expect(page).toHaveURL(/\/search\?topic=Play\+and\+imagination&ageMin=24&view=list$/);
  await expect(page.locator('.sessions-compact-list')).toBeVisible();
  await expect(page.locator('.search-status')).toHaveText('1–1 of 1 session');

  // Browser Back -> restores Details view with topic + ageMin
  await page.goBack();
  await expect(page).toHaveURL(/\/search\?topic=Play\+and\+imagination&ageMin=24$/);
  await expect(page.getByRole('button', { name: 'Details', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(resultsHeading).toHaveText('1 session');

  // Browser Back -> restores topic without ageMin
  await page.goBack();
  await expect(page).toHaveURL(/\/search\?topic=Play\+and\+imagination$/);
  await expect(page.getByLabel('From age')).toHaveValue('');
  await expect(resultsHeading).toHaveText('2 sessions');

  // Browser Back -> restores unfiltered /search
  await page.goBack();
  await expect(page).toHaveURL(/\/search$/);
  await expect(page.getByLabel('Theme', { exact: true })).toHaveValue('');
  await expect(resultsHeading).toHaveText('4 sessions');

  // Browser Forward twice -> restores topic + ageMin
  await page.goForward();
  await expect(page).toHaveURL(/\/search\?topic=Play\+and\+imagination$/);
  await expect(resultsHeading).toHaveText('2 sessions');

  await page.goForward();
  await expect(page).toHaveURL(/\/search\?topic=Play\+and\+imagination&ageMin=24$/);
  await expect(page.getByLabel('From age')).toHaveValue('24');
  await expect(resultsHeading).toHaveText('1 session');

  // Invalid URL parameters are cleanly ignored without errors
  await page.goto('/search?topic=Nonexistent&origin=bogus&sort=oldest&view=grid&page=-5&ageMin=abc&ageMax=999');
  await expect(resultsHeading).toHaveText('4 sessions');
  await expect(page.locator('.error-panel')).toHaveCount(0);
  await expect(page.getByLabel('Theme', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Transcript origin')).toHaveValue('');
  await expect(page.getByLabel('From age')).toHaveValue('');
  await expect(page.getByLabel('To age')).toHaveValue('');
  await expect(page.getByLabel('Sort by')).toHaveValue('age-asc');

  // Inverted age range in URL is safely ignored without failing
  await page.goto('/search?ageMin=30&ageMax=20');
  await expect(resultsHeading).toHaveText('4 sessions');
  await expect(page.locator('.error-panel')).toHaveCount(0);
  await expect(page.getByLabel('From age')).toHaveValue('');
  await expect(page.getByLabel('To age')).toHaveValue('');

  // Continuous typing across the debounce boundary never drops keystrokes or overwrites input
  await page.goto('/search');
  await expect(resultsHeading).toHaveText('4 sessions');
  const searchInput = page.getByLabel('Search sessions and transcripts');
  await searchInput.click();
  await searchInput.pressSequentially('loco', { delay: 30 });
  await expect(page).toHaveURL(/\/search\?q=loco$/);
  await searchInput.pressSequentially('motive', { delay: 55 });
  await expect(page).toHaveURL(/\/search\?q=locomotive$/);
  await expect(searchInput).toHaveValue('locomotive');
  await expect(resultsHeading).toHaveText('2 sessions');
});

test('age-range filter uses source-or-inferred age, excludes unaged sessions, composes with query/filters, and /api/search rejects invalid ages', async ({ page, request, baseURL }) => {
  const resultsHeading = page.locator('.results-toolbar h2');
  const cardLinks = page.locator('.session-card h3 a');

  // 2;00..2;11 (24..35) includes source age 2;01.10 and inferred age 2;06.04, excluding 1;08.15 and unaged 011103
  await page.goto('/search?ageMin=24&ageMax=35');
  await expect(resultsHeading).toHaveText('2 sessions');
  await expect(cardLinks).toHaveText([
    'Yellow submarine in the courtyard',
    'Paper lighthouse and harbor bells',
  ]);

  // Narrow To age to 2;05 (29 months) -> only Yellow submarine (2;01.10) matches
  await page.getByLabel('To age').selectOption('29');
  await expect(page).toHaveURL(/\/search\?ageMin=24&ageMax=29$/);
  await expect(resultsHeading).toHaveText('1 session');
  await expect(cardLinks).toHaveText(['Yellow submarine in the courtyard']);

  // Raising From age above To age (30 > 29) clears To age cleanly instead of creating an inverted range
  await page.getByLabel('From age').selectOption('30');
  await expect(page).toHaveURL(/\/search\?ageMin=30$/);
  await expect(page.getByLabel('To age')).toHaveValue('');
  await expect(resultsHeading).toHaveText('1 session');
  await expect(cardLinks).toHaveText(['Paper lighthouse and harbor bells']);

  // Combine ageMin with a text query ("locomotive") and submit
  await page.getByLabel('Search sessions and transcripts').fill('locomotive');
  await page.locator('.search-form').getByRole('button', { name: 'Search' }).click();
  await expect(page).toHaveURL(/\/search\?q=locomotive&ageMin=30$/);
  await expect(resultsHeading).toHaveText('1 session');
  await expect(resultsHeading).toBeFocused();
  await expect(cardLinks).toHaveText(['Paper lighthouse and harbor bells']);

  // Clear filters resets query, age range, and sort back to unfiltered /search
  await page.getByRole('button', { name: /Clear filters/i }).click();
  await expect(page).toHaveURL(/\/search$/);
  await expect(resultsHeading).toHaveText('4 sessions');
  await expect(page.getByLabel('From age')).toHaveValue('');
  await expect(page.getByLabel('Search sessions and transcripts')).toHaveValue('');

  // Verify /api/search rejects invalid and inverted age bounds with HTTP 400
  const origin = new URL(baseURL!).origin;
  for (const invalidPayload of [
    { ageMin: -1 },
    { ageMin: 241 },
    { ageMin: 1.5 },
    { ageMin: '24' },
    { ageMax: null },
    { ageMin: 30, ageMax: 20 },
  ]) {
    const res = await request.post('/api/search', {
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      data: invalidPayload,
    });
    expect(res.status(), `Expected 400 for ${JSON.stringify(invalidPayload)}`).toBe(400);
  }
  const ok = await request.post('/api/search', {
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    data: { ageMin: 24, ageMax: 30 },
  });
  expect(ok.status()).toBe(200);
  const body = await ok.json() as { results: Array<{ session: { slug: string } }> };
  expect(body.results.map(item => item.session.slug)).toEqual(['020110-tb', '020604-local']);
});

test('results link to /sessions/<slug> with #p<N> on transcript and linguistic passage hits and browser Back returns to /search', async ({ page }) => {
  // Transcript-only hit: "pier" occurs in passage 3 of Paper lighthouse (020604-local)
  await page.goto('/search?q=pier');
  await expect(page.locator('.results-toolbar h2')).toHaveText('1 session');
  const transcriptLink = page.getByRole('link', { name: /Paper lighthouse and harbor bells/i });
  const rawHref = await transcriptLink.getAttribute('href');
  expect(rawHref).toBeTruthy();
  const parsedTranscriptUrl = new URL(rawHref!, 'http://localhost');
  expect(parsedTranscriptUrl.pathname).toBe('/sessions/020604-local');
  expect(parsedTranscriptUrl.hash).toBe('#p3');
  expect(parsedTranscriptUrl.searchParams.get('from')).toBe('/search?q=pier');

  const excerpt = page.locator('.search-excerpt').first();
  await expect(excerpt.locator('.excerpt-label')).toHaveText('From the transcript');
  await expect(excerpt.locator('.excerpt-passage-tag')).toContainText('Passage 3');
  await expect(excerpt.locator('p')).toContainText('meet the ferry at the pier');

  // Following the link opens /sessions/020604-local#p3, highlights passage 3,
  // wires Ticket 10's sticky Back-to-results link back to /search?q=pier, and browser Back returns cleanly
  await transcriptLink.click();
  await expect(page).toHaveURL(/\/sessions\/020604-local\?from=%2Fsearch%3Fq%3Dpier#p3$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Paper lighthouse and harbor bells' })).toBeVisible();
  const passage3 = page.locator('#p3');
  await expect(passage3).toHaveClass(/\bis-linked\b/);
  const backToResults = page.locator('nav[aria-label="In this session"]').getByRole('link', { name: 'Back to results' });
  await expect(backToResults).toHaveAttribute('href', '/search?q=pier');

  await page.goBack();
  await expect(page).toHaveURL(/\/search\?q=pier$/);
  await expect(page.getByLabel('Search sessions and transcripts')).toHaveValue('pier');
  await expect(page.locator('.results-toolbar h2')).toHaveText('1 session');

  // Clicking sticky Back to results from the session page also returns straight to /search?q=pier
  await page.getByRole('link', { name: /Paper lighthouse and harbor bells/i }).click();
  await expect(page).toHaveURL(/\/sessions\/020604-local\?from=%2Fsearch%3Fq%3Dpier#p3$/);
  await page.locator('nav[aria-label="In this session"]').getByRole('link', { name: 'Back to results' }).click();
  await expect(page).toHaveURL(/\/search\?q=pier$/);
  await expect(page.getByLabel('Search sessions and transcripts')).toHaveValue('pier');
  await expect(page.locator('.results-toolbar h2')).toHaveText('1 session');

  // Guide-only hit: "wooden track" matches Blue locomotive's overview -> links to /sessions/010815 without #p hash
  await page.goto('/search?q=wooden+track');
  await expect(page.locator('.results-toolbar h2')).toHaveText('1 session');
  const guideHref = await page.getByRole('link', { name: /Blue locomotive and wooden bridge/i }).getAttribute('href');
  const parsedGuideUrl = new URL(guideHref!, 'http://localhost');
  expect(parsedGuideUrl.pathname).toBe('/sessions/010815');
  expect(parsedGuideUrl.hash).toBe('');
  expect(parsedGuideUrl.searchParams.get('from')).toBe('/search?q=wooden+track');

  // Linguistic marker URL auto-opens Linguistics panel and links passage examples to /sessions/<slug>#p<N>
  await page.goto('/search?marker=repetition');
  await expect(page.locator('details.linguistic-filters')).toHaveAttribute('open', '');
  await expect(page.locator('.results-toolbar h2')).toHaveText('2 sessions');

  const passageLink = page.getByRole('link', { name: /Read in the transcript: passage 1, Blue locomotive/i });
  const passageHref = await passageLink.getAttribute('href');
  const parsedPassageUrl = new URL(passageHref!, 'http://localhost');
  expect(parsedPassageUrl.pathname).toBe('/sessions/010815');
  expect(parsedPassageUrl.hash).toBe('#p1');
  expect(parsedPassageUrl.searchParams.get('from')).toBe('/search?marker=repetition');

  // Switching speaker scope updates URL and expands matches to TalkBank AI draft
  await page.getByLabel('Speaker for this marker').selectOption('any');
  await expect(page).toHaveURL(/\/search\?marker=repetition&speaker=any$/);
  await expect(page.locator('.results-toolbar h2')).toHaveText('3 sessions');
  const submarinePassageHref = await page.getByRole('link', { name: /Read in the transcript: passage 1, Yellow submarine/i }).getAttribute('href');
  const parsedSubmarineUrl = new URL(submarinePassageHref!, 'http://localhost');
  expect(parsedSubmarineUrl.pathname).toBe('/sessions/020110-tb');
  expect(parsedSubmarineUrl.hash).toBe('#p1');

  await auditAllThemes(page, '/search?marker=repetition&speaker=any');
});

test('in-flight search requests cancel cleanly on rapid view switches without stale Searching status and build output has zero leaks', async ({ page }) => {
  await page.goto('/search');
  const status = page.locator('.search-status');
  const detailsButton = page.getByRole('button', { name: 'Details', exact: true });
  const listButton = page.getByRole('button', { name: 'List', exact: true });
  await expect(status).toHaveText('1–4 of 4 sessions');

  let releaseSlowList = () => {};
  let slowListIntercepted = false;
  const makeSyntheticResults = (count: number) => Array.from({ length: count }, (_, i) => ({
    session: {
      id: `fixture-010815-locomotive-${i + 1}`,
      slug: `0108${String(i + 1).padStart(2, '0')}`,
      legacyId: `fixture-010815-locomotive-${i + 1}`,
      sourceName: `0108${String(i + 1).padStart(2, '0')}.cha`,
      title: `Synthetic session ${i + 1}`,
      overview: 'Synthetic paginated session for view-switch cancellation testing.',
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
    const currentPage = body.page === 2 ? 2 : 1;
    if (pageSize === 36 && !slowListIntercepted) {
      slowListIntercepted = true;
      await new Promise<void>(resolve => { releaseSlowList = resolve; });
    }
    try {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          total,
          page: currentPage,
          pages: Math.ceil(total / pageSize),
          pageSize,
          results: makeSyntheticResults(Math.min(pageSize, total - (currentPage - 1) * pageSize)),
        }),
      });
    } catch {
      // Expected when the cancelled request aborts before fulfillment.
    }
  });

  // Trigger a fresh search so the mocked 40-session Details page loads
  await page.getByLabel('Origin' , { exact: false }).selectOption('archived_research');
  await expect(status).toHaveText('1–18 of 40 sessions · page 1 of 3');

  // Switch Details -> List: wait until the route interceptor actually holds the slow request
  await listButton.click();
  await expect(status).toHaveText('Updating view…');
  await expect.poll(() => slowListIntercepted).toBe(true);

  // Switch back to Details before the slow List response arrives -> cancels and settles immediately
  await detailsButton.click();
  await expect(status).toHaveText('1–18 of 40 sessions · page 1 of 3');
  releaseSlowList();

  // Navigate to Page 2 -> URL updates with page=2; Browser Back restores Page 1
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(status).toHaveText('19–36 of 40 sessions · page 2 of 3');

  await page.goBack();
  await expect(page).not.toHaveURL(/page=2/);
  await expect(status).toHaveText('1–18 of 40 sessions · page 1 of 3');

  await page.unroute('**/api/search');

  // Verify scripts/check-build-output.mjs proves /search/page is built dynamically with 0 prerendered HTML & 0 leaks
  const output = execFileSync(process.execPath, ['scripts/check-build-output.mjs'], {
    encoding: 'utf8',
  });
  const parsed = JSON.parse(output) as {
    ok: boolean;
    routesBuilt: string[];
    prerenderedSessionHtmlPresent: boolean;
    prerenderedSearchHtmlPresent: boolean;
    leaks: unknown[];
  };
  expect(parsed.ok).toBe(true);
  expect(parsed.routesBuilt).toContain('/search/page');
  expect(parsed.prerenderedSessionHtmlPresent).toBe(false);
  expect(parsed.prerenderedSearchHtmlPresent).toBe(false);
  expect(parsed.leaks).toEqual([]);
});
