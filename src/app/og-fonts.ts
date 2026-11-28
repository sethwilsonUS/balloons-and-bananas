import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

type FontWeight = 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;

export type OgFont = {
  name: string;
  data: ArrayBuffer;
  weight: FontWeight;
  style: 'normal';
};

export const OG_SERIF_FAMILY = 'Source Serif 4';
export const OG_SANS_FAMILY = 'Source Sans 3';

let cachedFonts: OgFont[] | null = null;

function toExactArrayBuffer(bytes: Buffer): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

/**
 * Load the bundled SIL OFL 1.1 static WOFF v1 font subsets used strictly on the
 * server for Satori Open Graph PNG rendering (never exposed as browser webfonts).
 * Uses static literal paths under `src/app/og-fonts` so Turbopack / `@vercel/nft`
 * traces only the three font files rather than the whole project, and falls back
 * cleanly to an empty list if any font file cannot be read.
 */
export async function loadOgFonts(options?: {
  readFontFile?: (filePath: string) => Promise<Buffer>;
  bypassCache?: boolean;
}): Promise<OgFont[]> {
  const useCache = !options?.readFontFile && !options?.bypassCache;
  if (useCache && cachedFonts) return cachedFonts;

  const reader = options?.readFontFile ?? ((filePath: string) => readFile(filePath));

  try {
    const [serifMedium, sansRegular, sansMedium] = await Promise.all([
      reader(join(process.cwd(), 'src', 'app', 'og-fonts', 'source-serif-4-latin-500-normal.woff')),
      reader(join(process.cwd(), 'src', 'app', 'og-fonts', 'source-sans-3-latin-400-normal.woff')),
      reader(join(process.cwd(), 'src', 'app', 'og-fonts', 'source-sans-3-latin-500-normal.woff')),
    ]);

    const loaded: OgFont[] = [
      {
        name: OG_SERIF_FAMILY,
        data: toExactArrayBuffer(serifMedium),
        weight: 500,
        style: 'normal',
      },
      {
        name: OG_SANS_FAMILY,
        data: toExactArrayBuffer(sansRegular),
        weight: 400,
        style: 'normal',
      },
      {
        name: OG_SANS_FAMILY,
        data: toExactArrayBuffer(sansMedium),
        weight: 500,
        style: 'normal',
      },
    ];

    if (useCache) {
      cachedFonts = loaded;
    }
    return loaded;
  } catch {
    return [];
  }
}
