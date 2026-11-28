import { ImageResponse } from 'next/og';
import { renderCassetteTapeArtwork } from '../components/CassetteReelLogo';

export const size = {
  width: 180,
  height: 180,
};
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#f7f4ed',
        }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="144"
          height="90"
          viewBox="0 0 64 40"
          fill="none"
        >
          {renderCassetteTapeArtwork({ ink: '#254c38', shellFill: '#fcfaf5' })}
        </svg>
      </div>
    ),
    {
      ...size,
    },
  );
}
