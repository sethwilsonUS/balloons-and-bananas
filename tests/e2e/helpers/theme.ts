import { expect, type Page } from '@playwright/test';

export type ThemeChoice = 'system' | 'light' | 'dark';

const THEME_LABELS: Record<ThemeChoice, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
};

export async function waitForThemeSettled(page: Page, expectedDark: boolean) {
  const expectedPaper = expectedDark ? 'rgb(24, 31, 26)' : 'rgb(247, 244, 237)';
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
    .toBe(expectedPaper);
  await page.evaluate(async () => {
    await new Promise<void>(resolve =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const running = document
      .getAnimations()
      .filter(
        animation =>
          animation.playState === 'running'
          && Number.isFinite(Number(animation.effect?.getComputedTiming().duration)),
      );
    await Promise.race([
      Promise.all(running.map(animation => animation.finished.catch(() => undefined))),
      new Promise(resolve => setTimeout(resolve, 400)),
    ]);
  });
}

export async function setTheme(page: Page, theme: ThemeChoice, expectedDark?: boolean) {
  const trigger = page.getByRole('button', { name: /^Appearance:/ });
  await trigger.click();
  await page.getByRole('menuitemradio', { name: THEME_LABELS[theme], exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await expect(trigger).toHaveAccessibleName(`Appearance: ${THEME_LABELS[theme]}`);
  await waitForThemeSettled(page, expectedDark ?? theme === 'dark');
}
