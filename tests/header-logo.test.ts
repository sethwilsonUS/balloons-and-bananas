import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CassetteReelLogo, { renderCassetteTapeArtwork } from '../src/components/CassetteReelLogo';
import RouteHeader from '../src/components/RouteHeader';
import SiteFooter from '../src/components/SiteFooter';

test('CassetteReelLogo renders simplified iconic 1980s compact-cassette SVG decoratively beside text and labelled when standalone', () => {
  const decorative = renderToStaticMarkup(React.createElement(CassetteReelLogo));
  assert.match(decorative, /<svg[^>]*viewBox="0 0 64 40"/);
  assert.match(decorative, /<svg[^>]*aria-hidden="true"/);
  assert.match(decorative, /<svg[^>]*focusable="false"/);
  assert.doesNotMatch(decorative, /\brole="img"/);
  assert.doesNotMatch(decorative, /\baria-label=/);

  // Theme-aware currentColor strokes/fills (zero hardcoded light-only hex fills)
  assert.match(decorative, /stroke="currentColor"/);
  assert.doesNotMatch(decorative, /#[0-9a-f]{3,6}\b/i);

  // Clean iconic geometry: rounded shell, quiet top label band, central tape window, 2 bold spools, bottom trapezoid + 2 minimal dots
  assert.match(decorative, /<rect[^>]*x="2"[^>]*y="2"[^>]*width="60"[^>]*height="36"[^>]*rx="4"/);
  assert.match(decorative, /<rect[^>]*x="7"[^>]*y="6"[^>]*width="50"[^>]*height="4"/);
  assert.match(decorative, /<rect[^>]*x="10\.5"[^>]*y="13\.2"[^>]*width="43"[^>]*height="13\.8"/);
  assert.match(decorative, /<circle[^>]*cx="21"[^>]*cy="20\.1"[^>]*r="3\.75"/);
  assert.match(decorative, /<circle[^>]*cx="43"[^>]*cy="20\.1"[^>]*r="3\.75"/);
  assert.match(decorative, /M 15\.5 38 L 19 30\.4 H 45 L 48\.5 38/);
  assert.match(decorative, /<circle[^>]*cx="25\.5"[^>]*cy="34\.2"[^>]*r="1\.4"/);
  assert.match(decorative, /<circle[^>]*cx="38\.5"[^>]*cy="34\.2"[^>]*r="1\.4"/);

  // Simplified iconic discipline: no ruled lines/spokes/gauge ticks (<line>), no screws/double-ring capstans (exactly 4 circles), single trapezoid <path>
  assert.equal((decorative.match(/<line\b/g) ?? []).length, 0);
  assert.equal((decorative.match(/<circle\b/g) ?? []).length, 4);
  assert.equal((decorative.match(/<path\b/g) ?? []).length, 1);

  // Shared Satori helper accepts explicit ink and shellFill for Apple touch icon and Open Graph card
  const satoriArtwork = renderToStaticMarkup(
    React.createElement(
      'svg',
      { viewBox: '0 0 64 40' },
      renderCassetteTapeArtwork({ ink: '#254c38', shellFill: '#fcfaf5' }),
    ),
  );
  assert.match(satoriArtwork, /stroke="#254c38"/);
  assert.match(satoriArtwork, /<rect[^>]*x="2"[^>]*fill="#fcfaf5"/);
  assert.doesNotMatch(satoriArtwork, /currentColor/);

  // Whitespace-only ink/shellFill fall back safely rather than emitting blank SVG color attributes
  const blankColorArtwork = renderToStaticMarkup(
    React.createElement(
      'svg',
      { viewBox: '0 0 64 40' },
      renderCassetteTapeArtwork({ ink: '   ', shellFill: '   ' }),
    ),
  );
  assert.match(blankColorArtwork, /stroke="currentColor"/);
  assert.match(blankColorArtwork, /<rect[^>]*x="2"[^>]*fill="currentColor"[^>]*fill-opacity="0\.04"/);

  const standalone = renderToStaticMarkup(
    React.createElement(CassetteReelLogo, { label: ' The Seth Tapes ' }),
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

test('SVG favicon and globals.css carry the simplified iconic 1980s cassette silhouette and remove legacy circle-mark CSS', async () => {
  const iconSvg = await readFile(path.resolve('src/app/icon.svg'), 'utf8');
  assert.match(iconSvg, /<svg[^>]*viewBox="0 0 32 32"/);
  assert.match(iconSvg, /#f7f4ed/i);
  assert.match(iconSvg, /#254c38/i);
  assert.match(iconSvg, /<rect[^>]*x="3"[^>]*y="7"[^>]*width="26"[^>]*height="18"/);
  assert.match(iconSvg, /<rect[^>]*x="6"[^>]*y="9\.6"[^>]*width="20"[^>]*height="1\.9"/);
  assert.match(iconSvg, /<circle[^>]*cx="11\.2"[^>]*cy="16\.4"/);
  assert.match(iconSvg, /<circle[^>]*cx="20\.8"[^>]*cy="16\.4"/);
  assert.match(iconSvg, /<path[^>]*d="M 9 25 L 10\.9 21\.5 H 21\.1 L 23 25 Z"/);

  const css = await readFile(path.resolve('src/app/globals.css'), 'utf8');
  assert.doesNotMatch(css, /\.collection-mark\b/);
  assert.doesNotMatch(css, /\.unlisted-label\b/);
  assert.match(css, /\.cassette-reel-logo\b/);
  assert.match(css, /\.theme-menu\b/);
});
