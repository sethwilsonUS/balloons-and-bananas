import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { setTheme, waitForThemeSettled } from './helpers/theme';

const ALL_ROUTES = [
  { label: 'Home /', path: '/', waitFor: 'h1' },
  { label: 'Sessions /sessions', path: '/sessions', waitFor: '.session-card' },
  { label: 'Session detail /sessions/010815', path: '/sessions/010815', waitFor: '#transcript-heading' },
  { label: 'Search /search?q=locomotive', path: '/search?q=locomotive', waitFor: '.session-card' },
  { label: 'Research /research', path: '/research', waitFor: '.research-document' },
  { label: 'Research doc /research/fixture-provenance-guide', path: '/research/fixture-provenance-guide', waitFor: '.prose' },
  { label: 'About /about', path: '/about', waitFor: '#how-to-cite-heading' },
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

test('modular type scale custom properties, display serif on H1/H2 only, sans on chrome, zero remote fonts, distinct heading levels, and reading measure across all routes', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });

  // Track any outbound/remote font requests across all route visits
  const remoteFontRequests: string[] = [];
  page.on('request', req => {
    if (req.resourceType() === 'font' || /fonts\.(googleapis|gstatic)\.com/i.test(req.url())) {
      remoteFontRequests.push(req.url());
    }
  });

  const innerRouteH1Sizes = new Map<string, number>();

  for (const route of ALL_ROUTES) {
    await page.goto(route.path);
    await page.waitForSelector(route.waitFor, { state: 'visible' });

    // On /research, expand the first inline document so H3 and H4 are visible too
    if (route.path === '/research') {
      await page.locator('.research-document details.document-reading > summary').first().click();
      await expect(page.locator('.research-document .prose h4').first()).toBeVisible();
    }

    const audit = await page.evaluate(() => {
      const rootStyle = getComputedStyle(document.documentElement);
      const scaleTokens = [
        '--text-xs',
        '--text-sm',
        '--text-base',
        '--text-lg',
        '--text-xl',
        '--text-2xl',
        '--text-3xl',
        '--text-display',
        '--leading-tight',
        '--leading-snug',
        '--leading-normal',
        '--leading-reading',
        '--measure-reading',
      ].map(token => ({ token, value: rootStyle.getPropertyValue(token).trim() }));

      const isSerifFont = (fontFamily: string) => /iowan|palatino|book antiqua|georgia|serif/i.test(fontFamily)
        && !/sans-serif/i.test(fontFamily);

      const visibleHeadings = [...document.querySelectorAll<HTMLElement>('main h1, main h2, main h3, main h4')]
        .filter(el => el.offsetParent !== null)
        .map(el => {
          const style = getComputedStyle(el);
          return {
            tag: el.tagName.toLowerCase(),
            text: el.textContent?.trim().slice(0, 50) || '',
            fontSize: Number.parseFloat(style.fontSize),
            fontFamily: style.fontFamily,
            isSerif: isSerifFont(style.fontFamily),
          };
        });

      const chromeSelectors = [
        '.section-nav a',
        '.button',
        '.eyebrow',
        '.catalog-record dt',
        '.catalog-record dd',
        '.origin-badge',
        '.session-index',
        '.moment-number',
        'table th',
      ];
      const serifChrome: Array<{ selector: string; fontFamily: string }> = [];
      for (const selector of chromeSelectors) {
        for (const el of document.querySelectorAll<HTMLElement>(selector)) {
          if (el.offsetParent === null) continue;
          const fontFamily = getComputedStyle(el).fontFamily;
          if (isSerifFont(fontFamily)) {
            serifChrome.push({ selector, fontFamily });
          }
        }
      }

      const fontFaceCount = document.fonts ? document.fonts.size : 0;

      return { scaleTokens, visibleHeadings, serifChrome, fontFaceCount };
    });

    for (const { token, value } of audit.scaleTokens) {
      expect(value, `${route.label}: missing CSS custom property ${token}`).not.toBe('');
    }
    expect(audit.fontFaceCount, `${route.label}: zero remote @font-face declarations`).toBe(0);
    expect(audit.serifChrome, `${route.label}: chrome elements must use sans, never display serif`).toEqual([]);

    const byTag = (tag: string) => audit.visibleHeadings.filter(h => h.tag === tag);
    const h1s = byTag('h1');
    const h2s = byTag('h2');
    const h3s = byTag('h3');
    const h4s = byTag('h4');

    expect(h1s.length, `${route.label}: exactly one visible H1`).toBe(1);
    expect(h1s[0].isSerif, `${route.label}: H1 must use display serif (${h1s[0].fontFamily})`).toBe(true);
    for (const h2 of h2s) {
      expect(h2.isSerif, `${route.label}: H2 "${h2.text}" must use display serif (${h2.fontFamily})`).toBe(true);
    }
    for (const h3 of h3s) {
      expect(h3.isSerif, `${route.label}: H3 "${h3.text}" must use sans (${h3.fontFamily})`).toBe(false);
    }
    for (const h4 of h4s) {
      expect(h4.isSerif, `${route.label}: H4 "${h4.text}" must use sans (${h4.fontFamily})`).toBe(false);
    }

    if (h2s.length > 0) {
      const maxH2 = Math.max(...h2s.map(h => h.fontSize));
      expect(h1s[0].fontSize, `${route.label}: H1 > H2`).toBeGreaterThan(maxH2 * 1.15);
    }
    if (h2s.length > 0 && h3s.length > 0) {
      const minH2 = Math.min(...h2s.map(h => h.fontSize));
      const maxH3 = Math.max(...h3s.map(h => h.fontSize));
      expect(minH2, `${route.label}: H2 (${minH2}px) > H3 (${maxH3}px)`).toBeGreaterThan(maxH3 * 1.1);
    }
    if (h3s.length > 0 && h4s.length > 0) {
      const minH3 = Math.min(...h3s.map(h => h.fontSize));
      const maxH4 = Math.max(...h4s.map(h => h.fontSize));
      expect(minH3, `${route.label}: H3 (${minH3}px) > H4 (${maxH4}px)`).toBeGreaterThan(maxH4);
    }

    if (route.path !== '/') {
      innerRouteH1Sizes.set(route.label, h1s[0].fontSize);
    }
  }

  expect(remoteFontRequests, 'Zero remote font network requests').toEqual([]);

  // Every inner route shares the exact same page-level H1 scale
  const sizes = [...innerRouteH1Sizes.values()];
  expect(Math.max(...sizes) - Math.min(...sizes), `Inner route H1 sizes drifted: ${JSON.stringify([...innerRouteH1Sizes])}`).toBeLessThanOrEqual(1);

  // Verify reading prose measure is capped comfortably on a wide 1440px desktop viewport
  await page.setViewportSize({ width: 1440, height: 900 });
  const proseChecks = [
    { path: '/sessions', selector: '.card-overview' },
    { path: '/sessions/010815', selector: '.detail-overview' },
    { path: '/sessions/010815', selector: '.moment-body > p' },
    { path: '/sessions/010815', selector: '.transcript-line p.transcript-text' },
    { path: '/research/fixture-provenance-guide', selector: '.prose p' },
    { path: '/about', selector: '.about-section p' },
  ];
  for (const check of proseChecks) {
    await page.goto(check.path);
    const el = page.locator(check.selector).first();
    await expect(el).toBeVisible();
    const metrics = await el.evaluate(node => {
      const style = getComputedStyle(node);
      return {
        maxWidth: style.maxWidth,
        renderedWidth: node.getBoundingClientRect().width,
      };
    });
    expect(metrics.maxWidth, `${check.path} ${check.selector} should cap max-width`).not.toBe('none');
    expect(metrics.renderedWidth, `${check.path} ${check.selector} width (${metrics.renderedWidth}px) should stay at comfortable reading measure`).toBeLessThanOrEqual(760);
  }
});

test('shared semantic <dl> CatalogRecord renders across session pages, browse cards, and search hits with clean VoiceOver spacing and reduced badges', async ({ page }) => {
  const assertCleanDefinitionListSpacing = async (locator: ReturnType<Page['locator']>, contextLabel: string) => {
    const details = await locator.evaluate(dl => {
      const dts = [...dl.querySelectorAll('dt')];
      const dds = [...dl.querySelectorAll('dd')];
      const text = dl.textContent || '';
      const rowTexts = [...dl.querySelectorAll('.catalog-record-row')].map(row => row.textContent || '');
      return {
        tagName: dl.tagName.toLowerCase(),
        dtCount: dts.length,
        ddCount: dds.length,
        dtTexts: dts.map(el => el.textContent?.trim() || ''),
        ddTexts: dds.map(el => el.textContent?.trim() || ''),
        text,
        rowTexts,
      };
    });
    expect(details.tagName, `${contextLabel}: must be a <dl>`).toBe('dl');
    expect(details.dtCount, `${contextLabel}: non-empty <dt> count`).toBeGreaterThanOrEqual(3);
    expect(details.ddCount, `${contextLabel}: matching <dt>/<dd> count`).toBe(details.dtCount);
    // Verify <dt> and <dd> are separated by whitespace in textContent (no concatenated words/digits)
    for (let i = 0; i < details.dtTexts.length; i += 1) {
      const dtText = details.dtTexts[i];
      const ddStart = details.ddTexts[i].split(/\s+/)[0];
      if (dtText && ddStart) {
        expect(
          details.rowTexts[i],
          `${contextLabel}: <dt> "${dtText}" and <dd> "${ddStart}" must not concatenate without whitespace`,
        ).not.toContain(`${dtText}${ddStart}`);
      }
    }
    return details;
  };

  // 1. Session page (/sessions/010815): full catalog record + calm AI guide label (no pill box)
  await page.goto('/sessions/010815');
  const fullRecord = page.locator('dl.catalog-record.catalog-record--full');
  await expect(fullRecord).toBeVisible();
  const fullDetails = await assertCleanDefinitionListSpacing(fullRecord, '/sessions/010815 full catalog record');
  expect(fullDetails.dtTexts).toEqual(['Session ID', 'Age', 'Date', 'Transcript origin', 'Recordings', 'Guide', 'Cite & share']);

  // Reduced badges: .ai-badge has no pill border or filled background; .origin-badge retains semantic colour
  const badgeStyles = await page.evaluate(() => {
    const ai = document.querySelector('.ai-badge');
    const origin = document.querySelector('dl.catalog-record .origin-badge');
    const eyebrow = document.querySelector('.detail-header .eyebrow');
    const mutedSample = document.querySelector('.muted');
    if (!ai || !origin || !eyebrow || !mutedSample) throw new Error('Missing badge, eyebrow, or muted elements');
    const aiStyle = getComputedStyle(ai);
    const originStyle = getComputedStyle(origin);
    const eyebrowStyle = getComputedStyle(eyebrow);
    const mutedStyle = getComputedStyle(mutedSample);
    return {
      aiBg: aiStyle.backgroundColor,
      aiBorderWidth: aiStyle.borderTopWidth,
      originBg: originStyle.backgroundColor,
      eyebrowColor: eyebrowStyle.color,
      mutedColor: mutedStyle.color,
    };
  });
  expect(badgeStyles.aiBg).toBe('rgba(0, 0, 0, 0)');
  expect(badgeStyles.aiBorderWidth).toBe('0px');
  expect(badgeStyles.originBg).not.toBe('rgba(0, 0, 0, 0)');
  // Non-origin eyebrow uses neutral muted ink, not rust accent colour
  expect(badgeStyles.eyebrowColor).toBe(badgeStyles.mutedColor);

  // 2. Sessions browse page (/sessions): Details card & List compact catalog records + calm jump-nav counts
  await page.goto('/sessions');
  const browseCards = page.locator('.session-card dl.catalog-record.catalog-record--card');
  await expect(browseCards).toHaveCount(4);
  await assertCleanDefinitionListSpacing(browseCards.first(), '/sessions Details card 0');
  await assertCleanDefinitionListSpacing(browseCards.nth(2), '/sessions Details card 2 (inferred age)');
  await expect(browseCards.nth(2)).toContainText('Unreviewed machine draft');

  // Jump-to-age count has no grey pill fill
  const jumpCountBg = await page.locator('.age-jump-nav .nav-count').first().evaluate(el => getComputedStyle(el).backgroundColor);
  expect(jumpCountBg).toBe('rgba(0, 0, 0, 0)');

  // Switch to List view: compact <dl> catalog records render for every row
  await page.getByRole('button', { name: 'List', exact: true }).click();
  const browseCompact = page.locator('.session-list-row dl.catalog-record.catalog-record--compact');
  await expect(browseCompact).toHaveCount(4);
  await assertCleanDefinitionListSpacing(browseCompact.nth(2), '/sessions List row 2');
  await page.getByRole('button', { name: 'Details', exact: true }).click();

  // 3. Search hits (/search?q=locomotive): Details card & List compact catalog records
  await page.goto('/search?q=locomotive');
  const searchCards = page.locator('.session-card dl.catalog-record.catalog-record--card');
  await expect(searchCards).toHaveCount(2);
  await assertCleanDefinitionListSpacing(searchCards.first(), '/search Details hit 0');
  await assertCleanDefinitionListSpacing(searchCards.nth(1), '/search Details hit 1 (local AI draft)');
  await expect(searchCards.nth(1)).toContainText('Unreviewed machine draft');
  await expect(searchCards.nth(1).getByRole('link', { name: /\(inferred from filename\)/i })).toHaveAttribute('href', '/about#inferred-ages');

  await page.getByRole('button', { name: 'List', exact: true }).click();
  const searchCompact = page.locator('.session-list-row dl.catalog-record.catalog-record--compact');
  await expect(searchCompact).toHaveCount(2);
  await assertCleanDefinitionListSpacing(searchCompact.nth(1), '/search List hit 1');
});

test('all 7 routes pass axe in light, dark, and system themes, reflow cleanly at 320px, and respect prefers-reduced-motion', async ({ page }) => {
  for (const route of ALL_ROUTES) {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(route.path);
    await page.waitForSelector(route.waitFor, { state: 'visible' });

    await auditAllThemes(page, route.label);

    // 320px narrow viewport reflow: zero horizontal overflow
    await page.setViewportSize({ width: 320, height: 800 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${route.label}: horizontal overflow at 320px (${overflow}px)`).toBeLessThanOrEqual(0);
  }

  // Verify prefers-reduced-motion zeroes transitions cleanly
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/sessions/010815');
  const buttonDuration = await page.locator('.button').first().evaluate(el => getComputedStyle(el).transitionDuration);
  expect(buttonDuration).toBe('0s');
});
