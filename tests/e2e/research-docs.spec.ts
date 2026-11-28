import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

type ThemeChoice = 'light' | 'dark';

async function waitForThemeSettled(page: Page, expectedDark: boolean) {
  const expectedPaper = expectedDark ? 'rgb(24, 31, 26)' : 'rgb(247, 244, 237)';
  const expectedPaperLight = expectedDark ? 'rgb(34, 44, 36)' : 'rgb(252, 250, 245)';
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
    .toBe(expectedPaper);
  const shareButton = page.locator('.share-button');
  if (await shareButton.count()) {
    await expect
      .poll(() => shareButton.evaluate(el => getComputedStyle(el).backgroundColor))
      .toBe(expectedPaperLight);
  }
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

async function setTheme(page: Page, theme: ThemeChoice) {
  await page.getByLabel('Appearance').selectOption(theme);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await waitForThemeSettled(page, theme === 'dark');
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

async function auditBothThemes(page: Page, viewLabel: string) {
  await setTheme(page, 'light');
  await expectNoSeriousAxeViolations(page, `${viewLabel} (light)`);
  await setTheme(page, 'dark');
  await expectNoSeriousAxeViolations(page, `${viewLabel} (dark)`);
  await setTheme(page, 'light');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('research documents start collapsed, display each title once with category, description, and downloads, and support keyboard disclosure', async ({ page }) => {
  await page.goto('/?section=research');

  await expect(page.getByRole('heading', { level: 2, name: 'Research & context' })).toBeVisible();

  const cards = page.locator('.research-document');
  await expect(cards).toHaveCount(3);

  const expectedCards = [
    {
      category: 'Archive guide',
      title: 'Fixture annotation provenance guide',
      description: 'Explains how invented transcript origins and CHAT notation layers remain separate.',
      downloadLabel: 'Download provenance guide (MD)',
    },
    {
      category: 'Research material',
      title: 'Fixture research reading list',
      description: 'Invented corpus inventory table and research background for browser verification.',
      downloadLabel: 'Download research notes (MD)',
    },
    {
      category: 'Archive guide',
      title: 'Sources and methods',
      description: 'Explains transcript origins, source ages, filename-inferred ages, and fixture limits.',
      downloadLabel: 'Download methods note (MD)',
    },
  ];

  for (const [index, expected] of expectedCards.entries()) {
    const card = cards.nth(index);
    await expect(card.locator('.eyebrow')).toHaveText(expected.category);
    await expect(card.locator('h3')).toHaveText(expected.title);
    await expect(card).toContainText(expected.description);
    await expect(card.locator('.document-downloads a')).toContainText(expected.downloadLabel);

    // Collapsed by default
    const details = card.locator('details.document-reading');
    await expect(details).not.toHaveAttribute('open', '');
    await expect(details.locator('.prose')).toBeHidden();

    // Visible text displays the document title exactly once
    const visibleText = await card.innerText();
    const titleMatches = visibleText.match(new RegExp(escapeRegExp(expected.title), 'gi')) ?? [];
    expect(titleMatches.length, `Expected "${expected.title}" once in collapsed card`).toBe(1);

    // Summary carries a unique accessible name combining action + title
    const summary = details.locator('summary');
    await expect(summary).toHaveText('Read document');
    await expect(summary).toHaveAccessibleName(`Read document ${expected.title}`);
  }

  await auditBothThemes(page, 'research documents collapsed');

  // Keyboard toggle opens the first document without duplicating its leading title heading
  const firstCard = cards.nth(0);
  const firstSummary = firstCard.locator('details.document-reading > summary');
  await firstSummary.focus();
  await expect(firstSummary).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(firstCard.locator('details.document-reading')).toHaveAttribute('open', '');
  await expect(firstCard.locator('.prose')).toBeVisible();
  await expect(firstCard.locator('.prose h4')).toHaveText('Transcript layers');
  await expect(firstCard.locator('.prose h5')).toHaveText('Editorial markers');

  const expandedVisibleText = await firstCard.innerText();
  const expandedMatches = expandedVisibleText.match(/Fixture annotation provenance guide/gi) ?? [];
  expect(expandedMatches.length, 'Expected title once even after expanding inline document').toBe(1);

  await auditBothThemes(page, 'research document expanded');

  // Keyboard Space closes it again
  await firstSummary.focus();
  await page.keyboard.press('Space');
  await expect(firstCard.locator('details.document-reading')).not.toHaveAttribute('open', '');
  await expect(firstCard.locator('.prose')).toBeHidden();
});

test('document reader shows page H1 visibly larger than document headings, strips duplicate leading title, and renders 3-column escaped-pipe table cleanly', async ({ page }) => {
  await page.goto('/?section=research');

  // Clicking the document card title opens the standalone document reader
  await page.getByRole('link', { name: 'Fixture annotation provenance guide' }).click();

  const detail = page.locator('article.document-detail');
  const docTitle = detail.locator('> h2');
  await expect(docTitle).toHaveText('Fixture annotation provenance guide');
  await expect(docTitle).toBeFocused();

  // Leading markdown H1 duplicating the title is stripped and not shown twice
  const detailText = await detail.innerText();
  const titleOccurrences = detailText.match(/Fixture annotation provenance guide/gi) ?? [];
  expect(titleOccurrences.length, 'Expected document title to appear once in reader').toBe(1);
  await expect(detail.locator('.prose h1, .prose h2')).toHaveCount(0);

  // Document's own headings render cleanly as h3 -> h4
  const sectionHeading = detail.locator('.prose h3').first();
  const subHeading = detail.locator('.prose h4').first();
  await expect(sectionHeading).toHaveText('Transcript layers');
  await expect(subHeading).toHaveText('Editorial markers');

  // Verify visual font-size hierarchy at desktop and tablet viewports: page H1 > doc H2 > doc H3 > doc H4
  for (const viewport of [{ width: 1280, height: 800 }, { width: 768, height: 900 }]) {
    await page.setViewportSize(viewport);
    const sizes = await page.evaluate(() => {
      const parse = (selector: string) => {
        const el = document.querySelector(selector);
        if (!el) throw new Error(`Missing selector: ${selector}`);
        return Number.parseFloat(getComputedStyle(el).fontSize);
      };
      return {
        h1: parse('header h1'),
        docH2: parse('article.document-detail > h2'),
        proseH3: parse('article.document-detail .prose h3'),
        proseH4: parse('article.document-detail .prose h4'),
      };
    });

    expect(sizes.h1, `H1 (${sizes.h1}px) must be visibly larger than document H2 (${sizes.docH2}px) at ${viewport.width}px`).toBeGreaterThan(sizes.docH2 * 1.15);
    expect(sizes.docH2, `Document H2 (${sizes.docH2}px) must be larger than section H3 (${sizes.proseH3}px) at ${viewport.width}px`).toBeGreaterThan(sizes.proseH3);
    expect(sizes.proseH3, `Section H3 (${sizes.proseH3}px) must be larger than subsection H4 (${sizes.proseH4}px) at ${viewport.width}px`).toBeGreaterThan(sizes.proseH4);
  }
  await page.setViewportSize({ width: 1280, height: 800 });

  // Verify 3-column table with escaped pipe in code span renders 3 intact columns per row
  const table = detail.locator('.table-scroll table');
  await expect(table).toBeVisible();
  await expect(table.locator('thead th')).toHaveText(['Layer', 'Notation example', 'Provenance note']);

  const rows = table.locator('tbody tr');
  await expect(rows).toHaveCount(3);
  for (let i = 0; i < 3; i += 1) {
    await expect(rows.nth(i).locator('td')).toHaveCount(3);
  }
  await expect(rows.nth(2).locator('td').nth(0)).toHaveText('Local AI draft');
  await expect(rows.nth(2).locator('td').nth(1).locator('code')).toHaveText('plain text | JSON');
  await expect(rows.nth(2).locator('td').nth(2)).toHaveText('Local speech-recognition fixture without CHAT notation');

  await auditBothThemes(page, 'document reader with provenance table');
});
