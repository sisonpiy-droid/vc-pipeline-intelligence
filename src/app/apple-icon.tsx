import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** The home-screen icon: the same green tile and pulse line as the favicon, as a PNG (iOS does not read SVG icons). */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#0e7a59" }}>
        <svg width="120" height="120" viewBox="0 0 32 32">
          <path d="M5 17h5.2l3-8.4 5.3 15 3.2-9.2 1.3 2.6H27" fill="none" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    ),
    size,
  );
}
