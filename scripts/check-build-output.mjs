#!/usr/bin/env node
/**
 * Verify that `npm run build` never embeds archive text anywhere in `.next/`.
 *
 * Extracts distinctive synthetic phrases from `tests/fixtures/archive.json`,
 * confirms `.next/` contains the built dynamic routes (`/sessions/[id]`,
 * `/search`, `/research`, `/research/[doc]`, `/about`) without prerendered HTML,
 * and scans every file under `.next/` to prove none of those phrases appear in
 * server output, static assets, manifests, or source maps.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const nextDir = path.resolve('.next');
const fixturePath = path.resolve('tests/fixtures/archive.json');

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function collectFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(full)));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

async function findPrerenderedHtmlForRoute(routeName) {
  const appServerDir = path.join(nextDir, 'server', 'app');
  const found = [];
  const directHtml = path.join(appServerDir, `${routeName}.html`);
  if (await exists(directHtml)) {
    found.push(path.relative(process.cwd(), directHtml));
  }
  const routeDir = path.join(appServerDir, routeName);
  if (await exists(routeDir)) {
    const nested = (await collectFiles(routeDir))
      .filter(filePath => filePath.toLowerCase().endsWith('.html'))
      .map(filePath => path.relative(process.cwd(), filePath));
    found.push(...nested);
  }
  return found;
}

async function main() {
  if (!(await exists(path.join(nextDir, 'BUILD_ID')))) {
    throw new Error('Missing .next/BUILD_ID — run `npm run build` before checking build output.');
  }

  const appPathsManifestPath = path.join(nextDir, 'server', 'app-paths-manifest.json');
  const appPathsManifest = JSON.parse(await readFile(appPathsManifestPath, 'utf8'));
  const requiredDynamicRoutes = [
    '/sessions/[id]/page',
    '/search/page',
    '/research/page',
    '/research/[doc]/page',
    '/about/page',
  ];
  for (const routeKey of requiredDynamicRoutes) {
    if (!Object.hasOwn(appPathsManifest, routeKey)) {
      throw new Error(`Expected ${routeKey} in .next/server/app-paths-manifest.json`);
    }
  }

  const prerenderedSessionHtmlFiles = await findPrerenderedHtmlForRoute('sessions');
  const prerenderedSearchHtmlFiles = await findPrerenderedHtmlForRoute('search');
  const prerenderedResearchHtmlFiles = await findPrerenderedHtmlForRoute('research');
  const prerenderedAboutHtmlFiles = await findPrerenderedHtmlForRoute('about');
  const prerenderedDynamicHtmlFiles = [
    ...prerenderedSessionHtmlFiles,
    ...prerenderedSearchHtmlFiles,
    ...prerenderedResearchHtmlFiles,
    ...prerenderedAboutHtmlFiles,
  ];
  const prerenderedSessionHtmlPresent = prerenderedSessionHtmlFiles.length > 0;
  const prerenderedSearchHtmlPresent = prerenderedSearchHtmlFiles.length > 0;
  const prerenderedDynamicHtmlPresent = prerenderedDynamicHtmlFiles.length > 0;
  if (prerenderedDynamicHtmlPresent) {
    throw new Error(
      `Dynamic archive routes must never be prerendered to static HTML (found: ${prerenderedDynamicHtmlFiles.join(', ')}).`,
    );
  }

  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  const phrases = new Set();
  for (const entry of fixture.entries) {
    if (entry.title) phrases.add(entry.title);
    if (entry.overview) phrases.add(entry.overview);
    for (const moment of entry.moments || []) {
      if (moment.title) phrases.add(moment.title);
      if (moment.description) phrases.add(moment.description);
    }
    for (const passage of entry.transcript || []) {
      const firstLine = String(passage.text || '').split('\n')[0].trim();
      if (firstLine.length >= 16) phrases.add(firstLine);
    }
  }
  for (const doc of fixture.documents || []) {
    if (doc.title && doc.title !== 'Sources and methods') phrases.add(doc.title);
    if (doc.description && doc.description.length >= 16) phrases.add(doc.description);
    for (const line of String(doc.markdown || '').split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length >= 32 && !trimmed.startsWith('#') && !trimmed.startsWith('|')) {
        phrases.add(trimmed);
      }
    }
  }

  const needles = [...phrases].map(raw => ({ raw, lower: raw.toLowerCase() }));
  if (needles.length < 10) {
    throw new Error(`Expected at least 10 synthetic fixture phrases to scan (got ${needles.length}).`);
  }

  const files = await collectFiles(nextDir);
  const leaks = [];
  for (const filePath of files) {
    const content = await readFile(filePath, 'utf8').catch(() => '');
    if (!content) continue;
    const lowered = content.toLowerCase();
    for (const needle of needles) {
      if (lowered.includes(needle.lower)) {
        leaks.push({ file: path.relative(process.cwd(), filePath), phrase: needle.raw });
      }
    }
  }

  if (leaks.length > 0) {
    console.error(JSON.stringify({ ok: false, filesScanned: files.length, phrasesChecked: needles.length, leaks }, null, 2));
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify({
    ok: true,
    routeBuilt: '/sessions/[id]/page',
    routesBuilt: requiredDynamicRoutes,
    prerenderedSessionHtmlPresent,
    prerenderedSearchHtmlPresent,
    prerenderedDynamicHtmlPresent,
    filesScanned: files.length,
    phrasesChecked: needles.length,
    leaks: [],
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
