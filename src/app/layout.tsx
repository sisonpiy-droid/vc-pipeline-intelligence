import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Nav } from "@/components/Nav";
import { RunBar } from "@/components/RunBar";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: { default: "VC Pipeline Intelligence", template: "%s · VC Pipeline Intelligence" },
  description: "Which investors are worth contacting this week, and the evidence why — for a Seed-stage B2B logistics SaaS.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1 };
export const dynamic = "force-dynamic"; // every page reads live data

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-dvh font-sans antialiased">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
          Skip to content
        </a>
        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 pt-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-baseline gap-2">
              <span className="text-base font-semibold tracking-tight">VC Pipeline Intelligence</span>
              <span className="hidden text-xs text-muted sm:inline">Seed · B2B logistics SaaS</span>
            </div>
            <Nav />
          </div>
        </header>
        <RunBar />
        <main id="main" className="mx-auto w-full max-w-6xl px-4 py-6">
          {children}
        </main>
        <footer className="mx-auto max-w-6xl px-4 pb-10 text-xs text-muted">
          Signals come from public web pages, each linked to its source. AI (Gemini Flash) classifies evidence; scores are computed by fixed, documented rules.
        </footer>
      </body>
    </html>
  );
}
