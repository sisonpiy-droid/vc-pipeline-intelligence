"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { gsap, prefersReducedMotion } from "./gsap";

/**
 * Choreographs the hero: children marked `data-hero` rise in one after another on a single timeline.
 *
 * Visibility is never left to chance: the markup starts hidden via `.js-hide`, which un-hides itself after 1.2 s
 * if this script never runs. Once it does run it drops that class and takes over with explicit inline values, so
 * the end state is always opacity 1 whatever the CSS says.
 */
export function HeroReveal({ children, className }: { children: ReactNode; className?: string }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const items = Array.from(el.querySelectorAll<HTMLElement>("[data-hero]"));
    const show = () => gsap.set(items, { opacity: 1, y: 0, clearProps: "transform" });
    items.forEach((i) => i.classList.remove("js-hide"));
    gsap.set(items, { animation: "none" });
    if (prefersReducedMotion()) {
      show();
      return;
    }
    gsap.set(items, { opacity: 0, y: 26 });
    const ctx = gsap.context(() => {
      gsap.to(items, { opacity: 1, y: 0, duration: 0.9, ease: "power4.out", stagger: 0.09, delay: 0.05, onComplete: show });
    }, el);
    return () => {
      ctx.revert();
      show();
    };
  }, []);
  return <div ref={root} className={className}>{children}</div>;
}
