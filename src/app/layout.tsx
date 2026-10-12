import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Pulse } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { CommandPalette } from "@/components/CommandPalette";
import { DemoBar } from "@/components/DemoBar";
import { ChatWidget } from "@/components/ChatWidget";
import { CompareTray } from "@/components/CompareTray";
import { MobileMenu, SideNav } from "@/components/Nav";
import { ThemeToggle } from "@/components/ThemeToggle";
import { THEME_SCRIPT } from "@/lib/theme";
import { RunBar } from "@/components/RunBar";
import { ScrollProgress } from "@/components/motion/ScrollProgress";
import { isOpenDemo } from "@/lib/demo";
import { isDemoView } from "@/lib/demoData/mode";
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

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" aria-label="VC Pipeline Intelligence: go to the home screen" className="press flex items-center gap-2.5 rounded-lg">
      <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-accent text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.25)] dark:text-black">
        <Pulse size={17} weight="bold" />
      </span>
      <span className="leading-tight">
        <span className="block text-[0.95rem] font-semibold tracking-tight">VC Pipeline</span>
        {!compact && <span className="num block text-[0.65rem] uppercase tracking-[0.12em] text-muted">Seed · B2B logistics SaaS</span>}
      </span>
    </Link>
  );
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const demo = await isDemoView();
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        {/* Runs before first paint: the saved choice, else the OS setting. Prevents a light flash for night-mode visitors. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh font-sans antialiased">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
          Skip to content
        </a>
        {demo && <DemoBar needPass={!isOpenDemo()} />}
        <div className="lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
          {/* Desktop rail: brand, search, grouped navigation, and the demo switch. */}
          <aside className="hidden h-dvh flex-col gap-6 overflow-y-auto border-r border-line bg-surface/60 px-4 py-5 lg:sticky lg:top-0 lg:z-40 lg:flex">
            <Brand />
            <CommandPalette wide />
            <div className="flex-1"><SideNav /></div>
            <ThemeToggle wide />
            {/* A plain anchor, not a Link: this route has a side effect (it creates the demo data), so it must never be prefetched. */}
            {!demo && <a href="/demo/on" className="press rounded-lg border border-line px-3 py-2 text-center text-xs font-medium text-muted transition-colors hover:border-accent/50 hover:text-ink" title="Explore the app with clearly labelled synthetic investors; real data is not touched">Try demo mode</a>}
          </aside>
          <div className="min-w-0">
            <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-surface/85 px-4 py-2.5 backdrop-blur-md sm:px-6 lg:hidden">
              <ScrollProgress />
              <MobileMenu />
              <Brand compact />
              <span className="ml-auto flex items-center gap-2"><CommandPalette /><ThemeToggle /></span>
            </header>
            <RunBar demo={demo} />
            <main id="main" className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-8 lg:py-12">
              {children}
            </main>
            <CompareTray />
            <ChatWidget />
            <footer className="mx-auto max-w-6xl border-t border-line px-4 py-6 text-xs leading-relaxed text-muted sm:px-8">
              Signals come from public web pages, each linked to its source. Gemini Flash classifies evidence; scores are computed by fixed, documented rules.
            </footer>
          </div>
        </div>
      </body>
    </html>
  );
}
