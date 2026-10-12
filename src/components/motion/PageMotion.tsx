"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { gsap, ScrollTrigger, prefersReducedMotion } from "./gsap";

/** Chrome, or things another animation already owns (CSS `.reveal`, the home hero, dialogs). */
const OWNED = ".reveal, [data-hero], .js-hide, nav, aside, [role=dialog], [data-no-motion]";
const MAX = 160; // a very long list animates its first screens; the rest simply appear

/**
 * One choreography for every page, run by GSAP on each navigation:
 *  1. the page title: eyebrow, heading and intro rise one after another while a short accent rule draws under them;
 *  2. everything repeated below it (list rows, cards, folds, table rows, and anything marked `data-rise`) rises in as it
 *     scrolls into view, a few at a time.
 * Content is only ever hidden by this script, never by the stylesheet, so a page is fully visible without JavaScript; the title
 * parts carry `.js-hide`, which un-hides itself after 1.2 s if this never runs. Reduced motion skips all of it.
 */
export function PageMotion() {
  const path = usePathname();
  const search = useSearchParams().toString();

  useEffect(() => {
    const main = document.getElementById("main");
    if (!main) return;
    const parts = Array.from(main.querySelectorAll<HTMLElement>("[data-title-part]"));
    const rule = main.querySelector<HTMLElement>("[data-title-rule]");
    const head = rule ? [...parts, rule] : parts;
    const settle = (els: HTMLElement[]) => { els.forEach((e) => e.classList.remove("js-hide")); gsap.set(els, { animation: "none", opacity: 1, y: 0, scaleX: 1, clearProps: "transform" }); };
    if (prefersReducedMotion()) { settle(head); return; }

    head.forEach((e) => e.classList.remove("js-hide"));
    gsap.set(head, { animation: "none" });
    gsap.set(parts, { opacity: 0, y: 22 });
    if (rule) gsap.set(rule, { opacity: 1, scaleX: 0, transformOrigin: "left center" });
    const tl = gsap.timeline({ onComplete: () => settle(head) });
    tl.to(parts, { opacity: 1, y: 0, duration: 0.7, ease: "power3.out", stagger: 0.09 }, 0.05);
    if (rule) tl.to(rule, { scaleX: 1, duration: 0.9, ease: "power2.inOut" }, 0.25);

    // Everything repeated below: the innermost items, plus anything marked data-rise (whose insides then stay put).
    // Items inside a fold are never animated (a closed fold has no position to trigger on); the fold itself is the unit.
    const candidates = Array.from(main.querySelectorAll<HTMLElement>("li, details, article, tbody tr, [data-rise]")).filter((e) => !e.parentElement?.closest("details"));
    const targets = candidates
      .filter((e) => !e.closest(OWNED) && (e.hasAttribute("data-rise") || (!e.closest("[data-rise]") && !candidates.some((o) => o !== e && e.contains(o)))))
      .slice(0, MAX);
    const show = (els: HTMLElement[]) => gsap.set(els, { opacity: 1, y: 0, clearProps: "opacity,transform" });
    gsap.set(targets, { opacity: 0, y: 26 });
    ScrollTrigger.batch(targets, {
      start: "top 97%", once: true, interval: 0.1, batchMax: 10,
      onEnter: (batch) => { gsap.to(batch, { opacity: 1, y: 0, duration: 0.75, ease: "power3.out", stagger: 0.06, overwrite: true, clearProps: "opacity,transform" }); },
    });
    // A background tab pauses animation frames: anything already on screen is shown by a timer instead.
    const guard = setTimeout(() => show(targets.filter((e) => Number(gsap.getProperty(e, "opacity")) < 0.99 && e.getBoundingClientRect().top < window.innerHeight * 1.1)), 3500);
    const onPrint = () => show(targets);
    window.addEventListener("beforeprint", onPrint);

    return () => {
      clearTimeout(guard);
      window.removeEventListener("beforeprint", onPrint);
      tl.kill();
      ScrollTrigger.getAll().forEach((t) => t.kill());
      gsap.killTweensOf(targets);
      show(targets);
      settle(head);
    };
  }, [path, search]);

  return null;
}
