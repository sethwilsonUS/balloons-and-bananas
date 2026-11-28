import { ImageResponse } from 'next/og';

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
          width="136"
          height="78"
          viewBox="0 0 40 23"
          fill="none"
          stroke="#254c38"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="9" cy="9.25" r="7.75" strokeWidth="1.75" />
          <circle cx="9" cy="9.25" r="2.65" strokeWidth="1.5" />
          <line x1="9" y1="6.6" x2="9" y2="3.5" strokeWidth="1.4" />
          <line x1="11.3" y1="10.58" x2="13.98" y2="12.13" strokeWidth="1.4" />
          <line x1="6.7" y1="10.58" x2="4.02" y2="12.13" strokeWidth="1.4" />

          <circle cx="31" cy="9.25" r="7.75" strokeWidth="1.75" />
          <circle cx="31" cy="9.25" r="2.65" strokeWidth="1.5" />
          <line x1="31" y1="11.9" x2="31" y2="15" strokeWidth="1.4" />
          <line x1="33.3" y1="7.92" x2="35.98" y2="6.37" strokeWidth="1.4" />
          <line x1="28.7" y1="7.92" x2="26.02" y2="6.37" strokeWidth="1.4" />

          <path d="M3.8 15 L9.6 20.25 H30.4 L36.2 15" strokeWidth="1.75" />
        </svg>
      </div>
    ),
    {
      ...size,
    },
  );
}
