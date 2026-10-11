"use client";

import { useEffect, useRef } from "react";
import { gsap, prefersReducedMotion } from "./gsap";

/** A hairline at the very top of the page that fills as you scroll (scrubbed by ScrollTrigger). */
export function ScrollProgress() {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = bar.current;
    if (!el || prefersReducedMotion()) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(el, { scaleX: 0 }, { scaleX: 1, ease: "none", scrollTrigger: { start: 0, end: "max", scrub: 0.25 } });
    });
    return () => ctx.revert();
  }, []);
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[2px]">
      <div ref={bar} className="h-full origin-left scale-x-0 bg-accent" />
    </div>
  );
}
