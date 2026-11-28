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

test('age-band timeline renders semantic list navigator (zero canvas), VoiceOver-friendly accessible names, band headings with counts, and explicit source vs inferred age labels', async ({ page }) => {
  await page.goto('/sessions');

  // Compact band navigator is a real semantic <nav> with <ul>/<li> links and zero canvas charts.
  const nav = page.getByRole('navigation', { name: 'Jump to age band' });
  await expect(nav).toBeVisible();
  await expect(nav.locator('canvas')).toHaveCount(0);
  await expect(nav.locator('ul > li')).toHaveCount(4);

  const navLinks = nav.locator('ul > li > a');
  await expect(navLinks).toHaveCount(4);
  const expectedBands = [
    { href: '#age-1-6', name: '1;6–1;11 — 1 session', id: 'age-1-6', prose: '1 year, 6 to 11 months' },
    { href: '#age-2-0', name: '2;0–2;5 — 1 session', id: 'age-2-0', prose: '2 years, 0 to 5 months' },
    { href: '#age-2-6', name: '2;6–2;11 — 1 session', id: 'age-2-6', prose: '2 years, 6 to 11 months' },
    { href: '#age-unknown', name: 'Age unknown — 1 session', id: 'age-unknown', prose: 'No source or filename-inferred age' },
  ];

  for (let i = 0; i < expectedBands.length; i += 1) {
    const band = expectedBands[i];
    const link = navLinks.nth(i);
    await expect(link).toHaveAttribute('href', band.href);
    await expect(link).toHaveAccessibleName(band.name);
    // Decorative proportion bar stays hidden from assistive technology.
    await expect(link.locator('.age-band-bar')).toHaveAttribute('aria-hidden', 'true');

    // Verify no digit concatenation between band label and session count in flat textContent.
    const flatText = await link.evaluate(el => el.textContent || '');
    expect(flatText).toContain(' — ');
    expect(flatText).not.toMatch(/\d1\s*session/);

    const section = page.locator(`section#${band.id}`);
    await expect(section).toBeVisible();
    await expect(section.locator('h2')).toHaveText(band.name);
    await expect(section.locator('.age-band-prose')).toHaveText(band.prose);

    // Band sections define positive scroll-margin-top so anchor jumps leave breathing room.
    const scrollMarginTop = await section.evaluate(el => Number.parseFloat(getComputedStyle(el).scrollMarginTop));
    expect(scrollMarginTop).toBeGreaterThan(0);
  }

  // Every session on /sessions explicitly distinguishes source age vs inferred age vs unrecorded in Details view.
  await expect(page.locator('#age-1-6 dl.catalog-record')).toContainText('1 year, 8 months, 15 days (source age)');
  await expect(page.locator('#age-2-0 dl.catalog-record')).toContainText('2 years, 1 month, 10 days (source age)');
  await expect(page.locator('#age-2-6 dl.catalog-record')).toContainText('2 years, 6 months, 4 days (inferred from filename)');
  await expect(page.locator('#age-2-6 dl.catalog-record .inferred-age-link')).toHaveAttribute('href', '/about#inferred-ages');
  await expect(page.locator('#age-unknown dl.catalog-record')).toContainText('Not recorded');

  // Switch to List view and verify source vs inferred age distinction remains explicit on every row.
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await expect(page.locator('#age-1-6 dl.catalog-record')).toContainText('1 year, 8 months, 15 days (source age)');
  await expect(page.locator('#age-2-0 dl.catalog-record')).toContainText('2 years, 1 month, 10 days (source age)');
  await expect(page.locator('#age-2-6 dl.catalog-record')).toContainText('2 years, 6 months, 4 days (inferred from filename)');
  await expect(page.locator('#age-unknown dl.catalog-record')).toContainText('Not recorded');
  await page.getByRole('button', { name: 'Details', exact: true }).click();
});

test('age-band links are keyboard operable, linkable via /sessions#age-2-0, and persist the origin filter across jumps, reloads, and Back/Forward', async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', error => pageErrors.push(error.message));

  // Direct link to /sessions#age-2-0 highlights band 2;0-2;5 and keeps hash intact.
  await page.goto('/sessions#age-2-0');
  const nav = page.getByRole('navigation', { name: 'Jump to age band' });
  const band20Link = nav.getByRole('link', { name: '2;0–2;5 — 1 session' });
  await expect(band20Link).toHaveAttribute('aria-current', 'location');
  await expect(page.locator('#age-2-0')).toHaveClass(/\bis-active-band\b/);
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#age-2-0');

  // Keyboard-activate the Age unknown link and verify hash, aria-current, and actual viewport scroll.
  await page.setViewportSize({ width: 1280, height: 480 });
  const unknownLink = nav.getByRole('link', { name: 'Age unknown — 1 session' });
  await unknownLink.focus();
  await expect(unknownLink).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/sessions#age-unknown$/);
  await expect(unknownLink).toHaveAttribute('aria-current', 'location');
  await expect(band20Link).not.toHaveAttribute('aria-current', 'location');
  await expect.poll(() => page.locator('#age-unknown').evaluate(el => {
    const rect = el.getBoundingClientRect();
    return rect.top >= 0 && rect.top < window.innerHeight;
  })).toBe(true);
  await page.setViewportSize({ width: 1280, height: 800 });

  // Filter to archived_research while on #age-unknown: band still exists, so both ?origin= and #age-unknown persist!
  const originSelect = page.getByLabel('Transcript origin');
  await originSelect.selectOption('archived_research');
  await expect(page).toHaveURL(/\/sessions\?origin=archived_research#age-unknown$/);
  await expect(nav.locator('ul > li')).toHaveCount(2);
  await expect(nav.getByRole('link', { name: 'Age unknown — 1 session' })).toHaveAttribute('aria-current', 'location');

  // Jump to #age-1-6 while filtered: ?origin=archived_research persists cleanly across hash navigation.
  await nav.getByRole('link', { name: '1;6–1;11 — 1 session' }).click();
  await expect(page).toHaveURL(/\/sessions\?origin=archived_research#age-1-6$/);
  await expect(originSelect).toHaveValue('archived_research');
  await expect(nav.getByRole('link', { name: '1;6–1;11 — 1 session' })).toHaveAttribute('aria-current', 'location');
  await expect(page.locator('.age-band-group h3 a')).toHaveText([
    'Blue locomotive and wooden bridge',
    'Cardboard observatory without audio',
  ]);

  // Reloading preserves both ?origin=archived_research and #age-1-6.
  await page.reload();
  await expect(page).toHaveURL(/\/sessions\?origin=archived_research#age-1-6$/);
  await expect(originSelect).toHaveValue('archived_research');
  await expect(nav.getByRole('link', { name: '1;6–1;11 — 1 session' })).toHaveAttribute('aria-current', 'location');

  // Switching to local_ai_draft drops #age-1-6 cleanly because 1;6-1;11 has no local AI draft sessions.
  await originSelect.selectOption('local_ai_draft');
  await expect(page).toHaveURL(/\/sessions\?origin=local_ai_draft$/);
  await expect(nav.locator('ul > li')).toHaveCount(1);
  await nav.getByRole('link', { name: '2;6–2;11 — 1 session' }).click();
  await expect(page).toHaveURL(/\/sessions\?origin=local_ai_draft#age-2-6$/);
  await expect(nav.getByRole('link', { name: '2;6–2;11 — 1 session' })).toHaveAttribute('aria-current', 'location');

  // Back/Forward steps cleanly through hash and origin history.
  await page.goBack();
  await expect(page).toHaveURL(/\/sessions\?origin=local_ai_draft$/);
  await expect(originSelect).toHaveValue('local_ai_draft');
  await expect(nav.getByRole('link', { name: '2;6–2;11 — 1 session' })).not.toHaveAttribute('aria-current', 'location');

  await page.goBack();
  await expect(page).toHaveURL(/\/sessions\?origin=archived_research#age-1-6$/);
  await expect(originSelect).toHaveValue('archived_research');
  await expect(nav.getByRole('link', { name: '1;6–1;11 — 1 session' })).toHaveAttribute('aria-current', 'location');

  await page.goForward();
  await expect(page).toHaveURL(/\/sessions\?origin=local_ai_draft$/);
  await expect(originSelect).toHaveValue('local_ai_draft');

  // Direct SSR load with both ?origin= and #age-2-6 works immediately.
  await page.goto('/sessions?origin=local_ai_draft#age-2-6');
  await expect(originSelect).toHaveValue('local_ai_draft');
  await expect(nav.getByRole('link', { name: '2;6–2;11 — 1 session' })).toHaveAttribute('aria-current', 'location');
  await expect(page.locator('#age-2-6 h3 a')).toHaveText(['Paper lighthouse and harbor bells']);

  expect(consoleErrors, `Unexpected console errors: ${consoleErrors.join('; ')}`).toEqual([]);
  expect(pageErrors, `Unexpected page errors: ${pageErrors.join('; ')}`).toEqual([]);
});

test('age-band timeline passes axe across light, dark, and system themes, reflows cleanly at 320px, and respects prefers-reduced-motion', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/sessions#age-2-0');
  await expect(page.getByRole('navigation', { name: 'Jump to age band' })).toBeVisible();

  await auditAllThemes(page, '/sessions#age-2-0 age-band timeline');

  // 320px narrow viewport reflow: zero horizontal overflow in Details and List views.
  await page.setViewportSize({ width: 320, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await page.getByRole('button', { name: 'List', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await page.getByRole('button', { name: 'Details', exact: true }).click();

  // Verify prefers-reduced-motion zeroes transitions on age-band navigator links.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/sessions');
  const transitionDuration = await page
    .locator('.age-band-link')
    .first()
    .evaluate(el => getComputedStyle(el).transitionDuration);
  expect(transitionDuration).toBe('0s');
});
