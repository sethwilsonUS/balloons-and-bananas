import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { setTheme, waitForThemeSettled } from './helpers/theme';

const BROWSING_ROUTES = [
  { label: 'Home /', path: '/', waitFor: '.home-entry-row', maxEyebrows: 0 },
  { label: 'Sessions /sessions', path: '/sessions', waitFor: '.session-card', maxEyebrows: 1 },
  { label: 'Search /search', path: '/search?q=locomotive', waitFor: '.session-card', maxEyebrows: 1 },
  { label: 'Concordance /search?view=concordance', path: '/search?q=locomotive&view=concordance', waitFor: 'table.concordance-table', maxEyebrows: 1 },
] as const;

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

test('home, /sessions, and /search share full browsing-layout alignment, unboxed controls, copy restraint, provenance links, and zero inline Listen affordances', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });

  for (const route of BROWSING_ROUTES) {
    await page.goto(route.path);
    await page.waitForSelector(route.waitFor, { state: 'visible' });

    // Every browsing route uses <main class="browsing-layout"> aligned with header left & right edges
    await expect(page.locator('main.browsing-layout')).toHaveCount(1);
    await expect(page.locator('main .eyebrow')).toHaveCount(route.maxEyebrows);

    // No inline Listen/Play affordances on browsing routes (player stays on /sessions/[id] only)
    await expect(page.locator('main audio')).toHaveCount(0);
    await expect(page.locator('main').getByRole('button', { name: /Listen|Play recording/i })).toHaveCount(0);

    // Required provenance note stays visible and links to /about
    await expect(page.locator('main a[href="/about"]').first()).toBeVisible();

    const alignment = await page.evaluate(() => {
      const header = document.querySelector('header.site-header')!.getBoundingClientRect();
      const main = document.querySelector('main.browsing-layout')!.getBoundingClientRect();
      const h1 = document.querySelector('main h1')!.getBoundingClientRect();
      return {
        headerLeft: header.left,
        headerRight: header.right,
        mainLeft: main.left,
        mainRight: main.right,
        h1Left: h1.left,
      };
    });

    expect(Math.abs(alignment.mainLeft - alignment.headerLeft), `${route.label}: main left edge matches header`).toBeLessThanOrEqual(1);
    expect(Math.abs(alignment.mainRight - alignment.headerRight), `${route.label}: main right edge matches header`).toBeLessThanOrEqual(1);
    expect(Math.abs(alignment.h1Left - alignment.headerLeft), `${route.label}: h1 left edge matches header`).toBeLessThanOrEqual(1);
  }

  // /sessions control area is unboxed (transparent background, no side borders) and timeline heading is not an all-caps eyebrow
  await page.goto('/sessions');
  await page.waitForSelector('.sessions-browse-controls', { state: 'visible' });
  const sessionsMetrics = await page.evaluate(() => {
    const controls = getComputedStyle(document.querySelector('.sessions-browse-controls')!);
    const timelineLabel = getComputedStyle(document.querySelector('.age-jump-label')!);
    const intro = document.querySelector('.sessions-browse-section .section-intro')?.textContent?.trim() ?? '';
    return {
      controlsBg: controls.backgroundColor,
      controlsLeftBorder: controls.borderLeftWidth,
      controlsRightBorder: controls.borderRightWidth,
      timelineTransform: timelineLabel.textTransform,
      introSentenceCount: intro.split(/[.!?]+/).filter(part => part.trim().length > 0).length,
    };
  });
  expect(sessionsMetrics.controlsBg).toBe('rgba(0, 0, 0, 0)');
  expect(sessionsMetrics.controlsLeftBorder).toBe('0px');
  expect(sessionsMetrics.controlsRightBorder).toBe('0px');
  expect(sessionsMetrics.timelineTransform).toBe('none');
  expect(sessionsMetrics.introSentenceCount).toBe(1);

  // /search filter panel is unboxed (transparent background, no side borders) and intro is a single sentence
  await page.goto('/search?q=locomotive');
  await page.waitForSelector('.search-form', { state: 'visible' });
  const searchMetrics = await page.evaluate(() => {
    const form = getComputedStyle(document.querySelector('.search-form')!);
    const fieldset = getComputedStyle(document.querySelector('.age-filter-fieldset')!);
    const intro = document.querySelector('.search-route .section-intro')?.textContent?.trim() ?? '';
    return {
      formBg: form.backgroundColor,
      formLeftBorder: form.borderLeftWidth,
      formRightBorder: form.borderRightWidth,
      fieldsetTopBorder: fieldset.borderTopWidth,
      introSentenceCount: intro.split(/[.!?]+/).filter(part => part.trim().length > 0).length,
    };
  });
  expect(searchMetrics.formBg).toBe('rgba(0, 0, 0, 0)');
  expect(searchMetrics.formLeftBorder).toBe('0px');
  expect(searchMetrics.formRightBorder).toBe('0px');
  expect(searchMetrics.fieldsetTopBorder).toBe('0px');
  expect(searchMetrics.introSentenceCount).toBe(1);

  // Concordance match cell keeps whole short words on one line without mid-word character splits
  await page.goto('/search?q=locomotive&view=concordance');
  await page.waitForSelector('table.concordance-table', { state: 'visible' });
  const matchWrap = await page.evaluate(() => {
    const mark = document.querySelector('.concordance-match mark')!;
    const rect = mark.getBoundingClientRect();
    const lineHeight = Number.parseFloat(getComputedStyle(mark).lineHeight);
    return { height: rect.height, lineHeight };
  });
  expect(matchWrap.height).toBeLessThanOrEqual(matchWrap.lineHeight * 1.5);
});

test('all browsing routes have zero horizontal overflow at 320px/390px and pass axe across light, dark, and system themes', async ({ page }) => {
  for (const route of BROWSING_ROUTES) {
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(route.path);
      await page.waitForSelector(route.waitFor, { state: 'visible' });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${route.label} horizontal overflow at ${width}px`).toBeLessThanOrEqual(0);
    }

    await page.setViewportSize({ width: 1280, height: 800 });
    await setTheme(page, 'light');
    await expectNoSeriousAxeViolations(page, `${route.label} (light)`);
    await setTheme(page, 'dark');
    await expectNoSeriousAxeViolations(page, `${route.label} (dark)`);
    await page.emulateMedia({ colorScheme: 'dark' });
    await setTheme(page, 'system', true);
    await expectNoSeriousAxeViolations(page, `${route.label} (system dark)`);
    await page.emulateMedia({ colorScheme: 'light' });
    await waitForThemeSettled(page, false);
    await expectNoSeriousAxeViolations(page, `${route.label} (system light)`);
    await setTheme(page, 'light');
  }
});
