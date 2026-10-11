"use client";

import { useEffect, useRef } from "react";
import { gsap, prefersReducedMotion } from "./gsap";

/** Draws the evidence timeline's accent line as you scroll down it. Place as the first child of a `relative` list. */
export function TimelineLine() {
  const line = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = line.current;
    const list = el?.parentElement;
    if (!el || !list || prefersReducedMotion()) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(el, { scaleY: 0 }, { scaleY: 1, ease: "none", scrollTrigger: { trigger: list, start: "top 75%", end: "bottom 60%", scrub: 0.4 } });
    });
    return () => ctx.revert();
  }, []);
  return <span ref={line} aria-hidden className="absolute -left-px top-0 h-full w-[2px] origin-top rounded-full bg-accent" />;
}
