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

async function expectCleanHeadingOrder(page: Page, label: string) {
  const headingLevels = await page.evaluate(() =>
    [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')]
      .filter(el => (el as HTMLElement).offsetParent !== null)
      .map(el => Number(el.tagName.slice(1))),
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('/research renders per-request SSR reading list with collapsed cards, private headers, consistent H1 scale, keyboard disclosure, and clean axe across themes', async ({ page, request }) => {
  const response = await request.get('/research');
  expect(response.status()).toBe(200);
  expectPrivateHeaders(response, '/research');
  const html = await response.text();
  expect(html).toMatch(/<title>Research &(?:amp;)? context · The Seth Tapes<\/title>/);
  expect(html).toContain('Fixture annotation provenance guide');
  expect(html).toContain('/research/fixture-provenance-guide');

  await page.goto('/research');
  await expect(page).toHaveTitle('Research & context · The Seth Tapes');
  await expect(page.getByRole('heading', { level: 1, name: 'Research & context' })).toBeVisible();
  await expect(page.locator('nav[aria-label="Collection sections"] a[aria-current="page"]')).toHaveText('Research & context');

  await expectCleanHeadingOrder(page, '/research collapsed');

  // Verify H1 is visibly larger than card H2 headings at desktop and tablet viewports
  for (const viewport of [{ width: 1280, height: 800 }, { width: 768, height: 900 }]) {
    await page.setViewportSize(viewport);
    const sizes = await page.evaluate(() => {
      const h1 = document.querySelector('main h1');
      const cardH2 = document.querySelector('.research-document > h2');
      if (!h1 || !cardH2) throw new Error('Missing heading on /research');
      return {
        h1: Number.parseFloat(getComputedStyle(h1).fontSize),
        cardH2: Number.parseFloat(getComputedStyle(cardH2).fontSize),
      };
    });
    expect(sizes.h1, `H1 (${sizes.h1}px) must be visibly larger than card H2 (${sizes.cardH2}px) at ${viewport.width}px`).toBeGreaterThan(sizes.cardH2 * 1.15);
  }
  await page.setViewportSize({ width: 1280, height: 800 });

  // Verify collapsed-by-default reading-list cards show title once linking to /research/<doc>, category, description, and downloads
  const cards = page.locator('.research-document');
  await expect(cards).toHaveCount(3);
  const expectedCards = [
    {
      id: 'fixture-provenance-guide',
      category: 'Archive guide',
      title: 'Fixture annotation provenance guide',
      description: 'Explains how invented transcript origins and CHAT notation layers remain separate.',
      downloadLabel: 'Download provenance guide (MD)',
    },
    {
      id: 'fixture-research-notes',
      category: 'Research material',
      title: 'Fixture research reading list',
      description: 'Invented corpus inventory table and research background for browser verification.',
      downloadLabel: 'Download research notes (MD)',
    },
    {
      id: 'methods-and-audit',
      category: 'Archive guide',
      title: 'Sources and methods',
      description: 'Explains transcript origins, source ages, filename-inferred ages, and fixture limits.',
      downloadLabel: 'Download methods note (MD)',
    },
  ];

  for (const [index, expected] of expectedCards.entries()) {
    const card = cards.nth(index);
    await expect(card.locator('.eyebrow')).toHaveText(expected.category);
    const titleLink = card.locator('h2 a');
    await expect(titleLink).toHaveText(expected.title);
    await expect(titleLink).toHaveAttribute('href', `/research/${expected.id}`);
    await expect(card).toContainText(expected.description);
    await expect(card.locator('.document-downloads a')).toContainText(expected.downloadLabel);

    const details = card.locator('details.document-reading');
    await expect(details).not.toHaveAttribute('open', '');
    await expect(details.locator('.prose')).toBeHidden();

    const visibleText = await card.innerText();
    const titleMatches = visibleText.match(new RegExp(escapeRegExp(expected.title), 'gi')) ?? [];
    expect(titleMatches.length, `Expected "${expected.title}" once in collapsed card`).toBe(1);

    const summary = details.locator('summary');
    await expect(summary).toHaveText('Read document');
    await expect(summary).toHaveAccessibleName(`Read document ${expected.title}`);
  }

  // Keyboard toggle expands inline document without duplicating leading title or skipping heading levels
  const firstCard = cards.nth(0);
  const firstSummary = firstCard.locator('details.document-reading > summary');
  await firstSummary.focus();
  await expect(firstSummary).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(firstCard.locator('details.document-reading')).toHaveAttribute('open', '');
  await expect(firstCard.locator('.prose h3')).toHaveText('Transcript layers');
  await expect(firstCard.locator('.prose h4')).toHaveText('Editorial markers');
  await expectCleanHeadingOrder(page, '/research expanded');
  const expandedMatches = (await firstCard.innerText()).match(/Fixture annotation provenance guide/gi) ?? [];
  expect(expandedMatches.length).toBe(1);

  await auditAllThemes(page, '/research');

  // 320px narrow reflow has zero horizontal overflow
  await page.setViewportSize({ width: 320, height: 800 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 1280, height: 800 });
});

test('/research/[doc] renders per-request SSR reader with H1 > H2 > H3 scale, intact 3-column table, internal /research links, canonical redirect, 404, and clean axe', async ({ page, request }) => {
  // SSR response + private headers
  const response = await request.get('/research/fixture-provenance-guide');
  expect(response.status()).toBe(200);
  expectPrivateHeaders(response, '/research/fixture-provenance-guide');
  const html = await response.text();
  expect(html).toContain('<title>Fixture annotation provenance guide · Research · The Seth Tapes</title>');

  // Measure /sessions/010815 H1 size so we prove /research/[doc] matches its page-level H1 hierarchy
  await page.goto('/sessions/010815');
  const sessionH1Size = await page.locator('main h1').evaluate(el => Number.parseFloat(getComputedStyle(el).fontSize));

  // Navigate to /research/fixture-research-notes and follow internal /research/fixture-provenance-guide link
  await page.goto('/research/fixture-research-notes');
  await expect(page).toHaveTitle('Fixture research reading list · Research · The Seth Tapes');
  const internalLink = page.locator('article.document-detail .prose a[href="/research/fixture-provenance-guide"]');
  await expect(internalLink).toHaveText('annotation provenance guide');
  await internalLink.click();

  await expect(page).toHaveURL(/\/research\/fixture-provenance-guide$/);
  await expect(page).toHaveTitle('Fixture annotation provenance guide · Research · The Seth Tapes');

  const detail = page.locator('article.document-detail');
  const pageH1 = detail.locator('h1');
  await expect(pageH1).toHaveText('Fixture annotation provenance guide');

  // Duplicate leading markdown H1 is stripped; document title appears once
  const titleOccurrences = (await detail.innerText()).match(/Fixture annotation provenance guide/gi) ?? [];
  expect(titleOccurrences.length).toBe(1);
  await expect(detail.locator('.prose h1')).toHaveCount(0);
  await expect(detail.locator('.prose h2')).toHaveText('Transcript layers');
  await expect(detail.locator('.prose h3')).toHaveText('Editorial markers');
  await expectCleanHeadingOrder(page, '/research/fixture-provenance-guide');

  // Verify H1 matches /sessions/[id] scale and H1 > H2 > H3 at desktop and tablet viewports
  const docH1Desktop = await pageH1.evaluate(el => Number.parseFloat(getComputedStyle(el).fontSize));
  expect(Math.abs(docH1Desktop - sessionH1Size)).toBeLessThanOrEqual(1);

  for (const viewport of [{ width: 1280, height: 800 }, { width: 768, height: 900 }]) {
    await page.setViewportSize(viewport);
    const sizes = await page.evaluate(() => {
      const parse = (selector: string) => {
        const el = document.querySelector(selector);
        if (!el) throw new Error(`Missing selector: ${selector}`);
        return Number.parseFloat(getComputedStyle(el).fontSize);
      };
      return {
        h1: parse('article.document-detail h1'),
        h2: parse('article.document-detail .prose h2'),
        h3: parse('article.document-detail .prose h3'),
      };
    });
    expect(sizes.h1, `H1 (${sizes.h1}px) must be visibly larger than H2 (${sizes.h2}px) at ${viewport.width}px`).toBeGreaterThan(sizes.h2 * 1.15);
    expect(sizes.h2, `H2 (${sizes.h2}px) must be larger than H3 (${sizes.h3}px) at ${viewport.width}px`).toBeGreaterThan(sizes.h3);
  }
  await page.setViewportSize({ width: 1280, height: 800 });

  // Verify 3-column escaped-pipe table is intact
  const table = detail.locator('.table-scroll table');
  await expect(table).toBeVisible();
  await expect(table.locator('thead th')).toHaveText(['Layer', 'Notation example', 'Provenance note']);
  const rows = table.locator('tbody tr');
  await expect(rows).toHaveCount(3);
  for (let i = 0; i < 3; i += 1) {
    await expect(rows.nth(i).locator('td')).toHaveCount(3);
  }
  await expect(rows.nth(2).locator('td').nth(1).locator('code')).toHaveText('plain text | JSON');

  // Verify download link and back-to-research link
  const downloadLink = detail.locator('.document-downloads a').first();
  await expect(downloadLink).toHaveAttribute('href', '/api/assets/fixture-doc-provenance-md');
  await expect(detail.locator('a.back-button')).toHaveAttribute('href', '/research');

  // Obsolete #access= fragment is stripped client-side
  await page.goto('/research/fixture-provenance-guide#access=obsolete-key');
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('');

  await auditAllThemes(page, '/research/fixture-provenance-guide');

  // 320px narrow reflow has zero horizontal overflow
  await page.setViewportSize({ width: 320, height: 800 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 1280, height: 800 });

  // Non-canonical uppercase slug redirects cleanly with private headers
  const upperRes = await request.get('/research/FIXTURE-PROVENANCE-GUIDE', { maxRedirects: 0 });
  expect([307, 308]).toContain(upperRes.status());
  expect(upperRes.headers()['location']).toMatch(/\/research\/fixture-provenance-guide$/);
  expectPrivateHeaders(upperRes, '/research/FIXTURE-PROVENANCE-GUIDE redirect');

  // Unknown document returns HTTP 404 with private headers, helpful navigation, and clean axe
  const missingApiRes = await request.get('/research/nonexistent-fixture-doc');
  expect(missingApiRes.status()).toBe(404);
  expectPrivateHeaders(missingApiRes, '/research/nonexistent-fixture-doc');

  const missingNavRes = await page.goto('/research/nonexistent-fixture-doc');
  expect(missingNavRes?.status()).toBe(404);
  await expect(page).toHaveTitle('Document not found · Research · The Seth Tapes');
  await expect(page.getByRole('heading', { level: 1, name: /This research document could not be found/i })).toBeVisible();
  await expect(page.locator('.not-found-actions a[href="/research"]')).toBeVisible();
  await expect(page.locator('.not-found-actions a[href="/?section=sessions"]')).toBeVisible();
  await auditAllThemes(page, '/research/nonexistent-fixture-doc 404');
});

test('/about renders live request-time counts, all required methods sections, #inferred-ages anchor target from SessionAge, private headers, and clean axe across themes', async ({ page, request }) => {
  const response = await request.get('/about');
  expect(response.status()).toBe(200);
  expectPrivateHeaders(response, '/about');
  const html = await response.text();
  expect(html).toMatch(/<title>About &(?:amp;)? methods · The Seth Tapes<\/title>/);
  expect(html).toContain('id="inferred-ages"');
  expect(html).toContain('78 of 78');

  // Verify following "(inferred from filename)" from /sessions/020604-local lands on /about#inferred-ages
  await page.goto('/sessions/020604-local');
  const sessionH1Size = await page.locator('main h1').evaluate(el => Number.parseFloat(getComputedStyle(el).fontSize));
  const sessionInferredLink = page.locator('dl.catalog-record').getByRole('link', { name: /\(inferred from filename\)/i });
  await expect(sessionInferredLink).toHaveAttribute('href', '/about#inferred-ages');
  await sessionInferredLink.click();

  await expect(page).toHaveURL(/\/about#inferred-ages$/);
  await expect(page).toHaveTitle('About & methods · The Seth Tapes');
  await expect(page.locator('nav[aria-label="Collection sections"] a[aria-current="page"]')).toHaveText('About & methods');

  const aboutH1 = page.getByRole('heading', { level: 1, name: 'About & methods' });
  await expect(aboutH1).toBeVisible();
  await expectCleanHeadingOrder(page, '/about');

  // Verify H1 matches /sessions/[id] hierarchy and is visibly larger than section H2 headings
  const aboutH1Desktop = await aboutH1.evaluate(el => Number.parseFloat(getComputedStyle(el).fontSize));
  expect(Math.abs(aboutH1Desktop - sessionH1Size)).toBeLessThanOrEqual(1);

  for (const viewport of [{ width: 1280, height: 800 }, { width: 768, height: 900 }]) {
    await page.setViewportSize(viewport);
    const sizes = await page.evaluate(() => {
      const h1 = document.querySelector('article.about-page h1');
      const h2 = document.querySelector('article.about-page h2');
      if (!h1 || !h2) throw new Error('Missing heading on /about');
      return {
        h1: Number.parseFloat(getComputedStyle(h1).fontSize),
        h2: Number.parseFloat(getComputedStyle(h2).fontSize),
      };
    });
    expect(sizes.h1, `H1 (${sizes.h1}px) must be visibly larger than H2 (${sizes.h2}px) at ${viewport.width}px`).toBeGreaterThan(sizes.h2 * 1.15);
  }
  await page.setViewportSize({ width: 1280, height: 800 });

  // Live counts read from synthetic fixture archive at request time
  const about = page.locator('article.about-page');
  await expect(about).toContainText('4 sessions');
  await expect(about).toContainText('3 original recordings');
  await expect(about).toContainText('1 labelled MP3 listening copy');
  await expect(about).toContainText('2 archived research sessions');
  await expect(about).toContainText('1 TalkBank AI draft');
  await expect(about).toContainText('1 local AI draft');

  // All required AC #2 sections are present
  await expect(page.locator('#transcript-origins')).toBeVisible();
  await expect(page.locator('#ai-guides')).toBeVisible();
  await expect(about).toContainText('Guides are never evidence of what was said.');
  await expect(page.locator('#inferred-ages')).toBeVisible();
  await expect(about).toContainText('78 of 78');
  await expect(about).toContainText('Calendar dates are never inferred.');
  await expect(page.locator('#timestamps')).toBeVisible();
  await expect(about).toContainText('approximate navigation aids');
  await expect(page.locator('#access-and-analytics')).toBeVisible();
  await expect(about).toContainText('allowlist');
  await expect(page.locator('#search-privacy')).toBeVisible();
  await expect(about).toContainText('Exact search');
  await expect(page.locator('#how-to-cite')).toBeVisible();
  await expect(about).toContainText('Peters/Wilson corpus in CHILDES');
  await expect(about).toContainText('10.21415/T5NS4D');

  // Zero nested links
  const nestedLinks = await page.evaluate(() => document.querySelectorAll('a a, button a, a button').length);
  expect(nestedLinks).toBe(0);

  // Header nav links seamlessly to /research
  await page.locator('nav[aria-label="Collection sections"]').getByRole('link', { name: 'Research & context' }).click();
  await expect(page).toHaveURL(/\/research$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Research & context' })).toBeVisible();

  // Navigate back to /about and audit all 4 themes + 320px narrow reflow
  await page.locator('nav[aria-label="Collection sections"]').getByRole('link', { name: 'About & methods' }).click();
  await expect(page).toHaveURL(/\/about$/);
  await auditAllThemes(page, '/about');

  await page.setViewportSize({ width: 320, height: 800 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 1280, height: 800 });
});

test('build-output check proves /research, /research/[doc], and /about are dynamic with zero prerendered HTML or fixture text in .next/', async () => {
  const output = execFileSync(process.execPath, ['scripts/check-build-output.mjs'], {
    encoding: 'utf8',
  });
  const parsed = JSON.parse(output) as {
    ok: boolean;
    routesBuilt: string[];
    prerenderedDynamicHtmlPresent: boolean;
    filesScanned: number;
    phrasesChecked: number;
    leaks: unknown[];
  };
  expect(parsed.ok).toBe(true);
  expect(parsed.routesBuilt).toEqual([
    '/sessions/[id]/page',
    '/research/page',
    '/research/[doc]/page',
    '/about/page',
  ]);
  expect(parsed.prerenderedDynamicHtmlPresent).toBe(false);
  expect(parsed.filesScanned).toBeGreaterThan(0);
  expect(parsed.phrasesChecked).toBeGreaterThanOrEqual(15);
  expect(parsed.leaks).toEqual([]);
});
