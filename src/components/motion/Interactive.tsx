"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { gsap, hasFinePointer, prefersReducedMotion } from "./gsap";

/**
 * Wraps a card with pointer physics: a gentle 3-D tilt and a soft spotlight that follows the cursor
 * (the spotlight itself is CSS, driven by --mx/--my). Mouse only; disabled for touch and reduced motion.
 * Content stays fully readable and clickable — the tilt is a few degrees at most.
 */
export function Interactive({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion() || !hasFinePointer()) return;
    const rx = gsap.quickTo(el, "rotationX", { duration: 0.5, ease: "power3.out" });
    const ry = gsap.quickTo(el, "rotationY", { duration: 0.5, ease: "power3.out" });
    gsap.set(el, { transformPerspective: 900 });
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      el.style.setProperty("--mx", `${e.clientX - r.left}px`);
      el.style.setProperty("--my", `${e.clientY - r.top}px`);
      ry((px - 0.5) * 3);
      rx((0.5 - py) * 2.4);
    };
    const leave = () => { rx(0); ry(0); };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
      gsap.killTweensOf(el);
      gsap.set(el, { clearProps: "transform" });
    };
  }, []);
  return <div ref={ref} className="spot relative" style={style}>{children}</div>;
}
