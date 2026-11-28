import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
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

async function tabUntilFocused(page: Page, target: Locator, maxTabs = 45) {
  for (let i = 0; i < maxTabs; i += 1) {
    const isFocused = await target.evaluate(el => el === document.activeElement);
    if (isFocused) return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

test('audio player operates entirely by keyboard with spoken aria-valuetext, More disclosure, View transcript jump, no visible native controls, and clean axe in light/dark/system themes', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?entry=fixture-010815-locomotive');
  await expect(page).toHaveURL(/\/sessions\/010815$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Blue locomotive and wooden bridge' })).toBeVisible();

  const audioPanel = page.locator('.audio-panel');
  const audioEl = audioPanel.locator('audio');

  // Compact player sits directly under the session title and is visible without scrolling at 1280x800.
  const desktopGeometry = await page.evaluate(() => {
    const h1 = document.querySelector('main h1')!.getBoundingClientRect();
    const player = document.querySelector('.audio-panel')!.getBoundingClientRect();
    return { h1Bottom: h1.bottom, playerTop: player.top, playerBottom: player.bottom, viewportHeight: window.innerHeight };
  });
  expect(desktopGeometry.playerTop).toBeGreaterThanOrEqual(desktopGeometry.h1Bottom - 2);
  expect(desktopGeometry.playerBottom).toBeLessThanOrEqual(desktopGeometry.viewportHeight);

  // Native <audio controls> bar is removed; <audio> remains strictly for playback.
  await expect(audioEl).toHaveCount(1);
  expect(await audioEl.evaluate(el => (el as HTMLAudioElement).controls)).toBe(false);
  await expect(audioEl).not.toBeVisible();

  // Initial time readout and spoken seek valuetext.
  const timeReadout = audioPanel.locator('.audio-time-readout');
  await expect(timeReadout).toHaveText('0:00 / 0:36');

  const playButton = audioPanel.getByRole('button', { name: 'Play recording' });
  const backButton = audioPanel.getByRole('button', { name: 'Back 15 seconds' });
  const forwardButton = audioPanel.getByRole('button', { name: 'Forward 30 seconds' });
  const seekSlider = audioPanel.getByRole('slider', { name: 'Playback position' });
  const speedSelect = audioPanel.getByLabel('Speed');
  const moreButton = audioPanel.getByRole('button', { name: 'More audio options' });
  const muteButton = audioPanel.getByRole('button', { name: 'Mute' });
  const volumeSlider = audioPanel.getByRole('slider', { name: 'Volume' });
  const downloadLink = audioPanel.getByRole('link', { name: 'Download original MP3' });
  const viewTranscriptLink = audioPanel.getByRole('link', { name: 'View transcript' });

  await expect(seekSlider).toHaveAttribute('aria-valuetext', '0 seconds of 36 seconds');
  await expect(moreButton).toHaveAttribute('aria-expanded', 'false');
  await expect(muteButton).toBeHidden();
  await expect(volumeSlider).toBeHidden();

  // Keyboard-focus Play recording and start playback with Enter; focus stays on the transport button.
  await tabUntilFocused(page, playButton);
  await expect(playButton).toBeFocused();
  await page.keyboard.press('Enter');

  const pauseButton = audioPanel.getByRole('button', { name: 'Pause', exact: true });
  await expect(pauseButton).toBeVisible();
  await expect.poll(() => audioEl.evaluate(el => (el as HTMLAudioElement).readyState)).toBeGreaterThanOrEqual(1);
  await expect.poll(() => audioEl.evaluate(el => (el as HTMLAudioElement).paused)).toBe(false);
  await expect.poll(() => audioEl.evaluate(el => (el as HTMLAudioElement).currentTime)).toBeGreaterThan(0);
  await expect(pauseButton).toBeFocused();

  // Pause via keyboard Space without re-focusing.
  await page.keyboard.press('Space');
  await expect.poll(() => audioEl.evaluate(el => (el as HTMLAudioElement).paused)).toBe(true);
  await expect(playButton).toBeVisible();
  await expect(playButton).toBeFocused();

  // Tab through Back 15s, Forward 30s, Seek slider, Speed, and More button.
  await page.keyboard.press('Tab');
  await expect(backButton).toBeFocused();
  await expect(backButton).toBeEnabled();

  await page.keyboard.press('Tab');
  await expect(forwardButton).toBeFocused();
  await expect(forwardButton).toBeEnabled();

  // Skip forward 30s via keyboard Enter.
  await page.keyboard.press('Enter');
  await expect.poll(() => audioEl.evaluate(el => (el as HTMLAudioElement).currentTime)).toBeGreaterThanOrEqual(29);
  await expect(seekSlider).toHaveAttribute('aria-valuetext', /30 seconds of 36 seconds|31 seconds of 36 seconds/);

  // Shift+Tab to Back 15s and skip back via Space.
  await page.keyboard.press('Shift+Tab');
  await expect(backButton).toBeFocused();
  await page.keyboard.press('Space');
  await expect.poll(() => audioEl.evaluate(el => (el as HTMLAudioElement).currentTime)).toBeGreaterThanOrEqual(14);
  await expect.poll(() => audioEl.evaluate(el => (el as HTMLAudioElement).currentTime)).toBeLessThanOrEqual(17);

  // Tab past Forward 30s to custom seek slider and exercise Home, ArrowRight, ArrowUp, ArrowLeft, ArrowDown, PageUp, PageDown, End.
  await page.keyboard.press('Tab');
  await expect(forwardButton).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(seekSlider).toBeFocused();

  await page.keyboard.press('Home');
  await expect(seekSlider).toHaveAttribute('aria-valuetext', '0 seconds of 36 seconds');
  await expect(timeReadout).toHaveText('0:00 / 0:36');
  await expect.poll(() => audioEl.evaluate(el => Math.round((el as HTMLAudioElement).currentTime))).toBe(0);

  await page.keyboard.press('ArrowRight');
  await expect(seekSlider).toHaveAttribute('aria-valuetext', '5 seconds of 36 seconds');
  await expect(timeReadout).toHaveText('0:05 / 0:36');
  await expect.poll(() => audioEl.evaluate(el => Math.round((el as HTMLAudioElement).currentTime))).toBe(5);

  await page.keyboard.press('ArrowUp');
  await expect(seekSlider).toHaveAttribute('aria-valuetext', '10 seconds of 36 seconds');
  await expect(timeReadout).toHaveText('0:10 / 0:36');

  await page.keyboard.press('ArrowLeft');
  await expect(seekSlider).toHaveAttribute('aria-valuetext', '5 seconds of 36 seconds');

  await page.keyboard.press('ArrowDown');
  await expect(seekSlider).toHaveAttribute('aria-valuetext', '0 seconds of 36 seconds');

  await page.keyboard.press('PageUp');
  await expect(seekSlider).toHaveAttribute('aria-valuetext', '10 seconds of 36 seconds');
  await page.keyboard.press('PageUp');
  await expect(seekSlider).toHaveAttribute('aria-valuetext', '20 seconds of 36 seconds');
  await expect.poll(() => audioEl.evaluate(el => Math.round((el as HTMLAudioElement).currentTime))).toBe(20);

  await page.keyboard.press('PageDown');
  await expect(seekSlider).toHaveAttribute('aria-valuetext', '10 seconds of 36 seconds');
  await expect.poll(() => audioEl.evaluate(el => Math.round((el as HTMLAudioElement).currentTime))).toBe(10);

  await page.keyboard.press('End');
  await expect(seekSlider).toHaveAttribute('aria-valuetext', '36 seconds of 36 seconds');
  await expect(timeReadout).toHaveText('0:36 / 0:36');
  await expect.poll(() => audioEl.evaluate(el => Math.round((el as HTMLAudioElement).currentTime))).toBe(36);

  // Tab to Speed select and change playback rate via keyboard type-ahead (works across macOS/Linux/Windows).
  await page.keyboard.press('Tab');
  await expect(speedSelect).toBeFocused();
  await page.keyboard.type('2');
  await expect(speedSelect).toHaveValue('2');
  await expect.poll(() => audioEl.evaluate(el => (el as HTMLAudioElement).playbackRate)).toBe(2);

  // Tab to More disclosure button, open via Enter, and operate Mute & Volume by keyboard.
  await page.keyboard.press('Tab');
  await expect(moreButton).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(moreButton).toHaveAttribute('aria-expanded', 'true');
  await expect(muteButton).toBeVisible();
  await expect(muteButton).toHaveAttribute('aria-pressed', 'false');
  await expect(volumeSlider).toBeVisible();
  await expect(volumeSlider).toHaveAttribute('aria-valuetext', '100 percent');

  // Tab to Mute toggle button and toggle via Enter / Space.
  await page.keyboard.press('Tab');
  await expect(muteButton).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(muteButton).toHaveAttribute('aria-pressed', 'true');
  await expect(volumeSlider).toHaveAttribute('aria-valuetext', 'Muted, 0 percent');
  await expect.poll(() => audioEl.evaluate(el => (el as HTMLAudioElement).muted)).toBe(true);

  await page.keyboard.press('Space');
  await expect(muteButton).toHaveAttribute('aria-pressed', 'false');
  await expect(volumeSlider).toHaveAttribute('aria-valuetext', '100 percent');
  await expect.poll(() => audioEl.evaluate(el => (el as HTMLAudioElement).muted)).toBe(false);

  // Tab to Volume slider and adjust with ArrowLeft, PageDown, Home, ArrowRight, End.
  await page.keyboard.press('Tab');
  await expect(volumeSlider).toBeFocused();

  await page.keyboard.press('ArrowLeft');
  await expect(volumeSlider).toHaveAttribute('aria-valuetext', '95 percent');
  await expect.poll(() => audioEl.evaluate(el => Math.round((el as HTMLAudioElement).volume * 100))).toBe(95);

  await page.keyboard.press('PageDown');
  await expect(volumeSlider).toHaveAttribute('aria-valuetext', '75 percent');
  await expect.poll(() => audioEl.evaluate(el => Math.round((el as HTMLAudioElement).volume * 100))).toBe(75);

  await page.keyboard.press('Home');
  await expect(volumeSlider).toHaveAttribute('aria-valuetext', 'Muted, 0 percent');
  await expect(muteButton).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => audioEl.evaluate(el => (el as HTMLAudioElement).muted)).toBe(true);

  await page.keyboard.press('ArrowRight');
  await expect(volumeSlider).toHaveAttribute('aria-valuetext', '5 percent');
  await expect(muteButton).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => audioEl.evaluate(el => (el as HTMLAudioElement).muted)).toBe(false);
  await expect.poll(() => audioEl.evaluate(el => Math.round((el as HTMLAudioElement).volume * 100))).toBe(5);

  await page.keyboard.press('End');
  await expect(volumeSlider).toHaveAttribute('aria-valuetext', '100 percent');
  await expect.poll(() => audioEl.evaluate(el => Math.round((el as HTMLAudioElement).volume * 100))).toBe(100);

  // Axe is clean while More panel is expanded too.
  await expectNoSeriousAxeViolations(page, 'audio player with More open (light)');

  // Escape closes More panel and returns focus to More button.
  await page.keyboard.press('Escape');
  await expect(moreButton).toHaveAttribute('aria-expanded', 'false');
  await expect(muteButton).toBeHidden();
  await expect(moreButton).toBeFocused();

  // Tab to MP3 download link and View transcript link.
  await page.keyboard.press('Tab');
  await expect(downloadLink).toBeFocused();
  await expect(downloadLink).toHaveAttribute('href', '/api/assets/fixture-audio-locomotive-mp3?download=1');

  await page.keyboard.press('Tab');
  await expect(viewTranscriptLink).toBeFocused();
  await expect(viewTranscriptLink).toHaveAttribute('href', '#transcript');
  await page.keyboard.press('Enter');
  await expect(page.locator('#transcript')).toBeFocused();

  // Playing from End restarts cleanly from the beginning without a false out-of-range error.
  await playButton.focus();
  await page.keyboard.press('Enter');
  await expect(pauseButton).toBeVisible();
  await expect.poll(() => audioEl.evaluate(el => (el as HTMLAudioElement).currentTime)).toBeLessThan(5);
  await page.keyboard.press('Space');
  await expect.poll(() => audioEl.evaluate(el => (el as HTMLAudioElement).paused)).toBe(true);
  await expect(audioPanel.locator('.player-status')).toHaveText('');

  // Verify prefers-reduced-motion disables player transitions.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const transitionDuration = await playButton.evaluate(el => getComputedStyle(el).transitionDuration);
  expect(transitionDuration).toBe('0s');
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  // Verify 390px phone viewport shows player near top without scrolling, and 320px has zero overflow.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  const mobilePlayer = await audioPanel.evaluate(el => ({
    bottom: el.getBoundingClientRect().bottom,
    viewportHeight: window.innerHeight,
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  }));
  expect(mobilePlayer.bottom).toBeLessThanOrEqual(mobilePlayer.viewportHeight);
  expect(mobilePlayer.overflow).toBeLessThanOrEqual(0);

  await page.setViewportSize({ width: 320, height: 800 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 1280, height: 800 });

  // Audit light, dark, and system themes with axe.
  await setTheme(page, 'light');
  await expectNoSeriousAxeViolations(page, 'audio player (light)');

  await setTheme(page, 'dark');
  await expectNoSeriousAxeViolations(page, 'audio player (dark)');

  await page.emulateMedia({ colorScheme: 'dark' });
  await setTheme(page, 'system', true);
  await expectNoSeriousAxeViolations(page, 'audio player (system dark)');

  await page.emulateMedia({ colorScheme: 'light' });
  await waitForThemeSettled(page, false);
  await expectNoSeriousAxeViolations(page, 'audio player (system light)');
});

test('audio player preserves load/media error status, signed-URL recovery, keyboard retry, and listening-copy/WAV downloads', async ({ page }) => {
  let assetJsonCalls = 0;
  await page.route('**/api/assets/fixture-audio-locomotive-mp3?json=1', async route => {
    assetJsonCalls += 1;
    if (assetJsonCalls === 1) {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'temporary' }) });
      return;
    }
    if (assetJsonCalls === 2) {
      // Return a near-expired signed URL pointing to a failing stream so automatic signed-URL recovery triggers.
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ url: '/api/assets/fixture-audio-locomotive-mp3?expired-test=1', expiresAt: Date.now() - 1000 }),
      });
      return;
    }
    await route.continue();
  });
  await page.route('**/api/assets/fixture-audio-locomotive-mp3?expired-test=1', async route => {
    await route.fulfill({ status: 403, contentType: 'text/plain', body: 'expired' });
  });

  await page.goto('/?entry=fixture-010815-locomotive');
  const audioPanel = page.locator('.audio-panel');
  const playButton = audioPanel.getByRole('button', { name: 'Play recording' });
  await tabUntilFocused(page, playButton);
  await page.keyboard.press('Enter');

  // Error message and Retry button appear on initial load failure.
  const status = audioPanel.locator('.player-status');
  await expect(status).toContainText('That request could not be completed. Please try again.');
  const retryButton = audioPanel.getByRole('button', { name: 'Retry audio' });
  await expect(retryButton).toBeVisible();

  // Activating Retry audio by keyboard hits the expired URL, automatically refreshes it (call #3), and plays!
  await tabUntilFocused(page, retryButton);
  await page.keyboard.press('Enter');
  await expect(audioPanel.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await expect.poll(() => assetJsonCalls).toBe(3);
  await expect(retryButton).toBeHidden();
  await expect(status).toHaveText('');
  await page.unroute('**/api/assets/fixture-audio-locomotive-mp3?json=1');
  await page.unroute('**/api/assets/fixture-audio-locomotive-mp3?expired-test=1');

  // Non-expired media stream failure displays the playback error message and Retry button.
  await page.route('**/api/assets/fixture-audio-lighthouse-mp3?local=1', async route => {
    await route.fulfill({ status: 500, contentType: 'text/plain', body: 'error' });
  });
  await page.goto('/?entry=fixture-020604-lighthouse');
  await expect(page).toHaveURL(/\/sessions\/020604-local$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Paper lighthouse and harbor bells' })).toBeVisible();
  await tabUntilFocused(page, audioPanel.getByRole('button', { name: 'Play recording' }));
  await page.keyboard.press('Enter');
  await expect(status).toContainText('This recording could not be played. Retry from your current position, or choose another recording.');
  await expect(audioPanel.getByRole('button', { name: 'Retry audio' })).toBeVisible();
  await page.unroute('**/api/assets/fixture-audio-lighthouse-mp3?local=1');

  // Listening-copy session with original WAV download renders cleanly with no native controls and clean axe.
  await page.goto('/?entry=fixture-020110-submarine');
  await expect(page).toHaveURL(/\/sessions\/020110-tb$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Yellow submarine in the courtyard' })).toBeVisible();
  await expect(audioPanel.locator('audio')).not.toBeVisible();
  await expect(audioPanel.getByRole('link', { name: 'Download MP3 listening copy' })).toBeVisible();

  // Recording choice and Original WAV download live inside the More disclosure.
  const moreBtn = audioPanel.getByRole('button', { name: 'More audio options' });
  await expect(audioPanel.getByText('Original WAV recording')).toBeHidden();
  await moreBtn.click();
  await expect(audioPanel).toContainText('MP3 listening copy.');
  await expect(audioPanel.getByLabel('MP3 recording')).toBeVisible();
  await expect(audioPanel.getByText('Original WAV recording')).toBeVisible();
  await expect(audioPanel.getByRole('link', { name: /Download original WAV/i })).toHaveAttribute(
    'href',
    '/api/assets/fixture-audio-submarine-wav?download=1',
  );
  await setTheme(page, 'light');
  await expectNoSeriousAxeViolations(page, 'listening-copy audio player (light)');
  await setTheme(page, 'dark');
  await expectNoSeriousAxeViolations(page, 'listening-copy audio player (dark)');
});

test('audio player hides percentage slider when platform volume is read-only (iOS behavior) while keeping mute', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(HTMLMediaElement.prototype, 'volume', {
      configurable: true,
      get() { return 1; },
      set() { /* Read-only on iOS Safari */ },
    });
  });

  await page.goto('/?entry=fixture-010815-locomotive');
  const audioPanel = page.locator('.audio-panel');
  await audioPanel.getByRole('button', { name: 'More audio options' }).click();
  await expect(audioPanel.getByRole('slider', { name: 'Volume' })).toHaveCount(0);
  await expect(audioPanel).toContainText('Use device buttons to adjust volume.');

  const muteButton = audioPanel.getByRole('button', { name: 'Mute' });
  await expect(muteButton).toHaveAttribute('aria-pressed', 'false');
  await tabUntilFocused(page, muteButton);
  await page.keyboard.press('Enter');
  await expect(muteButton).toHaveAttribute('aria-pressed', 'true');
  await expectNoSeriousAxeViolations(page, 'read-only volume audio player (light)');
});
