"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { gsap, prefersReducedMotion } from "./gsap";

/**
 * Choreographs the hero: children marked `data-hero` rise in one after another on a single timeline.
 * Hidden state comes from CSS (`.js-hide`, which un-hides itself after 1.2 s even if this script never runs),
 * so there is no flash of unstyled content and no dependence on JavaScript.
 */
export function HeroReveal({ children, className }: { children: ReactNode; className?: string }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const items = el.querySelectorAll<HTMLElement>("[data-hero]");
    if (prefersReducedMotion()) {
      gsap.set(items, { opacity: 1, animation: "none" });
      return;
    }
    const ctx = gsap.context(() => {
      gsap.set(items, { animation: "none" });
      gsap.fromTo(items, { opacity: 0, y: 26 }, { opacity: 1, y: 0, duration: 0.9, ease: "power4.out", stagger: 0.09, delay: 0.05 });
    }, el);
    return () => {
      ctx.revert();
      gsap.set(items, { opacity: 1, clearProps: "transform" });
    };
  }, []);
  return <div ref={root} className={className}>{children}</div>;
}
