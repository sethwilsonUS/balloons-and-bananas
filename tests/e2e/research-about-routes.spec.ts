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

  await expect(page.locator('.eyebrow')).toHaveCount(1);
  const researchIntro = (await page.locator('.research-page .section-intro').innerText()).trim();
  expect(researchIntro.split(/(?<=[.!?])\s+/).filter(Boolean)).toHaveLength(1);

  for (const [index, expected] of expectedCards.entries()) {
    const card = cards.nth(index);
    await expect(card.locator('.research-document-category')).toHaveText(expected.category);
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
  await expect(page.locator('.not-found-actions a[href="/search"]')).toBeVisible();
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
  await expect(about).toContainText('jumps to the transcript passage nearest that time');
  await expect(about).toContainText('never starts, moves or loads the recording');
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
  expect(parsed.routesBuilt).toEqual(expect.arrayContaining([
    '/sessions/[id]/page',
    '/research/page',
    '/research/[doc]/page',
    '/about/page',
  ]));
  expect(parsed.prerenderedDynamicHtmlPresent).toBe(false);
  expect(parsed.filesScanned).toBeGreaterThan(0);
  expect(parsed.phrasesChecked).toBeGreaterThanOrEqual(15);
  expect(parsed.leaks).toEqual([]);
});

test('reading layout puts sidebar beside 68ch column on desktop and below title on narrow screens for research documents and About, with On this page links, scroll-margin-top, Share action, copy trim, and clean print layout', async ({ page, baseURL }) => {
  await page.addInitScript(() => {
    interface PendingWrite {
      text: string;
      resolve: () => void;
      reject: (error: Error) => void;
    }
    const win = window as unknown as {
      __copiedUrls: string[];
      __failClipboard: boolean;
      __deferNextWrite: boolean;
      __pendingWrites: PendingWrite[];
    };
    win.__copiedUrls = [];
    win.__failClipboard = false;
    win.__deferNextWrite = false;
    win.__pendingWrites = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string) => {
          if (win.__deferNextWrite) {
            win.__deferNextWrite = false;
            return new Promise<void>((resolve, reject) => {
              win.__pendingWrites.push({
                text,
                resolve: () => {
                  win.__copiedUrls.push(text);
                  resolve();
                },
                reject: (err: Error) => reject(err),
              });
            });
          }
          if (win.__failClipboard) {
            return Promise.reject(new Error('Clipboard denied'));
          }
          win.__copiedUrls.push(text);
          return Promise.resolve();
        },
      },
    });
  });

  // 1. Research document with headings: /research/fixture-provenance-guide
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/research/fixture-provenance-guide');

  // Strictly one eyebrow at top of page; single-sentence intro
  await expect(page.locator('.eyebrow')).toHaveCount(1);
  const docIntro = (await page.locator('.reading-header .section-intro').innerText()).trim();
  expect(docIntro.split(/(?<=[.!?])\s+/).filter(Boolean)).toHaveLength(1);

  // Desktop geometry: reading-column <= 68ch, sidebar sits to the right, left edge aligns with header brand
  const docDesktopGeo = await page.evaluate(() => {
    const brand = document.querySelector('.brand-button')!.getBoundingClientRect();
    const h1 = document.querySelector('article.document-detail h1')!.getBoundingClientRect();
    const column = document.querySelector('article.document-detail > .reading-column')!.getBoundingClientRect();
    const sidebar = document.querySelector('article.document-detail > .reading-sidebar')!.getBoundingClientRect();
    return {
      brandLeft: brand.left,
      h1Left: h1.left,
      columnLeft: column.left,
      columnRight: column.right,
      columnWidth: column.width,
      sidebarLeft: sidebar.left,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  expect(Math.abs(docDesktopGeo.h1Left - docDesktopGeo.brandLeft)).toBeLessThanOrEqual(1);
  expect(Math.abs(docDesktopGeo.columnLeft - docDesktopGeo.brandLeft)).toBeLessThanOrEqual(1);
  expect(docDesktopGeo.columnWidth).toBeLessThanOrEqual(760);
  expect(docDesktopGeo.sidebarLeft).toBeGreaterThanOrEqual(docDesktopGeo.columnRight - 1);
  expect(docDesktopGeo.overflow).toBeLessThanOrEqual(0);

  // Breakpoint boundary (1001px): zero horizontal overflow
  await page.setViewportSize({ width: 1001, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 1280, height: 800 });

  // Sidebar holds labelled "On this page" nav with real <ul> of links matching rendered heading IDs
  const docTocNav = page.getByRole('navigation', { name: 'On this page' });
  await expect(docTocNav).toBeVisible();
  const docTocLinks = docTocNav.locator('ul li a');
  await expect(docTocLinks).toHaveText(['Transcript layers', 'Editorial markers']);
  await expect(docTocLinks.nth(0)).toHaveAttribute('href', '#transcript-layers');
  await expect(docTocLinks.nth(1)).toHaveAttribute('href', '#editorial-markers');
  await expect(page.locator('#transcript-layers')).toHaveText('Transcript layers');
  await expect(page.locator('#editorial-markers')).toHaveText('Editorial markers');

  // Clicking an "On this page" link jumps cleanly to the target without clipping under any sticky element
  await docTocLinks.nth(1).click();
  await expect(page).toHaveURL(/\/research\/fixture-provenance-guide#editorial-markers$/);
  const targetMetrics = await page.locator('#editorial-markers').evaluate(el => ({
    top: el.getBoundingClientRect().top,
    scrollMarginTop: Number.parseFloat(getComputedStyle(el).scrollMarginTop),
  }));
  expect(targetMetrics.top).toBeGreaterThanOrEqual(0);
  expect(targetMetrics.scrollMarginTop).toBeGreaterThanOrEqual(24);

  // Downloads and Share live inside the sidebar
  const docSidebar = page.locator('article.document-detail > .reading-sidebar');
  await expect(docSidebar.locator('.document-downloads a')).toHaveAttribute('href', '/api/assets/fixture-doc-provenance-md');

  const shareButton = docSidebar.getByRole('button', { name: 'Share' });
  const shareLiveStatus = docSidebar.locator('.document-share [role="status"]');
  await expect(shareButton).toBeVisible();
  await expect(shareLiveStatus).toHaveCount(1);
  await shareButton.focus();
  await page.keyboard.press('Enter');
  await expect(docSidebar.getByRole('button', { name: 'Link copied' })).toBeVisible();
  await expect(shareLiveStatus).toContainText('Link copied');
  const copied = await page.evaluate(() => (window as unknown as { __copiedUrls: string[] }).__copiedUrls);
  expect(copied).toEqual([`${baseURL}/research/fixture-provenance-guide`]);

  // Share clipboard failure renders manual fallback focused with exact URL; Dismiss restores focus
  await page.evaluate(() => { (window as unknown as { __failClipboard: boolean }).__failClipboard = true; });
  const shareTriggerAgain = docSidebar.locator('.document-share-button');
  await shareTriggerAgain.focus();
  await page.keyboard.press('Enter');
  const manualInput = docSidebar.getByRole('textbox', { name: 'Copy this document link' });
  await expect(manualInput).toBeVisible();
  await expect(manualInput).toBeFocused();
  await expect(manualInput).toHaveValue(`${baseURL}/research/fixture-provenance-guide`);
  await expect(shareLiveStatus).toContainText('Could not copy automatically');
  await docSidebar.getByRole('button', { name: 'Dismiss' }).click();
  await expect(manualInput).toHaveCount(0);
  await expect(shareTriggerAgain).toBeFocused();

  // Pending clipboard failure does not steal focus if reader moved focus away
  await page.evaluate(() => {
    const win = window as unknown as { __failClipboard: boolean; __deferNextWrite: boolean };
    win.__failClipboard = false;
    win.__deferNextWrite = true;
  });
  await shareTriggerAgain.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __pendingWrites: unknown[] }).__pendingWrites.length)).toBe(1);
  const backLink = page.locator('a.back-button');
  await backLink.focus();
  await expect(backLink).toBeFocused();
  await page.evaluate(() => {
    const writes = (window as unknown as { __pendingWrites: Array<{ reject: (err: Error) => void }> }).__pendingWrites;
    writes.shift()?.reject(new Error('Clipboard denied'));
  });
  await expect(manualInput).toBeVisible();
  await expect(backLink).toBeFocused();
  await expect(manualInput).not.toBeFocused();

  // Narrow screens (390px and 768px): sidebar moves below the title and above the reading body
  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    const narrowGeo = await page.evaluate(() => {
      const header = document.querySelector('article.document-detail > .reading-header')!.getBoundingClientRect();
      const sidebar = document.querySelector('article.document-detail > .reading-sidebar')!.getBoundingClientRect();
      const column = document.querySelector('article.document-detail > .reading-column')!.getBoundingClientRect();
      return {
        headerBottom: header.bottom,
        sidebarTop: sidebar.top,
        sidebarBottom: sidebar.bottom,
        columnTop: column.top,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(narrowGeo.sidebarTop, `${width}px doc: sidebar below title`).toBeGreaterThanOrEqual(narrowGeo.headerBottom - 1);
    expect(narrowGeo.columnTop, `${width}px doc: body below sidebar`).toBeGreaterThanOrEqual(narrowGeo.sidebarBottom - 1);
    expect(narrowGeo.overflow, `${width}px doc: zero overflow`).toBeLessThanOrEqual(0);
  }

  // Print media on research document: reading-layout is display:block and sidebar chrome is hidden
  await page.setViewportSize({ width: 691, height: 960 });
  await page.emulateMedia({ media: 'print' });
  const docPrint = await page.evaluate(() => {
    const article = document.querySelector('article.document-detail')!;
    const sidebar = document.querySelector('article.document-detail > .reading-sidebar')!;
    const column = document.querySelector('article.document-detail > .reading-column')!;
    return {
      layoutDisplay: getComputedStyle(article).display,
      sidebarDisplay: getComputedStyle(sidebar).display,
      columnWidth: column.getBoundingClientRect().width,
      clientWidth: document.documentElement.clientWidth,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  expect(docPrint.layoutDisplay).toBe('block');
  expect(docPrint.sidebarDisplay).toBe('none');
  expect(docPrint.columnWidth).toBeGreaterThanOrEqual(docPrint.clientWidth - 2);
  expect(docPrint.overflow).toBeLessThanOrEqual(0);
  await page.emulateMedia({ media: 'screen' });

  // 2. Research document with zero section headings (/research/fixture-research-notes): omits empty On this page nav, keeps Downloads & Share
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/research/fixture-research-notes');
  await expect(page.getByRole('navigation', { name: 'On this page' })).toHaveCount(0);
  await expect(page.locator('article.document-detail > .reading-sidebar .document-downloads a')).toHaveCount(1);
  await expect(page.locator('article.document-detail > .reading-sidebar').getByRole('button', { name: 'Share' })).toBeVisible();

  // 3. About & methods (/about): reading layout, single eyebrow, single-sentence intro, sidebar On this page, anchors unobstructed
  await page.goto('/about');
  await expect(page.locator('.eyebrow')).toHaveCount(1);
  const aboutIntro = (await page.locator('.reading-header .section-intro').innerText()).trim();
  expect(aboutIntro.split(/(?<=[.!?])\s+/).filter(Boolean)).toHaveLength(1);

  const aboutDesktopGeo = await page.evaluate(() => {
    const brand = document.querySelector('.brand-button')!.getBoundingClientRect();
    const h1 = document.querySelector('article.about-page h1')!.getBoundingClientRect();
    const column = document.querySelector('article.about-page > .reading-column')!.getBoundingClientRect();
    const sidebar = document.querySelector('article.about-page > .reading-sidebar')!.getBoundingClientRect();
    return {
      brandLeft: brand.left,
      h1Left: h1.left,
      columnWidth: column.width,
      columnRight: column.right,
      sidebarLeft: sidebar.left,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  expect(Math.abs(aboutDesktopGeo.h1Left - aboutDesktopGeo.brandLeft)).toBeLessThanOrEqual(1);
  expect(aboutDesktopGeo.columnWidth).toBeLessThanOrEqual(760);
  expect(aboutDesktopGeo.sidebarLeft).toBeGreaterThanOrEqual(aboutDesktopGeo.columnRight - 1);
  expect(aboutDesktopGeo.overflow).toBeLessThanOrEqual(0);

  const aboutTocNav = page.locator('article.about-page > .reading-sidebar').getByRole('navigation', { name: 'On this page' });
  await expect(aboutTocNav).toBeVisible();
  await expect(aboutTocNav.locator('ul li a')).toHaveCount(7);

  // Clicking #inferred-ages and #how-to-cite scrolls cleanly into view with scroll-margin-top
  for (const anchor of ['#inferred-ages', '#how-to-cite']) {
    await aboutTocNav.locator(`a[href="${anchor}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/about${anchor}$`));
    const metrics = await page.locator(anchor).evaluate(el => ({
      top: el.getBoundingClientRect().top,
      scrollMarginTop: Number.parseFloat(getComputedStyle(el).scrollMarginTop),
    }));
    expect(metrics.top, `/about${anchor} should not be hidden above viewport`).toBeGreaterThanOrEqual(0);
    expect(metrics.scrollMarginTop, `/about${anchor} scroll-margin-top`).toBeGreaterThanOrEqual(24);
  }

  // Narrow viewport (390px) on /about: sidebar sits below title and above first section with zero overflow
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/about');
  const aboutNarrowGeo = await page.evaluate(() => {
    const header = document.querySelector('article.about-page > .reading-header')!.getBoundingClientRect();
    const sidebar = document.querySelector('article.about-page > .reading-sidebar')!.getBoundingClientRect();
    const column = document.querySelector('article.about-page > .reading-column')!.getBoundingClientRect();
    return {
      headerBottom: header.bottom,
      sidebarTop: sidebar.top,
      sidebarBottom: sidebar.bottom,
      columnTop: column.top,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  expect(aboutNarrowGeo.sidebarTop).toBeGreaterThanOrEqual(aboutNarrowGeo.headerBottom - 1);
  expect(aboutNarrowGeo.columnTop).toBeGreaterThanOrEqual(aboutNarrowGeo.sidebarBottom - 1);
  expect(aboutNarrowGeo.overflow).toBeLessThanOrEqual(0);

  // Print media on /about: reading-layout is display:block and sidebar is hidden
  await page.setViewportSize({ width: 691, height: 960 });
  await page.emulateMedia({ media: 'print' });
  const aboutPrint = await page.evaluate(() => {
    const article = document.querySelector('article.about-page')!;
    const sidebar = document.querySelector('article.about-page > .reading-sidebar')!;
    const column = document.querySelector('article.about-page > .reading-column')!;
    return {
      layoutDisplay: getComputedStyle(article).display,
      sidebarDisplay: getComputedStyle(sidebar).display,
      columnWidth: column.getBoundingClientRect().width,
      clientWidth: document.documentElement.clientWidth,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  expect(aboutPrint.layoutDisplay).toBe('block');
  expect(aboutPrint.sidebarDisplay).toBe('none');
  expect(aboutPrint.columnWidth).toBeGreaterThanOrEqual(aboutPrint.clientWidth - 2);
  expect(aboutPrint.overflow).toBeLessThanOrEqual(0);
  await page.emulateMedia({ media: 'screen' });
});
