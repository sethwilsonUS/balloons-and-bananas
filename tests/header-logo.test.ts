import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CassetteReelLogo from '../src/components/CassetteReelLogo';
import RouteHeader from '../src/components/RouteHeader';
import SiteFooter from '../src/components/SiteFooter';

test('CassetteReelLogo renders decorative two-reel SVG beside text and labelled img when standalone', () => {
  const decorative = renderToStaticMarkup(React.createElement(CassetteReelLogo));
  assert.match(decorative, /<svg[^>]*aria-hidden="true"/);
  assert.doesNotMatch(decorative, /\brole="img"/);
  assert.doesNotMatch(decorative, /\baria-label=/);
  assert.match(decorative, /stroke="currentColor"/);
  assert.match(decorative, /<circle[^>]*cx="9"/);
  assert.match(decorative, /<circle[^>]*cx="31"/);
  assert.match(decorative, /<path[^>]*d="M3\.8 15 L9\.6 20\.25 H30\.4 L36\.2 15"/);

  const standalone = renderToStaticMarkup(
    React.createElement(CassetteReelLogo, { label: 'The Seth Tapes' }),
  );
  assert.match(standalone, /role="img"/);
  assert.match(standalone, /aria-label="The Seth Tapes"/);
  assert.doesNotMatch(standalone, /aria-hidden="true"/);

  // Whitespace-only label must stay decorative rather than emitting a blank aria-label.
  const blankLabel = renderToStaticMarkup(
    React.createElement(CassetteReelLogo, { label: '   ' }),
  );
  assert.match(blankLabel, /aria-hidden="true"/);
  assert.doesNotMatch(blankLabel, /aria-label=/);
});

test('RouteHeader renders one-row header without Unlisted archive or Copy share link, with Menu disclosure and Appearance menu', () => {
  const html = renderToStaticMarkup(
    React.createElement(RouteHeader, { activeSection: 'sessions' }),
  );

  assert.match(html, /class="site-header"/);
  assert.match(html, /class="brand-button"/);
  assert.match(html, /The Seth Tapes/);
  assert.doesNotMatch(html, /Unlisted archive/i);
  assert.doesNotMatch(html, /Copy share link/i);
  assert.doesNotMatch(html, /collection-mark/);

  // Five section nav links with current page exposed
  assert.match(html, /<a href="\/">Overview<\/a>/);
  assert.match(html, /<a href="\/sessions" aria-current="page">Sessions<\/a>/);
  assert.match(html, /<a href="\/search">Search<\/a>/);
  assert.match(html, /<a href="\/research">Research &amp; context<\/a>/);
  assert.match(html, /<a href="\/about">About &amp; methods<\/a>/);

  // Disclosure menu toggle wired via aria-controls to the nav
  const navIdMatch = /<nav id="([^"]+)"/.exec(html);
  assert.ok(navIdMatch, 'Expected nav to have an id for aria-controls');
  assert.ok(
    html.includes(`aria-controls="${navIdMatch[1]}"`),
    'Expected Menu button aria-controls to reference the nav id',
  );
  assert.match(html, /class="button secondary menu-toggle"[^>]*aria-expanded="false"/);

  // Compact Appearance menu trigger with current setting in accessible name and Light/Dark/System options
  assert.match(html, /aria-label="Appearance: System"/);
  assert.match(html, /aria-haspopup="menu"/);
  assert.match(html, /role="menu" aria-label="Appearance"/);
  assert.match(html, /role="menuitemradio" aria-checked="false"[^>]*>.*?Light/s);
  assert.match(html, /role="menuitemradio" aria-checked="false"[^>]*>.*?Dark/s);
  assert.match(html, /role="menuitemradio" aria-checked="true"[^>]*>.*?System/s);
  assert.match(html, /role="status" aria-live="polite"/);
});

test('SiteFooter uses CassetteReelLogo, retains unlisted-access note, and removes old circle mark', () => {
  const html = renderToStaticMarkup(React.createElement(SiteFooter));

  assert.match(html, /cassette-reel-logo footer-logo/);
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, /An unlisted public archive\. Anyone with the link can visit\./);
  assert.doesNotMatch(html, /collection-mark/);
});

test('SVG favicon and globals.css carry the cassette-reel design and remove legacy circle-mark CSS', async () => {
  const iconSvg = await readFile(path.resolve('src/app/icon.svg'), 'utf8');
  assert.match(iconSvg, /<svg[^>]*viewBox="0 0 32 32"/);
  assert.match(iconSvg, /#f7f4ed/i);
  assert.match(iconSvg, /#254c38/i);
  assert.match(iconSvg, /<circle[^>]*cx="9\.5"/);
  assert.match(iconSvg, /<circle[^>]*cx="22\.5"/);
  assert.match(iconSvg, /<path[^>]*d="M6\.5 18\.1 L9\.3 21\.25 H22\.7 L25\.5 18\.1"/);

  const css = await readFile(path.resolve('src/app/globals.css'), 'utf8');
  assert.doesNotMatch(css, /\.collection-mark\b/);
  assert.doesNotMatch(css, /\.unlisted-label\b/);
  assert.match(css, /\.cassette-reel-logo\b/);
  assert.match(css, /\.theme-menu\b/);
});
