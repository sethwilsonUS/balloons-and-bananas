import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CassetteReelLogo from '../src/components/CassetteReelLogo';
import RouteHeader from '../src/components/RouteHeader';
import SiteFooter from '../src/components/SiteFooter';

test('CassetteReelLogo renders authentic 1980s compact-cassette SVG decoratively beside text and labelled when standalone', () => {
  const decorative = renderToStaticMarkup(React.createElement(CassetteReelLogo));
  assert.match(decorative, /<svg[^>]*viewBox="0 0 64 40"/);
  assert.match(decorative, /<svg[^>]*aria-hidden="true"/);
  assert.match(decorative, /<svg[^>]*focusable="false"/);
  assert.doesNotMatch(decorative, /\brole="img"/);
  assert.doesNotMatch(decorative, /\baria-label=/);

  // Theme-aware currentColor strokes/fills (zero hardcoded light-only hex fills)
  assert.match(decorative, /stroke="currentColor"/);
  assert.doesNotMatch(decorative, /#[0-9a-f]{3,6}\b/i);

  // Outer shell, 4 corner screws, ruled paper label, tape window, 2 hubs with 6 spokes each, bottom trapezoid + 4 holes
  assert.match(decorative, /<rect[^>]*width="61"[^>]*height="37"[^>]*rx="3\.2"/);
  assert.match(decorative, /<circle[^>]*cx="5"[^>]*cy="5"/);
  assert.match(decorative, /<circle[^>]*cx="59"[^>]*cy="5"/);
  assert.match(decorative, /<circle[^>]*cx="5"[^>]*cy="35"/);
  assert.match(decorative, /<circle[^>]*cx="59"[^>]*cy="35"/);
  assert.match(decorative, /M 10\.6 4\.8 H 53\.4/);
  assert.match(decorative, /<rect[^>]*x="12\.2"[^>]*y="13\.8"[^>]*width="39\.6"[^>]*height="11\.6"/);
  assert.match(decorative, /<circle[^>]*cx="19\.8"[^>]*cy="19\.6"[^>]*r="4\.3"/);
  assert.match(decorative, /<circle[^>]*cx="44\.2"[^>]*cy="19\.6"[^>]*r="4\.3"/);
  assert.match(decorative, /M 14\.0 38\.5 L 17\.2 30\.2 H 46\.8 L 50\.0 38\.5/);
  assert.match(decorative, /<circle[^>]*cx="22"[^>]*cy="35"/);
  assert.match(decorative, /<circle[^>]*cx="42"[^>]*cy="35"/);
  assert.match(decorative, /<circle[^>]*cx="28\.2"[^>]*cy="33\.8"/);
  assert.match(decorative, /<circle[^>]*cx="35\.8"[^>]*cy="33\.8"/);

  // 2 label ruling lines + 3 center tape-gauge ticks + 12 hub drive spokes (6 per hub) = 17 <line> elements
  const lineCount = (decorative.match(/<line\b/g) ?? []).length;
  assert.equal(lineCount, 17);

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

test('SVG favicon and globals.css carry the 1980s cassette silhouette and remove legacy circle-mark CSS', async () => {
  const iconSvg = await readFile(path.resolve('src/app/icon.svg'), 'utf8');
  assert.match(iconSvg, /<svg[^>]*viewBox="0 0 32 32"/);
  assert.match(iconSvg, /#f7f4ed/i);
  assert.match(iconSvg, /#254c38/i);
  assert.match(iconSvg, /<rect[^>]*x="3"[^>]*y="6\.5"[^>]*width="26"[^>]*height="19"/);
  assert.match(iconSvg, /<line[^>]*y1="10\.2"/);
  assert.match(iconSvg, /<circle[^>]*cx="11\.2"[^>]*cy="16\.2"/);
  assert.match(iconSvg, /<circle[^>]*cx="20\.8"[^>]*cy="16\.2"/);
  assert.match(iconSvg, /<path[^>]*d="M8\.8 25\.5 L10\.8 21\.8 H21\.2 L23\.2 25\.5 Z"/);

  const css = await readFile(path.resolve('src/app/globals.css'), 'utf8');
  assert.doesNotMatch(css, /\.collection-mark\b/);
  assert.doesNotMatch(css, /\.unlisted-label\b/);
  assert.match(css, /\.cassette-reel-logo\b/);
  assert.match(css, /\.theme-menu\b/);
});
