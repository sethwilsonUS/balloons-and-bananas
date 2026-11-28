import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIResponse, type Page } from '@playwright/test';
import { extractPdfText, normalizePdfText } from './helpers/pdf-text';

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

function expectPrivateHeaders(response: APIResponse, label: string) {
  const headers = response.headers();
  expect(headers['cache-control'] || '', `${label}: Cache-Control no-store`).toMatch(/\bno-store\b/i);
  expect(headers['cdn-cache-control'] || '', `${label}: CDN-Cache-Control no-store`).toMatch(/\bno-store\b/i);
  expect(headers['vercel-cdn-cache-control'] || '', `${label}: Vercel-CDN-Cache-Control no-store`).toMatch(/\bno-store\b/i);
  expect(headers['x-robots-tag'] || '', `${label}: X-Robots-Tag noindex`).toMatch(/\bnoindex\b/i);
  expect(headers['referrer-policy'], `${label}: Referrer-Policy no-referrer`).toBe('no-referrer');
}

function expectOrderedSubstrings(
  haystack: string,
  milestones: Array<{ label: string; needle: string | RegExp }>,
) {
  let cursor = -1;
  for (const { label, needle } of milestones) {
    let idx = -1;
    if (typeof needle === 'string') {
      idx = haystack.indexOf(needle, cursor + 1);
    } else {
      const slice = haystack.slice(cursor + 1);
      const match = needle.exec(slice);
      if (match) idx = cursor + 1 + match.index;
    }
    expect(
      idx,
      `Expected "${label}" (${String(needle)}) to appear after position ${cursor} in PDF text.\nPDF text excerpt:\n${haystack.slice(Math.max(0, cursor), Math.max(0, cursor) + 500)}`,
    ).toBeGreaterThan(cursor);
    cursor = idx;
  }
}

test('print media hides navigation, audio player, interactive buttons, and open dialogs, expands source identification, and enforces black-on-white typography and page-break rules even from dark theme', async ({ page, baseURL }) => {
  await page.goto('/sessions/010815');

  // Switch to explicit dark theme AND dark colorScheme before printing to prove black-on-white override.
  await page.emulateMedia({ colorScheme: 'dark' });
  await setTheme(page, 'dark', true);

  // Open the Cite dialog before entering print media to prove open modal <dialog> chrome is hidden on print.
  await page.locator('dl.catalog-record').getByRole('button', { name: 'Cite this session' }).click();
  await expect(page.locator('dialog.cite-dialog[open]')).toBeVisible();

  // Verify print-only elements are hidden on screen before print emulation.
  await expect(page.locator('.print-session-header')).toBeHidden();
  await expect(page.locator('.print-citation-section')).toBeHidden();

  // Emulate print media at US Letter printable width (~691px).
  await page.setViewportSize({ width: 691, height: 960 });
  await page.emulateMedia({ media: 'print', colorScheme: 'dark' });

  // Hidden chrome in print: nav, audio player, buttons, downloads, search, and open dialog.
  const hiddenSelectors = [
    '.skip-link',
    '.site-header',
    '.top-bar',
    '.section-nav',
    '.session-adjacent-nav',
    '.session-sticky-nav',
    '.site-footer',
    '.audio-panel',
    '.catalog-cite-row',
    '.moment-actions',
    '.transcript-playback-tools',
    '.transcript-view-controls',
    '.transcript-search',
    '.passage-actions',
    '.cue-button',
    '.source-downloads',
    'dialog.cite-dialog',
  ];
  for (const selector of hiddenSelectors) {
    const count = await page.locator(selector).count();
    expect(count, `Expected fixture to include ${selector}`).toBeGreaterThan(0);
    const allHidden = await page.locator(selector).evaluateAll(els =>
      els.every(el => getComputedStyle(el).display === 'none'),
    );
    expect(allHidden, `Expected all ${selector} elements to have display:none in print`).toBe(true);
  }

  // Visible scholarly document elements in print.
  const printHeader = page.locator('.print-session-header');
  await expect(printHeader).toBeVisible();
  await expect(printHeader).toContainText('The Seth Tapes · Session 010815');
  await expect(printHeader).toContainText(`${baseURL}/sessions/010815`);

  await expect(page.locator('dl.catalog-record')).toBeVisible();
  await expect(page.locator('.guide-overview-section')).toBeVisible();
  await expect(page.locator('.moments-section')).toBeVisible();

  const printCitation = page.locator('.print-citation-section');
  await expect(printCitation).toBeVisible();
  await expect(printCitation).toContainText('Peters, Ann, and Bob Wilson.');
  await expect(printCitation).toContainText('"Session 010815" (age 1;08.15; recorded January 15, 1983).');
  await expect(printCitation).toContainText('Archived research transcript.');
  await expect(printCitation).toContainText(`${baseURL}/sessions/010815`);
  await expect(printCitation).not.toContainText('Blue locomotive and wooden bridge');

  // Every transcript passage is visible with passage numbers and plain-text timestamps (no button).
  await expect(page.locator('.transcript-line')).toHaveCount(5);
  for (let n = 1; n <= 5; n += 1) {
    await expect(page.locator(`#p${n}`)).toBeVisible();
    await expect(page.locator(`#p${n} .passage-anchor`)).toContainText(`#${n}`);
  }
  await expect(page.locator('#p1 .transcript-timestamp')).toBeVisible();
  await expect(page.locator('#p1 .transcript-timestamp')).toHaveText('0:00');

  // Closed <details class="technical-notes"> content is expanded in print media.
  await expect(page.locator('.technical-notes')).toContainText('Source identification');
  await expect(page.locator('.technical-notes code').first()).toBeVisible();
  await expect(page.locator('.technical-notes code').first()).toHaveText('010815.cha');

  // Verify black-on-white typography, content-visibility: visible, page-break rules, and zero overflow.
  const styleAudit = await page.evaluate(() => {
    const readColors = (selector: string) => {
      const el = document.querySelector(selector);
      if (!el) throw new Error(`Missing ${selector}`);
      const cs = getComputedStyle(el);
      return { color: cs.color, bg: cs.backgroundColor };
    };
    const passage = document.querySelector('#p2')!;
    const moment = document.querySelector('.moment-list > li')!;
    const catalog = document.querySelector('.catalog-record--full')!;
    const citation = document.querySelector('.print-citation-section')!;
    const heading = document.querySelector('#transcript-heading')!;

    return {
      body: readColors('body'),
      h1: readColors('h1'),
      catalog: readColors('.catalog-record--full'),
      overview: readColors('.detail-overview'),
      originBadge: readColors('.catalog-record .origin-badge'),
      momentText: readColors('.moment-body > p'),
      citation: readColors('.print-citation-section'),
      passageOdd: readColors('#p1'),
      passageEven: readColors('#p2'),
      passageText: readColors('#p2 .transcript-text'),
      passageContentVisibility: getComputedStyle(passage).contentVisibility,
      passageBreakInside: getComputedStyle(passage).breakInside,
      momentBreakInside: getComputedStyle(moment).breakInside,
      catalogBreakInside: getComputedStyle(catalog).breakInside,
      citationBreakInside: getComputedStyle(citation).breakInside,
      headingBreakAfter: getComputedStyle(heading).breakAfter,
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });

  expect(styleAudit.body).toEqual({ color: 'rgb(0, 0, 0)', bg: 'rgb(255, 255, 255)' });
  expect(styleAudit.h1.color).toBe('rgb(0, 0, 0)');
  expect(styleAudit.catalog).toEqual({ color: 'rgb(0, 0, 0)', bg: 'rgb(255, 255, 255)' });
  expect(styleAudit.overview.color).toBe('rgb(0, 0, 0)');
  expect(styleAudit.originBadge).toEqual({ color: 'rgb(0, 0, 0)', bg: 'rgb(255, 255, 255)' });
  expect(styleAudit.momentText.color).toBe('rgb(0, 0, 0)');
  expect(styleAudit.citation).toEqual({ color: 'rgb(0, 0, 0)', bg: 'rgb(255, 255, 255)' });
  expect(styleAudit.passageOdd.bg).toBe('rgb(255, 255, 255)');
  expect(styleAudit.passageEven.bg).toBe('rgb(255, 255, 255)');
  expect(styleAudit.passageText.color).toBe('rgb(0, 0, 0)');
  expect(styleAudit.passageContentVisibility).toBe('visible');
  expect(styleAudit.passageBreakInside).toBe('avoid');
  expect(styleAudit.momentBreakInside).toBe('avoid');
  expect(styleAudit.catalogBreakInside).toBe('avoid');
  expect(styleAudit.citationBreakInside).toBe('avoid');
  expect(styleAudit.headingBreakAfter).toBe('avoid');
  expect(styleAudit.horizontalOverflow).toBeLessThanOrEqual(0);
});

test('Chromium PDF render of fixture sessions contains all required sections in exact order with provenance intact and chrome excluded', async ({ page, baseURL }) => {
  // 1. Archived research session with source age, recording, and 5 passages (starting from dark theme).
  await page.goto('/sessions/010815');
  await setTheme(page, 'dark', true);

  const pdfBuffer = await page.pdf({ format: 'Letter', printBackground: true });
  expect(pdfBuffer.length).toBeGreaterThan(2000);
  expect(pdfBuffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');

  const extracted = extractPdfText(pdfBuffer);
  expect(extracted.pageCount).toBeGreaterThanOrEqual(1);
  const pdfText = normalizePdfText(extracted.text);

  expectOrderedSubstrings(pdfText, [
    { label: 'Print header line', needle: 'The Seth Tapes · Session 010815' },
    { label: 'Session title', needle: 'Blue locomotive and wooden bridge' },
    { label: 'Catalog record Session ID', needle: 'SESSION ID' },
    { label: 'Catalog record age', needle: '1 year, 8 months, 15 days' },
    { label: 'Catalog record date', needle: '1983-01-15' },
    { label: 'Catalog record origin', needle: 'Archived research transcript' },
    { label: 'Catalog record recordings', needle: 'Original MP3' },
    { label: 'Guide overview heading', needle: 'Guide overview' },
    { label: 'Guide overview text', needle: 'wooden track, naming stations, and sending a blue locomotive' },
    { label: 'Moments heading', needle: 'Moments' },
    { label: 'Moment 1', needle: 'Crossing the cardboard bridge' },
    { label: 'Moment 2', needle: 'Counting station lanterns' },
    { label: 'Citation heading', needle: 'Citation' },
    { label: 'Chicago citation author', needle: 'Peters, Ann, and Bob Wilson.' },
    { label: 'Chicago citation target', needle: '"Session 010815" (age 1;08.15; recorded January 15, 1983).' },
    { label: 'Chicago citation corpus DOI', needle: 'https://doi.org/10.21415/T5NS4D' },
    { label: 'Explicit page URL label', needle: 'Page URL:' },
    { label: 'Canonical page URL in citation block', needle: `${baseURL}/sessions/010815` },
    { label: 'Transcript heading', needle: 'Transcript' },
    { label: 'Passage #1', needle: /#\s*1\b/ },
    { label: 'Passage #1 timestamp', needle: '0:00' },
    { label: 'Passage #1 text', needle: 'blue blue locomotive!' },
    { label: 'Passage #2', needle: /#\s*2\b/ },
    { label: 'Passage #3', needle: /#\s*3\b/ },
    { label: 'Passage #4', needle: /#\s*4\b/ },
    { label: 'Passage #5', needle: /#\s*5\b/ },
    { label: 'Passage #5 text', needle: 'three lanterns over there' },
    { label: 'Sources & reading notes heading', needle: 'Sources & reading notes' },
    { label: 'Expanded Source identification disclosure', needle: '010815.cha' },
  ]);

  // Verify interactive screen chrome did NOT leak into the PDF.
  const forbiddenChrome = [
    'Skip to main content',
    'Copy share link',
    'Listen to the recording',
    'Back to results',
    'Find within this transcript',
    'Show linguistic notation',
    'Copy link',
    'Cite this session',
    'Previous session',
    'Next session',
    'Play audio',
  ];
  for (const snippet of forbiddenChrome) {
    expect(pdfText, `Hidden screen chrome "${snippet}" should not appear in printed PDF`).not.toContain(snippet);
  }

  // 2. Local AI draft session with inferred age and no recorded date: verify provenance qualifiers in PDF.
  await page.goto('/sessions/020604-local');
  const aiPdfBuffer = await page.pdf({ format: 'Letter', printBackground: true });
  expect(aiPdfBuffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');

  const aiPdfText = normalizePdfText(extractPdfText(aiPdfBuffer).text);
  expectOrderedSubstrings(aiPdfText, [
    { label: 'AI print header', needle: 'The Seth Tapes · Session 020604-local' },
    { label: 'AI catalog inferred age', needle: 'inferred from filename' },
    { label: 'AI guide overview', needle: 'folding a paper lighthouse' },
    { label: 'AI moments', needle: 'Harbor bell chorus' },
    { label: 'AI Chicago citation inferred age', needle: '"Session 020604-local" (inferred age 2;06.04).' },
    { label: 'AI Chicago citation unreviewed qualifier', needle: 'Local AI draft (machine transcription, unreviewed).' },
    { label: 'AI canonical URL', needle: `${baseURL}/sessions/020604-local` },
    { label: 'AI transcript passage #1', needle: 'Ring the harbor bell once for the morning ferry.' },
    { label: 'AI transcript passage #3', needle: 'Can the blue locomotive meet the ferry at the pier?' },
    { label: 'AI expanded source file', needle: '020604-local.json' },
  ]);

  // Guide title must never appear inside the Chicago citation block.
  const citationStart = aiPdfText.indexOf('Peters, Ann, and Bob Wilson.');
  const transcriptStart = aiPdfText.indexOf('Transcript', citationStart);
  expect(citationStart).toBeGreaterThan(-1);
  expect(transcriptStart).toBeGreaterThan(citationStart);
  const citationSlice = aiPdfText.slice(citationStart, transcriptStart);
  expect(citationSlice).not.toContain('Paper lighthouse and harbor bells');
  expect(citationSlice).not.toContain('recorded ');

  // 3. Unaged session without audio prints cleanly too.
  await page.goto('/sessions/011103');
  const unagedPdfBuffer = await page.pdf({ format: 'Letter', printBackground: true });
  const unagedPdfText = normalizePdfText(extractPdfText(unagedPdfBuffer).text);
  expectOrderedSubstrings(unagedPdfText, [
    { label: 'Unaged print header', needle: 'The Seth Tapes · Session 011103' },
    { label: 'Unaged catalog record', needle: 'None associated (transcript only)' },
    { label: 'Unaged Chicago citation', needle: '"Session 011103" (recorded April 3, 1983).' },
    { label: 'Unaged transcript passage #3', needle: 'compass star' },
  ]);

  // 4. Active Find filter (including a zero-match query) must still print the full numbered
  //    transcript in PDF and leave the reader's screen query & filtered state intact afterward.
  await page.goto('/sessions/010815');
  const findInput = page.getByLabel('Find within this transcript');
  await findInput.fill('zzznomatchphrase');
  await expect(page.locator('.transcript-line')).toHaveCount(0);
  await expect(page.getByText('0 matching passages')).toBeVisible();
  await expect(page.locator('.empty-inline')).toBeVisible();

  const filteredPdfBuffer = await page.pdf({ format: 'Letter', printBackground: true });
  const filteredPdfText = normalizePdfText(extractPdfText(filteredPdfBuffer).text);
  expectOrderedSubstrings(filteredPdfText, [
    { label: 'Filtered PDF header', needle: 'The Seth Tapes · Session 010815' },
    { label: 'Filtered PDF full passage count', needle: '5 transcript passages' },
    { label: 'Filtered PDF passage #1', needle: /#\s*1\b/ },
    { label: 'Filtered PDF passage #1 text', needle: 'blue blue locomotive!' },
    { label: 'Filtered PDF passage #5', needle: /#\s*5\b/ },
    { label: 'Filtered PDF passage #5 text', needle: 'three lanterns over there' },
  ]);
  expect(filteredPdfText).not.toContain('No matching passages');

  // After printing finishes, the screen Find query and zero-match state remain untouched.
  await expect(findInput).toHaveValue('zzznomatchphrase');
  await expect(page.locator('.transcript-line')).toHaveCount(0);
  await expect(page.getByText('0 matching passages')).toBeVisible();
});

test('screen view stays clean with zero hydration/console errors, private SSR headers, hidden print-only blocks, and zero axe violations across all themes', async ({ page, request, baseURL }) => {
  // SSR response includes private headers + server-rendered print header & Chicago citation,
  // and ignores spoofed x-forwarded-host / x-forwarded-proto headers (binds to Host).
  const ssrRes = await request.get('/sessions/010815', {
    headers: {
      'x-forwarded-host': 'spoofed.example',
      'x-forwarded-proto': 'https',
    },
  });
  expect(ssrRes.status()).toBe(200);
  expectPrivateHeaders(ssrRes, '/sessions/010815');
  const ssrHtml = await ssrRes.text();
  expect(ssrHtml).toContain('The Seth Tapes · Session 010815');
  expect(ssrHtml).toContain('Peters, Ann, and Bob Wilson.');
  expect(ssrHtml).toContain(`${baseURL}/sessions/010815`);
  expect(ssrHtml).not.toContain('spoofed.example');

  const aboutSsrRes = await request.get('/about', {
    headers: {
      'x-forwarded-host': 'spoofed.example',
      'x-forwarded-proto': 'https',
    },
  });
  expect(aboutSsrRes.status()).toBe(200);
  const aboutSsrHtml = await aboutSsrRes.text();
  expect(aboutSsrHtml).toContain(`${baseURL}/sessions/010626#p42`);
  expect(aboutSsrHtml).not.toContain('spoofed.example');

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => pageErrors.push(err.message));

  for (const sessionPath of ['/sessions/010815', '/sessions/020604-local']) {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(sessionPath);

    // Print-only elements are hidden on screen (display: none) and excluded from visual/a11y flow.
    await expect(page.locator('.print-session-header')).toBeHidden();
    await expect(page.locator('.print-citation-section')).toBeHidden();
    const hiddenDisplays = await page.evaluate(() => [
      getComputedStyle(document.querySelector('.print-session-header')!).display,
      getComputedStyle(document.querySelector('.print-citation-section')!).display,
    ]);
    expect(hiddenDisplays).toEqual(['none', 'none']);

    // Check axe across light, dark, system-dark, and system-light themes.
    await setTheme(page, 'light');
    await expectNoSeriousAxeViolations(page, `${sessionPath} (light)`);
    await setTheme(page, 'dark');
    await expectNoSeriousAxeViolations(page, `${sessionPath} (dark)`);
    await page.emulateMedia({ colorScheme: 'dark' });
    await setTheme(page, 'system', true);
    await expectNoSeriousAxeViolations(page, `${sessionPath} (system dark)`);
    await page.emulateMedia({ colorScheme: 'light' });
    await waitForThemeSettled(page, false);
    await expectNoSeriousAxeViolations(page, `${sessionPath} (system light)`);
    await setTheme(page, 'light');
  }

  // Verify beforeprint/afterprint restores user's open/closed <details> state on screen.
  await page.goto('/sessions/010815');
  const technicalNotes = page.locator('details.technical-notes');
  await expect(technicalNotes).not.toHaveAttribute('open', '');
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await expect(technicalNotes).toHaveAttribute('open', '');
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await expect(technicalNotes).not.toHaveAttribute('open', '');

  // If the reader manually opened Source identification, printing preserves open state afterward.
  await technicalNotes.locator('summary').click();
  await expect(technicalNotes).toHaveAttribute('open', '');
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await expect(technicalNotes).toHaveAttribute('open', '');

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
