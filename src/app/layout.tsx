import type { Metadata } from "next";
import { Fraunces, Libre_Franklin, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { SiteHeader } from "./SiteHeader";
import { SiteFooter } from "./SiteFooter";
import { isUnlocked } from "@/lib/unlock";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["opsz", "SOFT", "WONK"],
});
const franklin = Libre_Franklin({
  variable: "--font-franklin",
  subsets: ["latin"],
});
const jbmono = JetBrains_Mono({
  variable: "--font-jbmono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3000",
  ),
  title: {
    default: "Rio Texas Atlas — A Statistical Portrait of the Conference",
    template: "%s · Rio Texas Atlas",
  },
  description:
    "An interactive statistical atlas of the Rio Texas Annual Conference and its predecessor conferences — 481 churches, 2000–2024, with trends, projections, and vitality analysis.",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const unlocked = await isUnlocked();
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${franklin.variable} ${jbmono.variable} h-full antialiased`}
    >
      <head>
        <script defer src="/_vercel/insights/script.js"></script>
      </head>
      <body className="min-h-full flex flex-col">
        <SiteHeader unlocked={unlocked} />
        <div className="flex-1">{children}</div>
        <SiteFooter />
      </body>
    </html>
  );
}
