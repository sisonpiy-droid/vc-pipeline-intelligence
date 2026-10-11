import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Pulse } from "@phosphor-icons/react/dist/ssr";
import { Nav } from "@/components/Nav";
import { RunBar } from "@/components/RunBar";
import { ScrollProgress } from "@/components/motion/ScrollProgress";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "VC Pipeline Intelligence", template: "%s · VC Pipeline Intelligence" },
  description: "Which investors are worth contacting this week, and the evidence why — for a Seed-stage B2B logistics SaaS.",
  robots: { index: false, follow: false }, // a founder's fundraising tool: keep it out of search indexes
};
export const viewport: Viewport = { width: "device-width", initialScale: 1 };
export const dynamic = "force-dynamic"; // every page reads live data

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`}>
      <body className="min-h-dvh font-sans antialiased">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
          Skip to content
        </a>
        <header className="sticky top-0 z-30 border-b border-line bg-surface/85 backdrop-blur-md">
          <ScrollProgress />
          <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 pt-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="flex items-center gap-2.5">
              <span aria-hidden className="grid h-7 w-7 place-items-center rounded-lg bg-accent text-white dark:text-black">
                <Pulse size={16} weight="bold" />
              </span>
              <span className="text-[0.95rem] font-semibold tracking-tight">VC Pipeline Intelligence</span>
              <span className="num hidden text-[0.7rem] uppercase tracking-[0.12em] text-muted md:inline">Seed · B2B logistics SaaS</span>
            </div>
            <Nav />
          </div>
        </header>
        <RunBar />
        <main id="main" className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6">
          {children}
        </main>
        <footer className="mx-auto max-w-7xl px-4 pb-12 text-xs leading-relaxed text-muted sm:px-6">
          Signals come from public web pages, each linked to its source. Gemini Flash classifies evidence; scores are computed by fixed, documented rules.
        </footer>
      </body>
    </html>
  );
}
