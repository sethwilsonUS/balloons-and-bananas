import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

type ThemeChoice = 'system' | 'light' | 'dark';

async function installClipboardMock(page: Page) {
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
}

async function getCopiedTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __copiedTexts: string[] }).__copiedTexts ?? []);
}

async function setClipboardFailure(page: Page, fail: boolean) {
  await page.evaluate(value => {
    (window as unknown as { __failClipboard: boolean }).__failClipboard = value;
  }, fail);
}

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

test('session Cite controls in catalog record and sticky nav open lazily, copy Chicago/APA/BibTeX via keyboard, announce status, and return focus on Escape', async ({ page, baseURL }) => {
  await installClipboardMock(page);

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => pageErrors.push(err.message));

  await page.goto('/sessions/010815');

  // Lazy dialog mounting: zero <dialog> elements exist before a Cite button is activated
  await expect(page.locator('dialog.cite-dialog')).toHaveCount(0);

  // Open Cite dialog from the catalog record via keyboard
  const catalogCite = page.locator('dl.catalog-record').getByRole('button', { name: 'Cite this session' });
  await expect(catalogCite).toBeVisible();
  await catalogCite.focus();
  await expect(catalogCite).toBeFocused();
  await page.keyboard.press('Enter');

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const dialogHeading = dialog.getByRole('heading', { level: 2, name: 'Cite session 010815' });
  await expect(dialogHeading).toBeVisible();
  await expect(dialogHeading).toBeFocused();

  // Chicago tab is active by default and includes approved corpus credit, session ID, source age, date, origin, URL, and access date
  const chicagoTab = dialog.getByRole('tab', { name: 'Chicago' });
  const apaTab = dialog.getByRole('tab', { name: 'APA' });
  const bibtexTab = dialog.getByRole('tab', { name: 'BibTeX' });
  await expect(chicagoTab).toHaveAttribute('aria-selected', 'true');

  const chicagoPanel = dialog.getByRole('tabpanel', { name: 'Chicago' });
  const chicagoPreview = await chicagoPanel.locator('.cite-preview-text').innerText();
  expect(chicagoPreview).toContain('Peters, Ann, and Bob Wilson.');
  expect(chicagoPreview).toContain('"Session 010815" (age 1;08.15; recorded January 15, 1983).');
  expect(chicagoPreview).toContain('Archived research transcript.');
  expect(chicagoPreview).toContain('CHILDES English Peters/Wilson Corpus (TalkBank, https://doi.org/10.21415/T5NS4D), via The Seth Tapes');
  expect(chicagoPreview).toContain(`${baseURL}/sessions/010815`);
  expect(chicagoPreview).toMatch(/Accessed [A-Z][a-z]+ \d{1,2}, \d{4}\./);
  // Archived research has no AI-draft qualifier, no inferred-age label, and never cites AI-written guide title
  expect(chicagoPreview).not.toContain('(machine transcription, unreviewed)');
  expect(chicagoPreview.toLowerCase()).not.toContain('inferred');
  expect(chicagoPreview).not.toContain('Blue locomotive and wooden bridge');

  // Copy Chicago citation via keyboard
  const copyChicago = chicagoPanel.getByRole('button', { name: 'Copy Chicago citation' });
  await copyChicago.focus();
  await page.keyboard.press('Enter');
  await expect(dialog.locator('.cite-live-status')).toHaveText('Copied Chicago citation for session 010815.');
  await expect(chicagoPanel.getByRole('button', { name: 'Copied Chicago citation' })).toBeVisible();

  // Switch to APA via ArrowRight keyboard navigation on the tablist
  await chicagoTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(apaTab).toBeFocused();
  await expect(apaTab).toHaveAttribute('aria-selected', 'true');

  const apaPanel = dialog.getByRole('tabpanel', { name: 'APA' });
  const apaPreview = await apaPanel.locator('.cite-preview-text').innerText();
  expect(apaPreview).toContain('Peters, A., & Wilson, B. (1983, January 15).');
  expect(apaPreview).toContain('Session 010815 (age 1;08.15) [Archived research transcript].');
  expect(apaPreview).toContain('CHILDES English Peters/Wilson Corpus (TalkBank, https://doi.org/10.21415/T5NS4D), via The Seth Tapes.');
  expect(apaPreview).toContain(`${baseURL}/sessions/010815`);
  expect(apaPreview).not.toContain('Blue locomotive and wooden bridge');

  const copyApa = apaPanel.getByRole('button', { name: 'Copy APA citation' });
  await copyApa.focus();
  await page.keyboard.press('Enter');
  await expect(dialog.locator('.cite-live-status')).toHaveText('Copied APA citation for session 010815.');

  // Switch to BibTeX via ArrowRight keyboard navigation on the tablist
  await apaTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(bibtexTab).toBeFocused();
  await expect(bibtexTab).toHaveAttribute('aria-selected', 'true');

  const bibtexPanel = dialog.getByRole('tabpanel', { name: 'BibTeX' });
  const bibtexPreview = await bibtexPanel.locator('.cite-preview-code').innerText();
  expect(bibtexPreview).toContain('@misc{sethtapes_010815,');
  expect(bibtexPreview).toContain('author       = {Peters, Ann and Wilson, Bob},');
  expect(bibtexPreview).toContain('year         = {1983},');
  expect(bibtexPreview).toContain('month        = jan,');
  expect(bibtexPreview).toContain('doi          = {10.21415/T5NS4D},');
  expect(bibtexPreview).toContain(`url          = {${baseURL}/sessions/010815},`);
  expect(bibtexPreview).not.toContain('Blue locomotive and wooden bridge');

  const copyBibtex = bibtexPanel.getByRole('button', { name: 'Copy BibTeX citation' });
  await copyBibtex.focus();
  await page.keyboard.press('Enter');
  await expect(dialog.locator('.cite-live-status')).toHaveText('Copied BibTeX citation for session 010815.');

  const copied = await getCopiedTexts(page);
  expect(copied).toEqual([chicagoPreview, apaPreview, bibtexPreview]);

  // Escape closes the dialog and restores focus to the catalog record Cite trigger
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(catalogCite).toBeFocused();

  // Sticky "In this session" nav also exposes a Cite button that opens and returns focus on Escape
  const stickyCite = page.getByRole('navigation', { name: 'In this session' }).getByRole('button', { name: 'Cite this session' });
  await stickyCite.focus();
  await expect(stickyCite).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('heading', { level: 2, name: 'Cite session 010815' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(stickyCite).toBeFocused();

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('passage Cite button copies #pN citations via keyboard across archived research, TalkBank AI draft, local AI draft with inferred age, unaged sessions, and clipboard fallback', async ({ page, baseURL }) => {
  await installClipboardMock(page);

  // 1. Archived research passage #p3
  await page.goto('/sessions/010815');
  const p3Cite = page.locator('#p3').getByRole('button', { name: 'Cite passage 3' });
  await p3Cite.focus();
  await expect(p3Cite).toBeFocused();
  await page.keyboard.press('Enter');

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { level: 2, name: 'Cite session 010815, passage 3' })).toBeVisible();
  const chicagoPanel = dialog.getByRole('tabpanel', { name: 'Chicago' });
  const chicagoText = await chicagoPanel.locator('.cite-preview-text').innerText();
  expect(chicagoText).toContain('"Session 010815, passage 3"');
  expect(chicagoText).toContain(`${baseURL}/sessions/010815#p3`);
  expect(chicagoText).toContain('Archived research transcript');
  expect(chicagoText).not.toContain('(machine transcription, unreviewed)');

  await chicagoPanel.getByRole('button', { name: 'Copy Chicago citation' }).focus();
  await page.keyboard.press('Enter');
  await expect(dialog.locator('.cite-live-status')).toHaveText('Copied Chicago citation for session 010815, passage 3.');
  expect(await getCopiedTexts(page)).toEqual([chicagoText]);

  // Verify BibTeX key for passage #p3
  await dialog.getByRole('tab', { name: 'BibTeX' }).click();
  const bibtexP3 = await dialog.getByRole('tabpanel', { name: 'BibTeX' }).locator('.cite-preview-code').innerText();
  expect(bibtexP3).toContain('@misc{sethtapes_010815_p3,');
  expect(bibtexP3).toContain(`url          = {${baseURL}/sessions/010815#p3},`);

  // Clipboard error fallback renders a focused readonly textarea with exact text, announces error,
  // and returns focus to the Copy button when dismissed
  await setClipboardFailure(page, true);
  const copyBibtexButton = dialog.getByRole('tabpanel', { name: 'BibTeX' }).getByRole('button', { name: 'Copy BibTeX citation' });
  await copyBibtexButton.click();
  await expect(dialog.locator('.cite-live-status')).toContainText('Could not copy automatically');
  const manualTextarea = dialog.getByRole('textbox', { name: 'BibTeX citation (select and copy)' });
  await expect(manualTextarea).toBeVisible();
  await expect(manualTextarea).toBeFocused();
  await expect(manualTextarea).toHaveValue(bibtexP3);
  await dialog.getByRole('button', { name: 'Dismiss' }).click();
  await expect(manualTextarea).toHaveCount(0);
  await expect(copyBibtexButton).toBeFocused();
  await setClipboardFailure(page, false);

  // External TalkBank link preserves referrer privacy and announces new tab to screen readers
  const talkbankLink = dialog.getByRole('link', { name: 'Corpus page on TalkBank (opens in a new tab)' });
  await expect(talkbankLink).toHaveAttribute('rel', 'noopener noreferrer nofollow');
  await expect(talkbankLink).toHaveAttribute('referrerpolicy', 'no-referrer');

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(p3Cite).toBeFocused();

  // 2. TalkBank AI draft passage #p2: must carry "(machine transcription, unreviewed)" in all 3 formats
  await page.goto('/sessions/020110-tb');
  const tbP2Cite = page.locator('#p2').getByRole('button', { name: 'Cite passage 2' });
  await tbP2Cite.focus();
  await page.keyboard.press('Enter');
  const tbDialog = page.getByRole('dialog');
  await expect(tbDialog.getByRole('heading', { level: 2, name: 'Cite session 020110-tb, passage 2' })).toBeVisible();

  const tbChicago = await tbDialog.getByRole('tabpanel', { name: 'Chicago' }).locator('.cite-preview-text').innerText();
  await tbDialog.getByRole('tab', { name: 'APA' }).click();
  const tbApa = await tbDialog.getByRole('tabpanel', { name: 'APA' }).locator('.cite-preview-text').innerText();
  await tbDialog.getByRole('tab', { name: 'BibTeX' }).click();
  const tbBibtex = await tbDialog.getByRole('tabpanel', { name: 'BibTeX' }).locator('.cite-preview-code').innerText();

  for (const text of [tbChicago, tbApa, tbBibtex]) {
    expect(text).toContain('TalkBank AI draft (machine transcription, unreviewed)');
    expect(text).toContain(`${baseURL}/sessions/020110-tb#p2`);
    expect(text).toContain('age 2;01.10');
    expect(text.toLowerCase()).not.toContain('inferred');
    expect(text).not.toContain('Yellow submarine in the courtyard');
  }
  expect(tbBibtex).toContain('@misc{sethtapes_020110_tb_p2,');
  await page.keyboard.press('Escape');
  await expect(tbP2Cite).toBeFocused();

  // 3. Local AI draft passage #p2: inferred age labelled, no invented date, AI-draft qualifier in all 3 formats
  await page.goto('/sessions/020604-local');
  const localP2Cite = page.locator('#p2').getByRole('button', { name: 'Cite passage 2' });
  await localP2Cite.focus();
  await page.keyboard.press('Enter');
  const localDialog = page.getByRole('dialog');
  await expect(localDialog.getByRole('heading', { level: 2, name: 'Cite session 020604-local, passage 2' })).toBeVisible();

  // Accessible dialog description has clean punctuation/spacing between badges (no VoiceOver word concatenation)
  const describedByText = await localDialog.evaluate(el => {
    const descId = el.getAttribute('aria-describedby');
    return descId ? (document.getElementById(descId)?.textContent?.replace(/\s+/g, ' ').trim() ?? '') : '';
  });
  expect(describedByText).toContain('Local AI draft. Machine transcription, unreviewed. Age inferred from filename. Citations identify');

  const localChicago = await localDialog.getByRole('tabpanel', { name: 'Chicago' }).locator('.cite-preview-text').innerText();
  await localDialog.getByRole('tab', { name: 'APA' }).click();
  const localApa = await localDialog.getByRole('tabpanel', { name: 'APA' }).locator('.cite-preview-text').innerText();
  await localDialog.getByRole('tab', { name: 'BibTeX' }).click();
  const localBibtex = await localDialog.getByRole('tabpanel', { name: 'BibTeX' }).locator('.cite-preview-code').innerText();

  for (const text of [localChicago, localApa, localBibtex]) {
    expect(text).toContain('Local AI draft (machine transcription, unreviewed)');
    expect(text).toContain('inferred age 2;06.04');
    expect(text).toContain(`${baseURL}/sessions/020604-local#p2`);
    expect(text).not.toContain('Paper lighthouse and harbor bells');
  }
  expect(localChicago).not.toContain('recorded ');
  expect(localApa).toContain('(n.d.)');
  expect(localBibtex).toContain('@misc{sethtapes_020604_local_p2,');
  expect(localBibtex).not.toContain('year         =');
  await page.keyboard.press('Escape');
  await expect(localP2Cite).toBeFocused();

  // 4. Unaged archived research session: omits age cleanly without inventing one
  await page.goto('/sessions/011103');
  await page.locator('dl.catalog-record').getByRole('button', { name: 'Cite this session' }).click();
  const unagedDialog = page.getByRole('dialog');
  const unagedChicago = await unagedDialog.getByRole('tabpanel', { name: 'Chicago' }).locator('.cite-preview-text').innerText();
  expect(unagedChicago).toContain('"Session 011103" (recorded April 3, 1983).');
  expect(unagedChicago.toLowerCase()).not.toContain('inferred');
  expect(unagedChicago).not.toContain('undefined');
  expect(unagedChicago).not.toContain('Cardboard observatory without audio');
});

test('Cite dialog respects prefers-reduced-motion, reflows cleanly at 320px, writes nothing to storage, and passes axe across light, dark, and system themes', async ({ page }) => {
  await page.goto('/sessions/020604-local');

  // Reduced motion disables transitions on cite buttons (non-zero normally, 0s under reduce)
  const normalCatalogTransition = await page
    .locator('.cite-catalog-button')
    .evaluate(el => getComputedStyle(el).transitionDuration);
  expect(normalCatalogTransition).not.toBe('0s');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reducedCatalogTransition = await page
    .locator('.cite-catalog-button')
    .evaluate(el => getComputedStyle(el).transitionDuration);
  expect(reducedCatalogTransition).toBe('0s');

  await page.locator('#p1').getByRole('button', { name: 'Cite passage 1' }).click();
  const reducedCopyTransition = await page
    .getByRole('dialog')
    .locator('.cite-copy-button')
    .first()
    .evaluate(el => getComputedStyle(el).transitionDuration);
  expect(reducedCopyTransition).toBe('0s');
  await page.keyboard.press('Escape');
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  // 320px narrow mobile reflow has zero horizontal overflow both closed and with Cite dialog open
  await page.setViewportSize({ width: 320, height: 800 });
  const closedOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(closedOverflow).toBeLessThanOrEqual(0);

  await page.locator('#p2').getByRole('button', { name: 'Cite passage 2' }).click();
  const openDialog = page.getByRole('dialog');
  await expect(openDialog).toBeVisible();
  const dialogWidthChicago = await openDialog.evaluate(el => el.getBoundingClientRect().width);
  expect(dialogWidthChicago).toBeLessThanOrEqual(320);

  await openDialog.getByRole('tab', { name: 'BibTeX' }).click();
  const dialogWidthBibtex = await openDialog.evaluate(el => el.getBoundingClientRect().width);
  expect(dialogWidthBibtex).toBeLessThanOrEqual(320);
  const openOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(openOverflow).toBeLessThanOrEqual(0);
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1280, height: 800 });

  // Zero serious/critical axe violations across light, dark, system-dark, and system-light with dialog open
  const themePasses: Array<{ label: string; apply: () => Promise<void> }> = [
    { label: 'light', apply: () => setTheme(page, 'light') },
    { label: 'dark', apply: () => setTheme(page, 'dark') },
    {
      label: 'system dark',
      apply: async () => {
        await page.emulateMedia({ colorScheme: 'dark' });
        await setTheme(page, 'system', true);
      },
    },
    {
      label: 'system light',
      apply: async () => {
        await page.emulateMedia({ colorScheme: 'light' });
        await waitForThemeSettled(page, false);
      },
    },
  ];

  for (const pass of themePasses) {
    await pass.apply();
    const trigger = page.locator('#p2').getByRole('button', { name: 'Cite passage 2' });
    await trigger.click();
    const activeDialog = page.getByRole('dialog');
    await expect(activeDialog).toBeVisible();
    await expectNoSeriousAxeViolations(page, `Cite dialog Chicago (${pass.label})`);
    await activeDialog.getByRole('tab', { name: 'BibTeX' }).click();
    await expectNoSeriousAxeViolations(page, `Cite dialog BibTeX (${pass.label})`);
    await page.keyboard.press('Escape');
    await expect(activeDialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }
  await setTheme(page, 'light');

  // Privacy check: no citation or archive text enters browser storage
  const storageDump = await page.evaluate(() => ({
    local: Object.entries(window.localStorage),
    session: Object.entries(window.sessionStorage),
  }));
  const serialized = JSON.stringify(storageDump).toLowerCase();
  expect(serialized).not.toContain('lighthouse');
  expect(serialized).not.toContain('sethtapes_');
  expect(serialized).not.toContain('peters');
  expect(storageDump.session).toEqual([]);
});

test('/about renders How to cite section using the shared citation module with keyboard copy, accompanying citations, and clean axe across light and dark themes', async ({ page, baseURL }) => {
  await installClipboardMock(page);

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => pageErrors.push(err.message));

  await page.goto('/about#how-to-cite');

  const section = page.locator('#how-to-cite');
  await expect(section).toBeVisible();
  await expect(section.getByRole('heading', { level: 2, name: 'How to cite' })).toBeVisible();
  await expect(section).toContainText(
    'Peters, Ann, and Bob Wilson. CHILDES English Peters/Wilson Corpus (TalkBank, https://doi.org/10.21415/T5NS4D), via The Seth Tapes',
  );
  await expect(section).toContainText('Peters, Ann M. (1987)');
  await expect(section).toContainText('Wilson, Bob, and Ann M. Peters (1988)');
  await expect(section).toContainText('(machine transcription, unreviewed)');
  await expect(section).not.toContainText('One-click Chicago, APA, and BibTeX citation panels for every session and passage will be added');

  // Verify external TalkBank/DOI links carry privacy attributes and new-tab SR notice
  const externalLinks = section.locator('a[target="_blank"]');
  const linkCount = await externalLinks.count();
  expect(linkCount).toBe(4);
  for (let i = 0; i < linkCount; i += 1) {
    const link = externalLinks.nth(i);
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow');
    await expect(link).toHaveAttribute('referrerpolicy', 'no-referrer');
    await expect(link).toContainText('(opens in a new tab)');
  }

  // Interactive example citation panel copies sethtapes_010626_p42 via keyboard and announces result
  const chicagoTab = section.getByRole('tab', { name: 'Chicago' });
  const bibtexTab = section.getByRole('tab', { name: 'BibTeX' });
  await expect(chicagoTab).toHaveAttribute('aria-selected', 'true');
  const chicagoExample = await section.getByRole('tabpanel', { name: 'Chicago' }).locator('.cite-preview-text').innerText();
  expect(chicagoExample).toContain('"Session 010626, passage 42" (age 1;06.26).');
  expect(chicagoExample).toContain(`${baseURL}/sessions/010626#p42`);

  await chicagoTab.focus();
  await page.keyboard.press('End');
  await expect(bibtexTab).toBeFocused();
  await expect(bibtexTab).toHaveAttribute('aria-selected', 'true');

  const bibtexPanel = section.getByRole('tabpanel', { name: 'BibTeX' });
  const bibtexExample = await bibtexPanel.locator('.cite-preview-code').innerText();
  expect(bibtexExample).toContain('@misc{sethtapes_010626_p42,');
  expect(bibtexExample).toContain(`url          = {${baseURL}/sessions/010626#p42},`);

  const copyBibtex = bibtexPanel.getByRole('button', { name: 'Copy BibTeX citation' });
  await copyBibtex.focus();
  await page.keyboard.press('Enter');
  await expect(section.locator('.cite-live-status')).toHaveText('Copied BibTeX citation for example session 010626, passage 42.');
  expect(await getCopiedTexts(page)).toEqual([bibtexExample]);

  // Zero serious/critical axe violations on /about in light, dark, and system themes
  await setTheme(page, 'light');
  await expectNoSeriousAxeViolations(page, '/about How to cite (light)');
  await setTheme(page, 'dark');
  await expectNoSeriousAxeViolations(page, '/about How to cite (dark)');
  await page.emulateMedia({ colorScheme: 'dark' });
  await setTheme(page, 'system', true);
  await expectNoSeriousAxeViolations(page, '/about How to cite (system dark)');
  await page.emulateMedia({ colorScheme: 'light' });
  await waitForThemeSettled(page, false);
  await expectNoSeriousAxeViolations(page, '/about How to cite (system light)');
  await setTheme(page, 'light');

  // 320px narrow reflow has zero horizontal overflow
  await page.setViewportSize({ width: 320, height: 800 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 1280, height: 800 });

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
