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

test('full transcript renders without 100-passage cap, supports find-within-transcript, and uses content-visibility', async ({ page }) => {
  await page.goto('/sessions/010815');

  const lines = page.locator('.transcript-line');
  await expect(lines).toHaveCount(5);
  await expect(page.getByRole('button', { name: /Show \d+ more passages/i })).toHaveCount(0);

  // Every passage shows a visible number and #pN anchor
  for (let n = 1; n <= 5; n += 1) {
    const row = page.locator(`#p${n}`);
    await expect(row).toBeVisible();
    const anchor = row.getByRole('link', { name: `Passage ${n}`, exact: true });
    await expect(anchor).toBeVisible();
    await expect(anchor).toHaveAttribute('href', `#p${n}`);
    await expect(anchor).toContainText(`#${n}`);
  }

  // content-visibility: auto is applied on transcript passages for long-session responsiveness
  const contentVisibility = await page.locator('#p1').evaluate(el => getComputedStyle(el).contentVisibility);
  expect(contentVisibility).toBe('auto');

  // Find-within-transcript filters and restores full transcript cleanly
  const findInput = page.getByLabel('Find within this transcript');
  await findInput.fill('lanterns');
  await expect(lines).toHaveCount(1);
  await expect(page.locator('#p5')).toBeVisible();
  await expect(page.getByText('1 matching passage')).toBeVisible();
  await findInput.fill('');
  await expect(lines).toHaveCount(5);
  await expect(page.getByText('5 transcript passages')).toBeVisible();

  // Verify a >100-passage transcript renders every passage with zero paging cap or Show more button
  const longTranscript = Array.from({ length: 135 }, (_, idx) => ({
    speaker: idx % 2 === 0 ? 'Child (CHI, target child)' : 'Parent (FAT, father)',
    text: idx === 134
      ? 'synthetic final utterance with windmill lantern token'
      : `synthetic utterance number ${idx + 1} for scroll responsiveness check`,
    start: idx * 6,
    end: idx * 6 + 5,
  }));
  await page.route('**/api/entries/fixture-long-reading', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'fixture-long-reading',
        slug: '010901-long',
        legacyId: 'fixture-long-reading',
        sourceName: '010901-long.cha',
        title: 'Synthetic long reading session',
        overview: 'Synthetic 135-passage session verifying removal of the 100-passage cap.',
        origin: 'archived_research',
        topics: ['Play and imagination'],
        dates: [],
        ages: ['1;09.01'],
        inferredAge: null,
        recordings: [],
        preferredRecordingId: null,
        sources: [],
        moments: [],
        limits: [],
        transcript: longTranscript,
        sourceSha256: '0'.repeat(64),
        association: 'Synthetic fixture',
      }),
    });
  });

  await page.goto('/?entry=fixture-long-reading');
  await expect(page.getByRole('heading', { level: 2, name: 'Synthetic long reading session' })).toBeVisible();
  await expect(page.locator('.transcript-line')).toHaveCount(135);
  await expect(page.locator('#p135')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /Show \d+ more passages/i })).toHaveCount(0);
  await page.getByLabel('Find within this transcript').fill('windmill lantern');
  await expect(page.locator('.transcript-line')).toHaveCount(1);
  await expect(page.locator('#p135')).toBeVisible();
  await page.unroute('**/api/entries/fixture-long-reading');
});

test('#pN anchors scroll, focus, highlight on load and hashchange, and Copy link to passage announces result and handles clipboard errors', async ({ page, baseURL }) => {
  await page.addInitScript(() => {
    const win = window as unknown as { __copiedTexts?: string[]; __failClipboard?: boolean };
    win.__copiedTexts = [];
    win.__failClipboard = false;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          if (win.__failClipboard) {
            throw new Error('Clipboard permission denied');
          }
          win.__copiedTexts?.push(text);
        },
      },
    });
  });

  await page.goto('/sessions/010815?from=%2Fsearch%3Fq%3Dlocomotive#p4');

  const passage4 = page.locator('#p4');
  await expect(passage4).toBeVisible();
  await expect(passage4).toHaveClass(/\bis-linked\b/);
  await expect(passage4).toBeFocused();
  await expect(page.locator('.transcript-live-status')).toContainText('Showing transcript passage 4');

  // Verify #p4 is not hidden underneath either the sticky nav or the sticky playback toolbar
  const clearance = await page.evaluate(() => {
    const nav = document.querySelector('.session-sticky-nav')?.getBoundingClientRect();
    const toolbar = document.querySelector('.transcript-playback-tools')?.getBoundingClientRect();
    const target = document.querySelector('#p4')?.getBoundingClientRect();
    return {
      navBottom: nav?.bottom ?? 0,
      toolbarBottom: toolbar?.bottom ?? 0,
      targetTop: target?.top ?? 0,
    };
  });
  expect(clearance.targetTop).toBeGreaterThanOrEqual(clearance.navBottom - 1);
  expect(clearance.targetTop).toBeGreaterThanOrEqual(clearance.toolbarBottom - 1);

  // Hashchange via clicking another passage anchor moves highlight and focus
  await page.locator('#p2').getByRole('link', { name: 'Passage 2', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#p2');
  const passage2 = page.locator('#p2');
  await expect(passage2).toHaveClass(/\bis-linked\b/);
  await expect(passage2).toBeFocused();
  await expect(passage4).not.toHaveClass(/\bis-linked\b/);

  // Keyboard-activate "Copy link to passage 3" -> copies canonical URL without ?from= and announces via live region
  const copyP3 = page.getByRole('button', { name: 'Copy link to passage 3' });
  await copyP3.focus();
  await expect(copyP3).toBeFocused();
  await page.keyboard.press('Enter');

  const copied = await page.evaluate(() => (window as unknown as { __copiedTexts: string[] }).__copiedTexts);
  expect(copied).toEqual([`${baseURL}/sessions/010815#p3`]);
  await expect(page.locator('.transcript-copy-status')).toHaveText('Copied link to passage 3.');
  await expect(page.getByRole('button', { name: 'Copied link to passage 3' })).toBeVisible();

  // Clipboard error degrades gracefully with manual copy input and live announcement
  await page.evaluate(() => {
    (window as unknown as { __failClipboard: boolean }).__failClipboard = true;
  });
  await page.getByRole('button', { name: 'Copy link to passage 5' }).click();
  await expect(page.locator('.transcript-copy-status')).toContainText('Could not copy automatically');
  const manualInput = page.getByRole('textbox', { name: 'Link to passage 5' });
  await expect(manualInput).toBeVisible();
  await expect(manualInput).toHaveValue(`${baseURL}/sessions/010815#p5`);
  await page.locator('.passage-manual-copy').getByRole('button', { name: 'Close' }).click();
  await expect(manualInput).toHaveCount(0);

  // Out-of-range #p999 announces gracefully without throwing
  await page.evaluate(() => { window.location.hash = '#p999'; });
  await expect(page.locator('.transcript-live-status')).toContainText('Passage 999 is outside this transcript');
});

test('#t=mm:ss and #t=seconds prepare audio without autoplay, scroll to nearest passage, announce ready state, and handle out-of-range and no-audio sessions', async ({ page }) => {
  let assetJsonRequests = 0;
  page.on('request', req => {
    if (req.url().includes('/api/assets/fixture-audio-locomotive-mp3?json=1')) {
      assetJsonRequests += 1;
    }
  });

  // #t=0:12 prepares player at 12 seconds without autoplay and scrolls to passage 3 (9..15s)
  await page.goto('/sessions/010815#t=0:12');

  const audioEl = page.locator('.audio-panel audio');
  const seekSlider = page.getByRole('slider', { name: 'Playback position' });
  const timeReadout = page.locator('.audio-time-readout');

  await expect(timeReadout).toHaveText('0:12 / 0:36');
  await expect(seekSlider).toHaveAttribute('aria-valuetext', '12 seconds of 36 seconds');
  expect(await audioEl.evaluate(el => (el as HTMLAudioElement).paused)).toBe(true);
  expect(assetJsonRequests).toBe(0);

  const passage3 = page.locator('#p3');
  await expect(passage3).toHaveClass(/\bis-current\b/);
  await expect(passage3).toBeFocused();
  await expect(page.locator('.transcript-live-status')).toHaveText('Ready at 12 seconds. Press play to listen.');

  // Hashchange to plain seconds #t=16 updates position without autoplay and moves to passage 4 (15..22s)
  await page.evaluate(() => { window.location.hash = '#t=16'; });
  await expect(timeReadout).toHaveText('0:16 / 0:36');
  await expect(seekSlider).toHaveAttribute('aria-valuetext', '16 seconds of 36 seconds');
  expect(await audioEl.evaluate(el => (el as HTMLAudioElement).paused)).toBe(true);
  expect(assetJsonRequests).toBe(0);
  await expect(page.locator('#p4')).toHaveClass(/\bis-current\b/);
  await expect(page.locator('#p4')).toBeFocused();
  await expect(page.locator('.transcript-live-status')).toHaveText('Ready at 16 seconds. Press play to listen.');

  // Pressing Play starts playback from the prepared ~16s timestamp
  await page.getByRole('button', { name: 'Play recording' }).click();
  await expect.poll(() => audioEl.evaluate(el => (el as HTMLAudioElement).paused)).toBe(false);
  await expect.poll(() => audioEl.evaluate(el => (el as HTMLAudioElement).currentTime)).toBeGreaterThanOrEqual(15);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect.poll(() => audioEl.evaluate(el => (el as HTMLAudioElement).paused)).toBe(true);

  // Out-of-range #t=12:34 on 36s session does not autoplay and announces clearly
  await page.goto('/sessions/010815#t=12:34');
  await expect(page.locator('.transcript-live-status')).toContainText(
    '12 minutes 34 seconds is beyond this recording’s duration (36 seconds).',
  );
  await expect(page.locator('#p4')).toBeFocused();
  expect(await page.locator('.audio-panel audio').evaluate(el => (el as HTMLAudioElement).paused)).toBe(true);

  // Transcript-only session (no audio) handles #t= gracefully with zero errors
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/sessions/011103#t=12:34');
  await expect(page.locator('.transcript-live-status')).toContainText(
    'No playable recording is available for this session.',
  );
  await expect(page.locator('#p1')).toBeFocused();
  expect(pageErrors).toEqual([]);
});

test('previous and next session links step through canonical age order with session IDs and labelled ages', async ({ page }) => {
  // Canonical fixture order: 010815 (1;08.15) -> 020110-tb (2;01.10) -> 020604-local (2;06.04 inferred) -> 011103 (unaged)
  await page.goto('/sessions/010815');
  const nav1 = page.getByRole('navigation', { name: 'Adjacent sessions in age order' });
  await expect(nav1.locator('.session-step-prev')).toHaveCount(0);
  const next1 = nav1.locator('.session-step-next');
  await expect(next1).toHaveAttribute('href', '/sessions/020110-tb');
  await expect(next1).toContainText('020110-tb');
  await expect(next1).toContainText('2 years, 1 month, 10 days (2;01.10)');

  await next1.click();
  await expect(page).toHaveURL(/\/sessions\/020110-tb$/);
  const nav2 = page.getByRole('navigation', { name: 'Adjacent sessions in age order' });
  const prev2 = nav2.locator('.session-step-prev');
  const next2 = nav2.locator('.session-step-next');
  await expect(prev2).toHaveAttribute('href', '/sessions/010815');
  await expect(prev2).toContainText('010815');
  await expect(prev2).toContainText('1 year, 8 months, 15 days (1;08.15)');
  await expect(next2).toHaveAttribute('href', '/sessions/020604-local');
  await expect(next2).toContainText('020604-local');
  await expect(next2).toContainText('2 years, 6 months, 4 days');
  await expect(next2).toContainText('2;06.04');
  await expect(next2.locator('em')).toHaveText('inferred from filename');

  // Verify zero nested links anywhere on the page
  expect(await page.evaluate(() => document.querySelectorAll('a a, button a, a button').length)).toBe(0);

  await next2.click();
  await expect(page).toHaveURL(/\/sessions\/020604-local$/);
  const nav3 = page.getByRole('navigation', { name: 'Adjacent sessions in age order' });
  await expect(nav3.locator('.session-step-prev')).toHaveAttribute('href', '/sessions/020110-tb');
  const next3 = nav3.locator('.session-step-next');
  await expect(next3).toHaveAttribute('href', '/sessions/011103');
  await expect(next3).toContainText('011103');
  await expect(next3).toContainText('age not recorded');

  await next3.click();
  await expect(page).toHaveURL(/\/sessions\/011103$/);
  const nav4 = page.getByRole('navigation', { name: 'Adjacent sessions in age order' });
  const prev4 = nav4.locator('.session-step-prev');
  await expect(prev4).toHaveAttribute('href', '/sessions/020604-local');
  await expect(prev4).toContainText('020604-local');
  await expect(prev4.locator('em')).toHaveText('inferred from filename');
  await expect(nav4.locator('.session-step-next')).toHaveCount(0);
});

test('sticky In this session nav keeps targets uncovered, resolves safe Back to results URLs, respects reduced motion, reflows at 320px, and passes axe across themes', async ({ page, request, baseURL }) => {
  // Direct visit defaults Back to results to /sessions
  await page.goto('/sessions/010815');
  const stickyNav = page.getByRole('navigation', { name: 'In this session' });
  await expect(stickyNav).toBeVisible();

  const navLinks = stickyNav.locator('a');
  await expect(navLinks).toHaveText(['Guide', 'Moments', 'Transcript', 'Back to results']);
  await expect(stickyNav.getByRole('link', { name: 'Guide' })).toHaveAttribute('href', '#guide');
  await expect(stickyNav.getByRole('link', { name: 'Moments' })).toHaveAttribute('href', '#moments');
  await expect(stickyNav.getByRole('link', { name: 'Transcript' })).toHaveAttribute('href', '#transcript');
  await expect(stickyNav.getByRole('link', { name: 'Back to results' })).toHaveAttribute('href', '/sessions');

  // Clicking sticky nav jump links lands below the sticky nav bar without occlusion
  for (const [label, selector] of [
    ['Transcript', '#transcript'],
    ['Moments', '#moments'],
    ['Guide', '#guide'],
  ] as const) {
    await stickyNav.getByRole('link', { name: label }).click();
    const geometry = await page.evaluate(sel => {
      const nav = document.querySelector('.session-sticky-nav')!.getBoundingClientRect();
      const target = document.querySelector(sel)!.getBoundingClientRect();
      return { navTop: nav.top, navBottom: nav.bottom, targetTop: target.top };
    }, selector);
    expect(geometry.targetTop, `${label} (${selector}) should not be covered by sticky nav`).toBeGreaterThanOrEqual(
      geometry.navBottom - 1,
    );
  }

  // Same-origin referring search URL via ?from= and via HTTP Referer header
  await page.goto('/sessions/010815?from=%2Fsearch%3Fq%3Dlocomotive%26sort%3Drelevance');
  await expect(page.getByRole('navigation', { name: 'In this session' }).getByRole('link', { name: 'Back to results' }))
    .toHaveAttribute('href', '/search?q=locomotive&sort=relevance');

  // External ?from= is rejected and falls back to /sessions
  await page.goto('/sessions/010815?from=https%3A%2F%2Fevil.example%2Fsearch%3Fq%3Dbad');
  await expect(page.getByRole('navigation', { name: 'In this session' }).getByRole('link', { name: 'Back to results' }))
    .toHaveAttribute('href', '/sessions');

  // Same-origin HTTP Referer header resolves cleanly in SSR HTML
  const refRes = await request.get('/sessions/010815', {
    headers: { Referer: `${baseURL}/search?q=bridge` },
  });
  expect(refRes.status()).toBe(200);
  expect(await refRes.text()).toContain('href="/search?q=bridge"');

  // No query or archive text stored in localStorage / sessionStorage
  const storageDump = await page.evaluate(() => ({
    local: Object.entries(window.localStorage),
    session: Object.entries(window.sessionStorage),
  }));
  const serializedStorage = JSON.stringify(storageDump).toLowerCase();
  expect(serializedStorage).not.toContain('locomotive');
  expect(serializedStorage).not.toContain('wooden bridge');
  expect(storageDump.session).toEqual([]);

  // Respects prefers-reduced-motion
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const stepTransition = await page.locator('.session-step-next').evaluate(el => getComputedStyle(el).transitionDuration);
  const copyTransition = await page.locator('.passage-copy-button').first().evaluate(el => getComputedStyle(el).transitionDuration);
  expect(stepTransition).toBe('0s');
  expect(copyTransition).toBe('0s');
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  // 320px narrow mobile reflow has zero horizontal overflow
  await page.setViewportSize({ width: 320, height: 800 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 1280, height: 800 });

  // Zero serious/critical axe violations across all themes
  await auditAllThemes(page, '/sessions/010815 reading features');
});
