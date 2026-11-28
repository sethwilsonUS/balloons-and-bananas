import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
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

test('homepage arrives fully server-rendered before JS with zero "Opening the archive…" flash and live collection counts', async ({ browser, request }) => {
  // 1. Raw SSR HTML inspection over HTTP
  const response = await request.get('/');
  expect(response.status()).toBe(200);
  const headers = response.headers();
  expect(headers['cache-control'] || '').toMatch(/\bno-store\b/i);
  expect(headers['cdn-cache-control'] || '').toMatch(/\bno-store\b/i);
  expect(headers['vercel-cdn-cache-control'] || '').toMatch(/\bno-store\b/i);
  expect(headers['x-robots-tag'] || '').toMatch(/\bnoindex\b/i);
  expect(headers['referrer-policy']).toBe('no-referrer');

  const html = await response.text();
  expect(html).not.toContain('Opening the archive');
  expect(html).toContain('<title>The Seth Tapes</title>');
  expect(html).toContain('A childhood-language archive from the Peters/Wilson corpus');
  expect(html).toContain('action="/search"');
  expect(html).toContain('Browse by age');
  expect(html).toContain('Themes');
  expect(html).toContain('Research &amp; methods');
  expect(html).toContain('4 sessions');
  expect(html).toContain('3 original recordings');
  expect(html).toContain('2 archived research transcripts');
  expect(html).toContain('1 TalkBank AI draft');
  expect(html).toContain('1 local AI draft');
  expect(html).toContain('href="/about"');

  // 2. Render in a browser context with JavaScript completely disabled
  const noJsContext = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 800 } });
  try {
    const noJsPage = await noJsContext.newPage();
    await noJsPage.goto('/');

    await expect(noJsPage.locator('body')).not.toContainText('Opening the archive');
    await expect(noJsPage.getByRole('heading', { level: 1, name: 'The Seth Tapes', exact: true })).toBeVisible();
    await expect(noJsPage.locator('.home-masthead > p')).toHaveText('A childhood-language archive from the Peters/Wilson corpus');
    await expect(noJsPage.getByRole('searchbox', { name: 'Search the archive' })).toBeVisible();
    await expect(noJsPage.locator('.home-entry-grid h3')).toHaveText(['Browse by age', 'Themes', 'Research & methods']);
    await expect(noJsPage.locator('.home-provenance > p')).toHaveCount(1);
    await expect(noJsPage.locator('.home-provenance > p')).toContainText('4 sessions');
    await expect(noJsPage.locator('.home-provenance > p')).toContainText('3 original recordings');
    await expect(noJsPage.locator('.home-provenance > p').getByRole('link', { name: 'About sources, methods, and privacy' })).toHaveAttribute('href', '/about');

    // Submitting the plain HTML GET search form works even without client JavaScript
    await noJsPage.getByRole('searchbox', { name: 'Search the archive' }).fill('locomotive');
    await Promise.all([
      noJsPage.waitForURL(/\/search\?q=locomotive$/),
      noJsPage.locator('.home-search-form').getByRole('button', { name: 'Search' }).click(),
    ]);
    await expect(noJsPage).toHaveURL(/\/search\?q=locomotive$/);
  } finally {
    await noJsContext.close();
  }
});

test('homepage presents masthead, single search box above the three entry points, one-paragraph provenance, and navigates cleanly', async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  // Single search form on the homepage
  await expect(page.locator('main form[role="search"]')).toHaveCount(1);
  await expect(page.locator('main form[role="search"]')).toHaveAttribute('action', '/search');
  await expect(page.locator('main form[role="search"]')).toHaveAttribute('method', 'get');

  // Exact three entry points in canonical order: Browse by age, Themes, Research & methods
  const entryRows = page.locator('.home-entry-grid > article.home-entry-row');
  await expect(entryRows).toHaveCount(3);
  await expect(entryRows.locator('h3')).toHaveText(['Browse by age', 'Themes', 'Research & methods']);
  // No all-caps section eyebrows on the homepage
  await expect(page.locator('main .eyebrow')).toHaveCount(0);

  // Browse by age shows live count and explicit source/inferred age span
  await expect(entryRows.nth(0)).toContainText('4 sessions');
  await expect(entryRows.nth(0)).toContainText('source and filename-inferred ages (1 year, 8 months to 2 years, 6 months)');
  await expect(entryRows.nth(0).getByRole('link', { name: /Browse by age/i })).toHaveAttribute('href', '/sessions');

  // Themes shows balanced curated theme soft chips linking to /search?topic=...
  await expect(entryRows.nth(1)).toContainText('8 curated themes');
  await expect(entryRows.nth(1).locator('.theme-shortcuts a.theme-chip')).toHaveCount(8);

  // Research & methods links cleanly to both /research and /about
  await expect(entryRows.nth(2)).toContainText('3 research documents');
  await expect(entryRows.nth(2).getByRole('link', { name: /Research & methods/i })).toHaveAttribute('href', '/research');
  await expect(entryRows.nth(2).getByRole('link', { name: /sources, methods, and citation guidance/i })).toHaveAttribute('href', '/about');

  // Provenance is summarised in exactly one plain paragraph capped at 68ch and linking to /about
  const provenanceParagraphs = page.locator('.home-provenance > p');
  await expect(provenanceParagraphs).toHaveCount(1);
  await expect(provenanceParagraphs.first()).toContainText('4 sessions');
  await expect(provenanceParagraphs.first()).toContainText('3 original recordings');
  await expect(provenanceParagraphs.first()).toContainText('2 archived research transcripts');
  await expect(provenanceParagraphs.first()).toContainText('1 TalkBank AI draft');
  await expect(provenanceParagraphs.first()).toContainText('1 local AI draft');
  await expect(provenanceParagraphs.first()).toContainText('unreviewed');
  await expect(provenanceParagraphs.first()).toContainText('AI-written guides');
  await expect(provenanceParagraphs.first()).toContainText('filename-inferred ages are always labelled');
  await expect(provenanceParagraphs.first()).toContainText('calendar dates are never inferred');
  await expect(provenanceParagraphs.first().getByRole('link', { name: 'About sources, methods, and privacy' })).toHaveAttribute('href', '/about');

  // Verify visual top-to-bottom order, full browsing frame width, hairline rows (not boxed cards), and comfortable provenance measure
  const geometry = await page.evaluate(() => {
    const header = document.querySelector('header.site-header')!.getBoundingClientRect();
    const frontDoor = document.querySelector('.home-front-door')!.getBoundingClientRect();
    const masthead = document.querySelector('.home-masthead')!.getBoundingClientRect();
    const search = document.querySelector('.home-search-section')!.getBoundingClientRect();
    const entryEls = [...document.querySelectorAll<HTMLElement>('.home-entry-grid > article.home-entry-row')];
    const entries = entryEls.map(el => el.getBoundingClientRect());
    const entryStyles = entryEls.map(el => {
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, leftBorder: cs.borderLeftWidth, rightBorder: cs.borderRightWidth };
    });
    const chipStyle = getComputedStyle(document.querySelector('.theme-shortcuts a.theme-chip')!);
    const provenance = document.querySelector('.home-provenance')!.getBoundingClientRect();
    const provP = document.querySelector('.home-provenance > p')!;
    const provRect = provP.getBoundingClientRect();
    const provMaxWidth = getComputedStyle(provP).maxWidth;
    const nestedInteractive = document.querySelectorAll('a a, button a, a button').length;
    const overflowX = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    return {
      headerLeft: header.left,
      headerRight: header.right,
      frontDoorLeft: frontDoor.left,
      frontDoorRight: frontDoor.right,
      mastheadBottom: masthead.bottom,
      searchTop: search.top,
      searchBottom: search.bottom,
      entryTops: entries.map(r => r.top),
      entryBottoms: entries.map(r => r.bottom),
      entryStyles,
      chipBg: chipStyle.backgroundColor,
      chipBorderColor: chipStyle.borderTopColor,
      provenanceTop: provenance.top,
      provWidth: provRect.width,
      provMaxWidth,
      nestedInteractive,
      overflowX,
    };
  });

  expect(Math.abs(geometry.frontDoorLeft - geometry.headerLeft)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.frontDoorRight - geometry.headerRight)).toBeLessThanOrEqual(1);
  for (const style of geometry.entryStyles) {
    expect(style.bg).toBe('rgba(0, 0, 0, 0)');
    expect(style.leftBorder).toBe('0px');
    expect(style.rightBorder).toBe('0px');
  }
  expect(geometry.chipBg).not.toBe('rgba(0, 0, 0, 0)');
  expect(geometry.chipBorderColor).toBe('rgba(0, 0, 0, 0)');
  expect(geometry.mastheadBottom).toBeLessThanOrEqual(geometry.searchTop + 1);
  expect(geometry.searchBottom).toBeLessThanOrEqual(geometry.entryTops[0] + 1);
  expect(geometry.entryBottoms[0]).toBeLessThanOrEqual(geometry.entryTops[1] + 1);
  expect(geometry.entryBottoms[1]).toBeLessThanOrEqual(geometry.entryTops[2] + 1);
  expect(geometry.entryBottoms[2]).toBeLessThanOrEqual(geometry.provenanceTop + 1);
  expect(geometry.provMaxWidth).not.toBe('none');
  expect(geometry.provWidth).toBeLessThanOrEqual(760);
  expect(geometry.nestedInteractive).toBe(0);
  expect(geometry.overflowX).toBeLessThanOrEqual(0);

  // Follow Research & methods -> /research and About link -> /about
  await entryRows.nth(2).getByRole('link', { name: /Research & methods/i }).click();
  await expect(page).toHaveURL(/\/research$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Research & context' })).toBeVisible();

  await page.goto('/');
  await page.locator('.home-provenance').getByRole('link', { name: 'About sources, methods, and privacy' }).click();
  await expect(page).toHaveURL(/\/about$/);
  await expect(page.getByRole('heading', { level: 1, name: 'About & methods' })).toBeVisible();

  expect(consoleErrors, `Unexpected console errors: ${consoleErrors.join('; ')}`).toEqual([]);
  expect(pageErrors, `Unexpected page errors: ${pageErrors.join('; ')}`).toEqual([]);
});

test('homepage reflows with zero horizontal overflow at 390px and 320px and passes axe across light, dark, and system themes', async ({ page }) => {
  await page.goto('/');

  for (const viewport of [
    { label: 'desktop 1280px', width: 1280, height: 800, expectedThemeRows: [4, 4] },
    { label: 'mobile 390px', width: 390, height: 844, expectedThemeRows: [2, 2, 2, 2] },
    { label: 'narrow 320px', width: 320, height: 800, expectedThemeRows: [2, 2, 2, 2] },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const metrics = await page.evaluate(() => {
      const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
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
      const rowCounts = [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, count]) => count);
      return { overflow, rowCounts, minHeight };
    });

    expect(metrics.overflow, `Horizontal overflow at ${viewport.label}: ${metrics.overflow}px`).toBeLessThanOrEqual(0);
    expect(metrics.rowCounts, `Theme rows at ${viewport.label}`).toEqual(viewport.expectedThemeRows);
    expect(metrics.minHeight, `Theme tap target height at ${viewport.label}`).toBeGreaterThanOrEqual(44);
  }

  // Axe audit at 390px mobile in light & dark themes
  await page.setViewportSize({ width: 390, height: 844 });
  await setTheme(page, 'light');
  await expectNoSeriousAxeViolations(page, 'homepage 390px (light)');
  await setTheme(page, 'dark');
  await expectNoSeriousAxeViolations(page, 'homepage 390px (dark)');

  // Axe audit at 1280px desktop across light, dark, system dark, and system light
  await page.setViewportSize({ width: 1280, height: 800 });
  await setTheme(page, 'light');
  await expectNoSeriousAxeViolations(page, 'homepage 1280px (light)');
  await setTheme(page, 'dark');
  await expectNoSeriousAxeViolations(page, 'homepage 1280px (dark)');
  await page.emulateMedia({ colorScheme: 'dark' });
  await setTheme(page, 'system', true);
  await expectNoSeriousAxeViolations(page, 'homepage 1280px (system dark)');
  await page.emulateMedia({ colorScheme: 'light' });
  await waitForThemeSettled(page, false);
  await expectNoSeriousAxeViolations(page, 'homepage 1280px (system light)');
});
