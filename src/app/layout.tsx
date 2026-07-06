import type { Metadata } from "next";
import { Fraunces, Libre_Franklin, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { SiteHeader } from "./SiteHeader";
import { SiteFooter } from "./SiteFooter";
import { isUnlocked } from "@/lib/unlock";
import config from "@/lib/conference";

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
    default: `${config.branding.siteTitle} — ${config.branding.ogTagline}`,
    template: `%s · ${config.branding.siteTitle}`,
  },
  description: config.branding.metaDescription,
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
