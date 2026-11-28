import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

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

test('sessions default to Age, youngest first with labelled inferred ages, support oldest-first and query relevance, and link to the explanation', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Sessions/i }).click();

  const sortSelect = page.getByLabel('Sort by');
  await expect(sortSelect).toHaveValue('age-asc');
  await expect(sortSelect.locator('option')).toHaveText([
    'Age, youngest first',
    'Age, oldest first',
    'Relevance',
  ]);

  // Default order without a query: youngest first using source-or-inferred age, with no-age last
  // even though Cardboard observatory has a calendar date.
  const cardHeadings = page.locator('.session-card h4 a');
  await expect(cardHeadings).toHaveText([
    'Blue locomotive and wooden bridge',
    'Yellow submarine in the courtyard',
    'Paper lighthouse and harbor bells',
    'Cardboard observatory without audio',
  ]);

  // Source ages render without "(inferred from filename)".
  const locomotiveMeta = page.locator('.session-card').nth(0).locator('.session-meta');
  await expect(locomotiveMeta).toContainText('Age 1 year, 8 months, 15 days');
  await expect(locomotiveMeta).not.toContainText('inferred from filename');

  // Inferred age renders with italicized "(inferred from filename)" link to /about#inferred-ages and no nested interactive links.
  const lighthouseMeta = page.locator('.session-card').nth(2).locator('.session-meta');
  await expect(lighthouseMeta).toContainText('Age 2 years, 6 months, 4 days (inferred from filename)');
  const inferredLink = lighthouseMeta.getByRole('link', { name: /\(inferred from filename\)/i });
  await expect(inferredLink).toBeVisible();
  await expect(inferredLink).toHaveAttribute('href', '/about#inferred-ages');
  await expect(inferredLink.locator('em')).toHaveText('(inferred from filename)');

  const nestedLinks = await page.evaluate(() => document.querySelectorAll('a a, button a, a button').length);
  expect(nestedLinks).toBe(0);

  // List view also displays the labelled inferred age link cleanly.
  await page.getByRole('button', { name: 'List', exact: true }).click();
  const listLighthouseMeta = page.locator('.session-list-row').nth(2).locator('.session-meta');
  await expect(listLighthouseMeta).toContainText('Age 2 years, 6 months, 4 days (inferred from filename)');
  await expect(listLighthouseMeta.getByRole('link', { name: /\(inferred from filename\)/i })).toBeVisible();
  await page.getByRole('button', { name: 'Details', exact: true }).click();

  await auditAllThemes(page, 'sessions with inferred ages');

  // Switch to Age, oldest first: reverses aged sessions while keeping no-age session last.
  await sortSelect.selectOption('age-desc');
  await expect(cardHeadings).toHaveText([
    'Paper lighthouse and harbor bells',
    'Yellow submarine in the courtyard',
    'Blue locomotive and wooden bridge',
    'Cardboard observatory without audio',
  ]);

  // Entering a query defaults sort to Relevance; toggling to Age, oldest first reorders query results.
  const searchInput = page.getByLabel('Search sessions and transcripts');
  await searchInput.fill('locomotive');
  await expect(sortSelect).toHaveValue('relevance');
  await page.locator('.search-form').getByRole('button', { name: 'Search' }).click();
  await expect(cardHeadings).toHaveText([
    'Blue locomotive and wooden bridge',
    'Paper lighthouse and harbor bells',
  ]);

  await sortSelect.selectOption('age-desc');
  await expect(cardHeadings).toHaveText([
    'Paper lighthouse and harbor bells',
    'Blue locomotive and wooden bridge',
  ]);

  // Clearing filters resets sort back to Age, youngest first.
  await page.getByRole('button', { name: /Clear filters/i }).click();
  await expect(sortSelect).toHaveValue('age-asc');
  await expect(cardHeadings).toHaveText([
    'Blue locomotive and wooden bridge',
    'Yellow submarine in the courtyard',
    'Paper lighthouse and harbor bells',
    'Cardboard observatory without audio',
  ]);

  // Activating the "(inferred from filename)" link via keyboard opens /about#inferred-ages.
  const resultsInferredLink = page.locator('.session-card').nth(2).getByRole('link', { name: /\(inferred from filename\)/i });
  await resultsInferredLink.focus();
  await expect(resultsInferredLink).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(/\/about#inferred-ages$/);
  await expect(page.getByRole('heading', { level: 1, name: 'About & methods' })).toBeVisible();
  await expect(page.locator('#inferred-ages')).toBeVisible();
  await expect(page.locator('article.about-page')).toContainText('78 of 78');
  await expect(page.locator('article.about-page')).toContainText('Calendar dates are never inferred.');

  // Browser Back returns to the sessions list cleanly.
  await page.goBack();
  await expect(page.getByRole('heading', { level: 2, name: 'Find a session' })).toBeVisible();
});

test('session detail displays inferred age separately from source age, links to /about#inferred-ages, and passes axe in all themes', async ({ page }) => {
  await page.goto('/?entry=fixture-020604-lighthouse');

  await expect(page.getByRole('heading', { level: 2, name: 'Paper lighthouse and harbor bells' })).toBeVisible();
  const detailMeta = page.locator('.detail-header .session-meta');
  await expect(detailMeta).toContainText('Age 2 years, 6 months, 4 days (inferred from filename)');
  const detailLink = detailMeta.getByRole('link', { name: /\(inferred from filename\)/i });
  await expect(detailLink).toHaveAttribute('href', '/about#inferred-ages');
  await expect(detailLink.locator('em')).toHaveText('(inferred from filename)');

  // Source identification keeps inferred age notation clearly labelled and separate from CHAT source age.
  const technicalNotes = page.locator('details.technical-notes');
  await technicalNotes.locator('summary').click();
  await expect(technicalNotes).toContainText('Inferred age notation (from filename): 2;06.04');
  await expect(technicalNotes).not.toContainText('Stored age notation (CHAT):');

  await auditAllThemes(page, 'session detail with inferred age');

  // Following the link opens the /about#inferred-ages methods section.
  await detailLink.click();
  await expect(page).toHaveURL(/\/about#inferred-ages$/);
  await expect(page.getByRole('heading', { level: 1, name: 'About & methods' })).toBeVisible();
  await expect(page.locator('#inferred-ages')).toBeVisible();
});

test('/api/search rejects legacy and invalid sort values with 400', async ({ request, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  for (const invalidSort of ['oldest', 'newest', 'invalid']) {
    const res = await request.post('/api/search', {
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      data: { sort: invalidSort },
    });
    expect(res.status(), `Expected 400 for sort=${invalidSort}`).toBe(400);
  }
  const ok = await request.post('/api/search', {
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    data: { sort: 'age-desc' },
  });
  expect(ok.status()).toBe(200);
  const body = await ok.json() as { results: Array<{ session: { id: string; ages: string[]; inferredAge: string | null } }> };
  expect(body.results.map(item => item.session.id)).toEqual([
    'fixture-020604-lighthouse',
    'fixture-020110-submarine',
    'fixture-010815-locomotive',
    'fixture-011103-observatory',
  ]);
  expect(body.results[0].session.ages).toEqual([]);
  expect(body.results[0].session.inferredAge).toBe('2;06.04');
});
