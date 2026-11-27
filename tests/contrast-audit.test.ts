import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

interface ContrastResult {
  theme: 'light' | 'dark';
  foregroundToken: string;
  foreground: string;
  backgroundToken: string;
  background: string;
  use: string;
  minimum: number;
  ratio: number;
  pass: boolean;
}

interface ContrastAudit {
  method: string;
  systemDarkMatchesExplicitDark: boolean;
  checks: number;
  failures: unknown[];
  minimumTextRatio: number;
  minimumControlOrFocusRatio: number;
  results: ContrastResult[];
}

function extractVariables(blockBody: string): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const match of blockBody.matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    tokens.set(match[1], match[2].toLowerCase());
  }
  return tokens;
}

function parseHexColor(hex: string): [number, number, number] {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  assert.ok(match, `Invalid hex color: ${hex}`);
  return [parseInt(match[1], 16) / 255, parseInt(match[2], 16) / 255, parseInt(match[3], 16) / 255];
}

function linearChannel(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHexColor(hex).map(linearChannel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

test('theme-contrast-audit.json matches live globals.css tokens and passes WCAG contrast across light, dark, and system themes', async () => {
  const cssRaw = await readFile(path.resolve('src/app/globals.css'), 'utf8');
  const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '');
  const audit = JSON.parse(
    await readFile(path.resolve('src/components/theme-contrast-audit.json'), 'utf8'),
  ) as ContrastAudit;

  const lightMatch = /(?:^|\n)\s*:root\s*\{([^}]*)\}/.exec(css);
  assert.ok(lightMatch, 'Missing :root light theme token block in globals.css');
  const systemDarkMatch = /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{\s*:root:not\(\[data-theme=['"]light['"]\]\)\s*\{([^}]*)\}\s*\}/.exec(css);
  assert.ok(systemDarkMatch, 'Missing @media (prefers-color-scheme: dark) token block in globals.css');
  const explicitDarkMatch = /:root\[data-theme=['"]dark['"]\]\s*\{([^}]*)\}/.exec(css);
  assert.ok(explicitDarkMatch, 'Missing :root[data-theme="dark"] token block in globals.css');

  const lightTokens = extractVariables(lightMatch[1]);
  const systemDarkTokens = extractVariables(systemDarkMatch[1]);
  const explicitDarkTokens = extractVariables(explicitDarkMatch[1]);

  assert.deepEqual(
    Object.fromEntries([...systemDarkTokens].sort()),
    Object.fromEntries([...explicitDarkTokens].sort()),
    'System dark color tokens in globals.css must match explicit [data-theme="dark"] tokens',
  );

  assert.equal(audit.systemDarkMatchesExplicitDark, true);
  assert.deepEqual(audit.failures, []);
  assert.ok(audit.checks > 0);
  assert.equal(audit.results.length, audit.checks);

  let minText = Infinity;
  let minControlOrFocus = Infinity;

  for (const check of audit.results) {
    const tokens = check.theme === 'light' ? lightTokens : explicitDarkTokens;
    const liveFg = tokens.get(check.foregroundToken);
    const liveBg = tokens.get(check.backgroundToken);
    assert.ok(liveFg, `Missing --${check.foregroundToken} in globals.css (${check.theme})`);
    assert.ok(liveBg, `Missing --${check.backgroundToken} in globals.css (${check.theme})`);
    assert.equal(
      liveFg,
      check.foreground.toLowerCase(),
      `globals.css --${check.foregroundToken} (${check.theme}) drifted from theme-contrast-audit.json`,
    );
    assert.equal(
      liveBg,
      check.background.toLowerCase(),
      `globals.css --${check.backgroundToken} (${check.theme}) drifted from theme-contrast-audit.json`,
    );

    const actual = contrastRatio(liveFg, liveBg);
    assert.equal(check.pass, true, `Recorded failure for ${check.theme} ${check.foregroundToken} on ${check.backgroundToken}`);
    assert.ok(
      actual >= check.minimum,
      `Contrast failure in ${check.theme}: --${check.foregroundToken} (${liveFg}) on --${check.backgroundToken} (${liveBg}) is ${actual.toFixed(3)}, below ${check.minimum}`,
    );
    assert.ok(
      Math.abs(Math.round(actual * 1000) / 1000 - check.ratio) <= 0.001,
      `Recorded ratio mismatch for ${check.theme} --${check.foregroundToken} on --${check.backgroundToken}: expected ${actual.toFixed(3)}, audit has ${check.ratio}`,
    );

    if (check.use === 'normal text') minText = Math.min(minText, actual);
    else minControlOrFocus = Math.min(minControlOrFocus, actual);
  }

  assert.ok(minText >= 4.5, `Minimum text contrast ratio ${minText.toFixed(3)} is below 4.5`);
  assert.ok(minControlOrFocus >= 3, `Minimum control/focus contrast ratio ${minControlOrFocus.toFixed(3)} is below 3.0`);
  assert.ok(Math.abs(Math.round(minText * 1000) / 1000 - audit.minimumTextRatio) <= 0.001);
  assert.ok(Math.abs(Math.round(minControlOrFocus * 1000) / 1000 - audit.minimumControlOrFocusRatio) <= 0.001);
});
