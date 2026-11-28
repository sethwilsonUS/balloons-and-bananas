import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { setTheme, waitForThemeSettled } from './helpers/theme';

const ALL_ROUTES = [
  { path: '/', activeLabel: 'Overview' },
  { path: '/sessions', activeLabel: 'Sessions' },
  { path: '/sessions/010815', activeLabel: 'Sessions' },
  { path: '/search', activeLabel: 'Search' },
  { path: '/research', activeLabel: 'Research & context' },
  { path: '/research/fixture-provenance-guide', activeLabel: 'Research & context' },
  { path: '/about', activeLabel: 'About & methods' },
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

test('single-row header on every route: logo + brand, 5 nav links, compact Appearance button, no Unlisted archive or Copy share link', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });

  let baselineRowTop: number | null = null;
  let baselineNavWidths: number[] | null = null;
  let baselineBrandLeft: number | null = null;

  for (const route of ALL_ROUTES) {
    await page.goto(route.path);

    const header = page.locator('header.site-header');
    await expect(header).toBeVisible();
    await expect(header).not.toContainText('Unlisted archive');
    await expect(header).not.toContainText('Copy share link');
    await expect(header.locator('.share-button')).toHaveCount(0);
    await expect(page.locator('.collection-mark')).toHaveCount(0);

    // Footer keeps the unlisted-access note and uses the new SVG cassette-reel logo
    const footer = page.locator('footer.site-footer');
    await expect(footer).toContainText('An unlisted public archive. Anyone with the link can visit.');
    await expect(footer.locator('svg.cassette-reel-logo')).toHaveAttribute('aria-hidden', 'true');

    // Header logo is decorative inline SVG beside visible "The Seth Tapes" brand text
    const brand = header.locator('a.brand-button');
    await expect(brand).toHaveAttribute('href', '/');
    await expect(brand).toHaveText('The Seth Tapes');
    await expect(brand.locator('svg.cassette-reel-logo')).toHaveAttribute('aria-hidden', 'true');

    // Five nav links with identical labels and active current-page state
    const navLinks = header.locator('.section-nav a');
    await expect(navLinks).toHaveText([
      'Overview',
      'Sessions',
      'Search',
      'Research & context',
      'About & methods',
    ]);
    await expect(header.locator('.section-nav a[aria-current="page"]')).toHaveText(route.activeLabel);

    // Menu button stays hidden on desktop; Appearance icon button is compact and right-aligned
    await expect(header.locator('.menu-toggle')).toBeHidden();
    const appearanceBtn = header.getByRole('button', { name: 'Appearance: System' });
    await expect(appearanceBtn).toBeVisible();

    const geometry = await page.evaluate(() => {
      const headerEl = document.querySelector('header.site-header')!;
      const brandEl = headerEl.querySelector('.brand-button')!;
      const links = [...headerEl.querySelectorAll<HTMLAnchorElement>('.section-nav a')];
      const themeBtn = headerEl.querySelector('.theme-toggle')!;
      const h1El = document.querySelector('main h1')!;
      const rects = [brandEl, ...links, themeBtn].map(el => el.getBoundingClientRect());
      const centersY = rects.map(r => r.top + r.height / 2);
      return {
        headerHeight: headerEl.getBoundingClientRect().height,
        maxCenterDiff: Math.max(...centersY) - Math.min(...centersY),
        brandLeft: brandEl.getBoundingClientRect().left,
        h1Left: h1El.getBoundingClientRect().left,
        brandRight: brandEl.getBoundingClientRect().right,
        firstNavLeft: links[0].getBoundingClientRect().left,
        lastNavRight: links[links.length - 1].getBoundingClientRect().right,
        themeLeft: themeBtn.getBoundingClientRect().left,
        themeWidth: themeBtn.getBoundingClientRect().width,
        themeHeight: themeBtn.getBoundingClientRect().height,
        navWidths: links.map(l => l.getBoundingClientRect().width),
      };
    });

    // Single row: all elements share the same vertical centerline and strictly left-to-right order
    expect(geometry.headerHeight, `${route.path}: single-row height`).toBeLessThanOrEqual(80);
    expect(geometry.maxCenterDiff, `${route.path}: elements align on one row`).toBeLessThanOrEqual(4);
    expect(geometry.brandRight, `${route.path}: nav sits beside brand`).toBeLessThan(geometry.firstNavLeft);
    expect(geometry.lastNavRight, `${route.path}: Appearance sits right of nav`).toBeLessThan(geometry.themeLeft);
    expect(geometry.themeWidth, `${route.path}: compact icon button width`).toBeLessThanOrEqual(48);
    expect(geometry.themeHeight, `${route.path}: accessible 44px target height`).toBeGreaterThanOrEqual(44);
    expect(Math.abs(geometry.brandLeft - geometry.h1Left), `${route.path}: brand aligns with main h1`).toBeLessThanOrEqual(1);

    if (baselineRowTop === null) {
      baselineRowTop = geometry.headerHeight;
      baselineNavWidths = geometry.navWidths;
      baselineBrandLeft = geometry.brandLeft;
    } else {
      expect(Math.abs(geometry.headerHeight - baselineRowTop)).toBeLessThanOrEqual(1);
      expect(Math.abs(geometry.brandLeft - baselineBrandLeft!)).toBeLessThanOrEqual(1);
      for (let i = 0; i < geometry.navWidths.length; i += 1) {
        expect(Math.abs(geometry.navWidths[i] - baselineNavWidths![i])).toBeLessThanOrEqual(1);
      }
    }
  }
});

test('Appearance icon button and menu support full keyboard navigation, Escape focus return, click-outside close, announcements, persistence, and pre-paint theme', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/sessions');

  const trigger = page.getByRole('button', { name: /^Appearance:/ });
  const menu = page.getByRole('menu', { name: 'Appearance' });
  const liveStatus = page.locator('.theme-control [role="status"]');

  await expect(trigger).toHaveAccessibleName('Appearance: System');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
  await expect(menu).toBeHidden();

  // Keyboard Enter opens menu and focuses current option (System)
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(menu).toBeVisible();

  const lightItem = menu.getByRole('menuitemradio', { name: 'Light', exact: true });
  const darkItem = menu.getByRole('menuitemradio', { name: 'Dark', exact: true });
  const systemItem = menu.getByRole('menuitemradio', { name: 'System', exact: true });
  await expect(systemItem).toHaveAttribute('aria-checked', 'true');
  await expect(systemItem).toBeFocused();

  // ArrowDown wraps System -> Light, ArrowUp wraps Light -> System, Home -> Light, End -> System
  await page.keyboard.press('ArrowDown');
  await expect(lightItem).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(darkItem).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(lightItem).toBeFocused();
  await page.keyboard.press('End');
  await expect(systemItem).toBeFocused();
  await page.keyboard.press('Home');
  await expect(lightItem).toBeFocused();

  // Tab navigation works across items too
  await page.keyboard.press('Tab');
  await expect(darkItem).toBeFocused();

  // Escape closes menu and returns focus to trigger without changing theme
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(trigger).toBeFocused();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'system');

  // ArrowDown from closed trigger opens at Light; move to Dark and select via Enter
  await page.keyboard.press('ArrowDown');
  await expect(lightItem).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(darkItem).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAccessibleName('Appearance: Dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(liveStatus).toHaveText('Appearance set to Dark.');
  await waitForThemeSettled(page, true);

  // Verify persistence across reload AND pre-paint script applies dark before React hydrates
  expect(await page.evaluate(() => window.localStorage.getItem('balloons-and-bananas:theme'))).toBe('dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(trigger).toHaveAccessibleName('Appearance: Dark');
  await expectNoSeriousAxeViolations(page, 'header dark theme');

  // Open menu and verify axe is clean while menu is open in both dark and light themes
  await trigger.click();
  await expect(menu).toBeVisible();
  await expectNoSeriousAxeViolations(page, 'header open theme menu (dark)');

  // Click outside closes menu cleanly
  await page.locator('h1').click();
  await expect(menu).toBeHidden();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');

  // Switch to Light and check open menu axe in light mode
  await setTheme(page, 'light');
  await expect(liveStatus).toHaveText('Appearance set to Light.');
  await trigger.click();
  await expect(menu).toBeVisible();
  await expectNoSeriousAxeViolations(page, 'header open theme menu (light)');
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();

  // System theme removes localStorage entry and follows prefers-color-scheme
  await page.emulateMedia({ colorScheme: 'dark' });
  await setTheme(page, 'system', true);
  await expect(liveStatus).toHaveText('Appearance set to System.');
  expect(await page.evaluate(() => window.localStorage.getItem('balloons-and-bananas:theme'))).toBeNull();
  await expectNoSeriousAxeViolations(page, 'header system dark theme');
});

test('narrow screens collapse nav behind accessible Menu disclosure button with Escape focus return, aria-current preserved, and zero overflow at 320px/390px', async ({ page }) => {
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/sessions');

    const menuButton = page.getByRole('button', { name: 'Menu', exact: true });
    const nav = page.getByRole('navigation', { name: 'Collection sections' });
    const appearanceBtn = page.getByRole('button', { name: /^Appearance:/ });

    await expect(menuButton).toBeVisible();
    await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
    await expect(nav).toBeHidden();
    await expect(appearanceBtn).toBeVisible();

    // Closed header stays on a single row with zero horizontal overflow
    const closedMetrics = await page.evaluate(() => {
      const brand = document.querySelector('.brand-button')!.getBoundingClientRect();
      const menu = document.querySelector('.menu-toggle')!.getBoundingClientRect();
      const theme = document.querySelector('.theme-toggle')!.getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        maxTopDiff: Math.max(brand.top, menu.top, theme.top) - Math.min(brand.top, menu.top, theme.top),
        menuHeight: menu.height,
        themeHeight: theme.height,
      };
    });
    expect(closedMetrics.overflow, `${width}px closed overflow`).toBeLessThanOrEqual(0);
    expect(closedMetrics.maxTopDiff, `${width}px closed single top row`).toBeLessThanOrEqual(8);
    expect(closedMetrics.menuHeight, `${width}px Menu tap target`).toBeGreaterThanOrEqual(44);
    expect(closedMetrics.themeHeight, `${width}px Appearance tap target`).toBeGreaterThanOrEqual(44);

    // Open Menu via keyboard Enter; verify aria-expanded, aria-current, focus navigation, and zero overflow
    await menuButton.focus();
    await page.keyboard.press('Enter');
    await expect(menuButton).toHaveAttribute('aria-expanded', 'true');
    await expect(nav).toBeVisible();
    await expect(nav.locator('a[aria-current="page"]')).toHaveText('Sessions');

    const openOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(openOverflow, `${width}px open menu overflow`).toBeLessThanOrEqual(0);
    await expectNoSeriousAxeViolations(page, `mobile ${width}px menu open`);

    // Tab moves directly into the disclosed nav links; Escape returns focus to Menu button
    await page.keyboard.press('Tab');
    await expect(nav.getByRole('link', { name: 'Overview' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(nav.getByRole('link', { name: 'Sessions' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
    await expect(nav).toBeHidden();
    await expect(menuButton).toBeFocused();

    // Opening Appearance menu at narrow width stays inside viewport with zero overflow
    await appearanceBtn.click();
    await expect(page.getByRole('menu', { name: 'Appearance' })).toBeVisible();
    const themeMenuOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(themeMenuOverflow, `${width}px open appearance menu overflow`).toBeLessThanOrEqual(0);
    await page.keyboard.press('Escape');
  }
});

test('favicon and Apple touch icon are linked in document head and served cleanly with cassette-reel markup and privacy headers', async ({ page, request }) => {
  const consoleErrors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('/');

  const iconLinks = await page.evaluate(() => ({
    icon: document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.getAttribute('href') || null,
    iconType: document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.getAttribute('type') || null,
    appleIcon: document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')?.getAttribute('href') || null,
    appleSizes: document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')?.getAttribute('sizes') || null,
  }));

  expect(iconLinks.icon, 'Expected SVG favicon link in <head>').toMatch(/^\/icon\.svg/);
  expect(iconLinks.iconType).toBe('image/svg+xml');
  expect(iconLinks.appleIcon, 'Expected Apple touch icon link in <head>').toMatch(/^\/apple-icon/);
  expect(iconLinks.appleSizes).toBe('180x180');

  const faviconRes = await request.get(iconLinks.icon!);
  expect(faviconRes.status()).toBe(200);
  expect(faviconRes.headers()['content-type']).toMatch(/image\/svg\+xml/i);
  expect(faviconRes.headers()['x-robots-tag']).toMatch(/\bnoindex\b/i);
  expect(faviconRes.headers()['referrer-policy']).toBe('no-referrer');
  const svgBody = await faviconRes.text();
  expect(svgBody).toContain('<circle cx="9.5"');
  expect(svgBody).toContain('<circle cx="22.5"');
  expect(svgBody).toContain('#254c38');

  const appleRes = await request.get(iconLinks.appleIcon!);
  expect(appleRes.status()).toBe(200);
  expect(appleRes.headers()['content-type']).toMatch(/image\/png/i);
  expect(appleRes.headers()['x-robots-tag']).toMatch(/\bnoindex\b/i);
  expect(appleRes.headers()['referrer-policy']).toBe('no-referrer');
  const pngBytes = await appleRes.body();
  // Verify PNG magic signature
  expect(pngBytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
  expect(pngBytes.length).toBeGreaterThan(200);

  expect(consoleErrors).toEqual([]);
});
