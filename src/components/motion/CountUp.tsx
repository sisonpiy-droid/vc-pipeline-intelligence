"use client";

import { useEffect, useRef } from "react";
import { gsap, prefersReducedMotion } from "./gsap";

/** A number that counts up when it scrolls into view. Server-rendered with its final value, so it is correct without JS. */
export function CountUp({ value, className }: { value: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;
    const state = { v: 0 };
    el.textContent = "0";
    const ctx = gsap.context(() => {
      gsap.to(state, {
        v: value,
        duration: 1.1,
        ease: "power3.out",
        scrollTrigger: { trigger: el, start: "top 95%", once: true },
        onUpdate: () => { el.textContent = String(Math.round(state.v)); },
        onComplete: () => { el.textContent = String(value); },
      });
    });
    return () => {
      ctx.revert();
      el.textContent = String(value);
    };
  }, [value]);
  return <span ref={ref} className={className}>{value}</span>;
}
