import Link from "next/link";
import { Eyebrow } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="max-w-xl py-10">
      <Eyebrow>404</Eyebrow>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">That page or investor doesn't exist</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted">The link may be old, or the investor was never imported.</p>
      <Link href="/pipeline" className="press mt-6 inline-block rounded-lg bg-ink px-4 py-2 text-sm font-medium text-bg hover:opacity-90">
        Back to the pipeline
      </Link>
    </div>
  );
}
