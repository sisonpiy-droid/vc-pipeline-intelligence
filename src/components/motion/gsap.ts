import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

// Client-only module: imported exclusively by "use client" components in this folder. GSAP is used for the
// things CSS cannot do (scroll-linked scrubbing, count-ups, pointer physics); entrance reveals stay in CSS so
// the page is fully visible without JavaScript.
if (typeof window !== "undefined") gsap.registerPlugin(ScrollTrigger);

export { gsap, ScrollTrigger };

export const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
export const hasFinePointer = () => typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
