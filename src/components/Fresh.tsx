import { Clock } from "@phosphor-icons/react/dist/ssr";
import { ago } from "@/lib/format";

const STALE_DAYS = 7;

/** "Checked 6 h ago" — turns amber past a week, and says so plainly when an investor was never checked. */
export function Fresh({ at, now = new Date() }: { at: string | null; now?: Date }) {
  const never = !at;
  const days = at ? (now.getTime() - new Date(at).getTime()) / 86_400_000 : Infinity;
  const stale = never || days > STALE_DAYS;
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${stale ? "text-warn" : "text-muted"}`} title={stale ? "Data for this investor is more than a week old" : "When this investor's sources were last checked"}>
      <Clock aria-hidden size={12} weight="bold" />
      {never ? "Never checked" : `Checked ${ago(at, now)}`}
      {stale && !never && <span className="font-medium">· stale</span>}
    </span>
  );
}
