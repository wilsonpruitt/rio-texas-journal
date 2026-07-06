import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import config from "@/lib/conference.ts";

// Default social-share card. Echoes the masthead: parchment surface, Fraunces
// display, the site title's last word in oxblood italic, one accent.
export const alt = `${config.branding.siteTitle} — a statistical portrait of the conference`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const titleWords = config.branding.siteTitle.split(" ");
const titleAccent = titleWords[titleWords.length - 1];
const titleMain = titleWords.slice(0, -1).join(" ");

export default async function Image() {
  const [serif, italic] = await Promise.all([
    readFile(join(process.cwd(), "og-assets/fraunces-600.ttf")),
    readFile(join(process.cwd(), "og-assets/fraunces-italic.ttf")),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#f3eee2",
          fontFamily: "Fraunces",
          padding: "70px 84px",
          borderTop: "10px solid #6e2417",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 25, fontWeight: 600, letterSpacing: 6, color: "#6b6354", textTransform: "uppercase" }}>
            {`An archive of the ${config.name}`}
          </div>
          <div style={{ width: 68, height: 3, background: "#6e2417", marginTop: 30, marginBottom: 34 }} />
          <div style={{ display: "flex", alignItems: "baseline", fontSize: 112, lineHeight: 1 }}>
            <span style={{ fontWeight: 600, color: "#1b1813" }}>{titleMain}</span>
            <span style={{ fontWeight: 400, fontStyle: "italic", color: "#6e2417", marginLeft: 28 }}>{titleAccent}</span>
          </div>
          <div style={{ fontSize: 42, fontWeight: 400, fontStyle: "italic", color: "#6b6354", marginTop: 28, maxWidth: 940, lineHeight: 1.3 }}>
            A statistical portrait of the conference — 481 churches, 2000–2024.
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div style={{ fontSize: 27, fontWeight: 600, color: "#938974" }}>Churches · Finance · Careers · Vitality</div>
          <div style={{ fontSize: 27, fontWeight: 600, color: "#1f6e62" }}>2000—2024</div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Fraunces", data: serif, weight: 600, style: "normal" },
        { name: "Fraunces", data: italic, weight: 400, style: "italic" },
      ],
    },
  );
}
