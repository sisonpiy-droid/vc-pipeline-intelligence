"use client";

import { useRef } from "react";
import { Play } from "@phosphor-icons/react";

const CHAPTERS: [number, string][] = [
  [0, "The problem"], [10, "The answer, first"], [20, "Who to email, with proof"], [41, "One-click mail"], [53, "The weekly brief"],
  [72, "How the refresh works"], [80, "The write boundary"], [88, "Quiet is never a failure"], [101, "Ask the assistant"], [110, "The numbers"],
];
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** The two-minute demo with chapters that jump to a moment. The video file lives in /public, so it is served by the app itself. */
export function DemoPlayer() {
  const ref = useRef<HTMLVideoElement>(null);
  const jump = (s: number) => { const v = ref.current; if (!v) return; v.currentTime = s; void v.play(); };
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_16rem]">
      <video ref={ref} controls preload="metadata" playsInline poster="/demo/vc-pipeline-demo.jpg" className="aspect-video w-full rounded-2xl border border-line bg-black">
        <source src="/demo/vc-pipeline-demo.mp4" type="video/mp4" />
        Your browser cannot play this video. <a href="/demo/vc-pipeline-demo.mp4">Download it</a>.
      </video>
      <div>
        <h2 className="text-sm font-semibold">Jump to</h2>
        <ol className="mt-2 divide-y divide-line border-y border-line">
          {CHAPTERS.map(([s, label]) => (
            <li key={s}>
              <button type="button" onClick={() => jump(s)} className="press group flex w-full items-center gap-3 py-2.5 text-left text-sm text-muted transition-colors hover:text-ink">
                <span className="num w-9 shrink-0 text-xs text-accent">{clock(s)}</span>
                <span className="flex-1">{label}</span>
                <Play aria-hidden size={12} weight="fill" className="opacity-0 transition-opacity group-hover:opacity-100" />
              </button>
            </li>
          ))}
        </ol>
        <a href="/demo/vc-pipeline-demo.mp4" download className="mt-4 inline-block text-xs font-medium text-accent hover:underline">Download the video (11 MB)</a>
      </div>
    </div>
  );
}
