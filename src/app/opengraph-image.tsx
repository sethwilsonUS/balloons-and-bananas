import { renderOpenGraphImageResponse } from '@/lib/og-card';
import { loadOgFonts } from './og-fonts';

export const alt = 'The Seth Tapes — A childhood-language archive from the Peters/Wilson corpus';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OpenGraphImage() {
  const fonts = await loadOgFonts();
  return renderOpenGraphImageResponse({ fonts });
}
