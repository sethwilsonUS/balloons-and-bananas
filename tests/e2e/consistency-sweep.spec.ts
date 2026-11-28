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

function expectBasePrivacyHeaders(response: APIResponse, label: string) {
  const headers = response.headers();
  expect(headers['cache-control'] || '', `${label}: Cache-Control no-store`).toMatch(/\bno-store\b/i);
  expect(headers['x-robots-tag'] || '', `${label}: X-Robots-Tag noindex`).toMatch(/\bnoindex\b/i);
  expect(headers['referrer-policy'], `${label}: Referrer-Policy no-referrer`).toBe('no-referrer');
}

function expectPrivateHeaders(response: APIResponse, label: string) {
  expectBasePrivacyHeaders(response, label);
  const headers = response.headers();
  expect(headers['cdn-cache-control'] || '', `${label}: CDN-Cache-Control no-store`).toMatch(/\bno-store\b/i);
  expect(headers['vercel-cdn-cache-control'] || '', `${label}: Vercel-CDN-Cache-Control no-store`).toMatch(/\bno-store\b/i);
}

const CONSISTENCY_ROUTES = [
  { label: 'Home /', path: '/', waitFor: '.home-entry-row', layout: 'browsing-layout', expectedEyebrows: 0, sharedInnerTop: false },
  { label: 'Sessions Details /sessions', path: '/sessions', waitFor: '.session-card', layout: 'browsing-layout', expectedEyebrows: 1, sharedInnerTop: true },
  { label: 'Session with audio /sessions/010815', path: '/sessions/010815', waitFor: '#transcript-heading', layout: 'reading-layout', expectedEyebrows: 1, sharedInnerTop: false },
  { label: 'Session without audio /sessions/011103', path: '/sessions/011103', waitFor: '#transcript-heading', layout: 'reading-layout', expectedEyebrows: 1, sharedInnerTop: false },
  { label: 'Search Details /search?q=locomotive', path: '/search?q=locomotive', waitFor: '.session-card', layout: 'browsing-layout', expectedEyebrows: 1, sharedInnerTop: true },
  { label: 'Search List /search?q=locomotive&view=list', path: '/search?q=locomotive&view=list', waitFor: '.session-list-row', layout: 'browsing-layout', expectedEyebrows: 1, sharedInnerTop: true },
  { label: 'Search Concordance /search?q=locomotive&view=concordance', path: '/search?q=locomotive&view=concordance', waitFor: 'table.concordance-table', layout: 'browsing-layout', expectedEyebrows: 1, sharedInnerTop: true },
  { label: 'Research list /research', path: '/research', waitFor: '.research-document', layout: 'browsing-layout', expectedEyebrows: 1, sharedInnerTop: true },
  { label: 'Research doc /research/fixture-provenance-guide', path: '/research/fixture-provenance-guide', waitFor: '.prose', layout: 'reading-layout', expectedEyebrows: 1, sharedInnerTop: false },
  { label: 'About /about', path: '/about', waitFor: '#how-to-cite-heading', layout: 'reading-layout', expectedEyebrows: 1, sharedInnerTop: true },
  { label: 'Site 404', path: '/nonexistent-consistency-page', waitFor: 'h1', layout: 'reading-layout', expectedEyebrows: 1, sharedInnerTop: true },
  { label: 'Session 404', path: '/sessions/nonexistent-consistency-session', waitFor: 'h1', layout: 'reading-layout', expectedEyebrows: 1, sharedInnerTop: true },
  { label: 'Research doc 404', path: '/research/nonexistent-consistency-doc', waitFor: 'h1', layout: 'reading-layout', expectedEyebrows: 1, sharedInnerTop: true },
] as const;

test('every route shares the canonical frame alignment, unified vertical rhythm, at most one eyebrow, shared control kit, and zero 320px/390px overflow', async ({ page }) => {
  const innerRouteH1Tops = new Map<string, number>();

  for (const route of CONSISTENCY_ROUTES) {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(route.path);
    await page.waitForSelector(route.waitFor, { state: 'visible' });

    const metrics = await page.evaluate(expectedLayout => {
      const brand = document.querySelector('.brand-button')?.getBoundingClientRect();
      const h1 = document.querySelector('main h1')?.getBoundingClientRect();
      const layoutEl = document.querySelector(`.${expectedLayout}`);
      const eyebrows = [...document.querySelectorAll('.eyebrow')];

      const nonCanonicalButtons = [...document.querySelectorAll<HTMLElement>('main button')]
        .filter(el => el.offsetParent !== null)
        .filter(el => !/\b(button|text-button|search-submit)\b/.test(el.className))
        .map(el => ({ cls: el.className, text: (el.textContent || '').trim() }));

      const fieldIssues = [...document.querySelectorAll<HTMLElement>(
        'main select, main input:not([type="checkbox"]):not([type="radio"]):not([type="range"])',
      )]
        .filter(el => el.offsetParent !== null && !el.closest('.search-input'))
        .map(el => {
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return {
            id: el.id || el.tagName,
            height: Math.round(rect.height),
            fontSize: style.fontSize,
            borderRadius: style.borderRadius,
          };
        })
        .filter(f => f.height < 44 || f.fontSize !== '16px' || f.borderRadius !== '5px');

      return {
        hasLayout: Boolean(layoutEl),
        brandLeft: brand ? brand.left : -1,
        h1Left: h1 ? h1.left : -1,
        h1Top: h1 ? h1.top : -1,
        eyebrowCount: eyebrows.length,
        nonCanonicalButtons,
        fieldIssues,
        overflow1280: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    }, route.layout);

    expect(metrics.hasLayout, `${route.label}: missing .${route.layout}`).toBe(true);
    expect(Math.abs(metrics.h1Left - metrics.brandLeft), `${route.label}: h1 left edge matches header brand`).toBeLessThanOrEqual(1);
    expect(metrics.eyebrowCount, `${route.label}: eyebrow count`).toBe(route.expectedEyebrows);
    expect(metrics.nonCanonicalButtons, `${route.label}: non-canonical buttons`).toEqual([]);
    expect(metrics.fieldIssues, `${route.label}: control-kit field drift`).toEqual([]);
    expect(metrics.overflow1280, `${route.label}: 1280px overflow`).toBeLessThanOrEqual(0);

    if (route.sharedInnerTop) {
      innerRouteH1Tops.set(route.label, metrics.h1Top);
    }

    // Cite dialog on session page must not introduce a second .eyebrow
    if (route.path === '/sessions/010815') {
      await page.locator('.cite-catalog-button').click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.locator('.eyebrow')).toHaveCount(1);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }

    // Check 390px and 320px overflow across every route (including all 404s)
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${route.label}: overflow at ${width}px`).toBeLessThanOrEqual(0);
    }
  }

  // All top-level inner routes share identical vertical top rhythm (no header jump between routes)
  const tops = [...innerRouteH1Tops.values()];
  expect(
    Math.max(...tops) - Math.min(...tops),
    `Inner-route H1 vertical alignment drifted: ${JSON.stringify([...innerRouteH1Tops])}`,
  ).toBeLessThanOrEqual(1);

  // /research uses the canonical .page-header without a one-off decorative header icon
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/research');
  await expect(page.locator('header.page-header')).toHaveCount(1);
  await expect(page.locator('header.page-header svg')).toHaveCount(0);
});

test('site-wide 404 returns HTTP 404 with privacy headers, canonical reading-layout, single-sentence intro, and clean axe across light, dark, and system themes', async ({ page, request }) => {
  const apiRes = await request.get('/nonexistent-consistency-page');
  expect(apiRes.status()).toBe(404);
  expectBasePrivacyHeaders(apiRes, '/nonexistent-consistency-page');

  const session404Res = await request.get('/sessions/nonexistent-consistency-session');
  expect(session404Res.status()).toBe(404);
  expectPrivateHeaders(session404Res, '/sessions/nonexistent-consistency-session');

  const navRes = await page.goto('/nonexistent-consistency-page');
  expect(navRes?.status()).toBe(404);
  await expect(page.locator('main.reading-layout .not-found-page.reading-column')).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1, name: /This archive link could not be found/i })).toBeVisible();
  await expect(page.locator('.not-found-actions a[href="/search"]')).toBeVisible();
  await expect(page.locator('.not-found-actions a[href="/research"]')).toBeVisible();

  const intro = (await page.locator('.not-found-page .section-intro').innerText()).trim();
  expect(intro.split(/(?<=[.!?])\s+/).filter(Boolean)).toHaveLength(1);

  await setTheme(page, 'light');
  await expectNoSeriousAxeViolations(page, 'Site 404 (light)');
  await setTheme(page, 'dark');
  await expectNoSeriousAxeViolations(page, 'Site 404 (dark)');
  await page.emulateMedia({ colorScheme: 'dark' });
  await setTheme(page, 'system', true);
  await expectNoSeriousAxeViolations(page, 'Site 404 (system dark)');
  await page.emulateMedia({ colorScheme: 'light' });
  await waitForThemeSettled(page, false);
  await expectNoSeriousAxeViolations(page, 'Site 404 (system light)');
  await setTheme(page, 'light');
});
