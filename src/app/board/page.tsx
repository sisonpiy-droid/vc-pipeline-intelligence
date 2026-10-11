import { Board, type BoardCard } from "@/components/Board";
import { isDemoView } from "@/lib/demoData/mode";
import { PageTitle, SetupError } from "@/components/ui";
import { cadence } from "@/lib/cadence";
import { isOpenDemo } from "@/lib/demo";
import { load, today } from "@/lib/page";
import { listPipeline, type PipelineRow } from "@/lib/read";

export const dynamic = "force-dynamic";
export const metadata = { title: "Outreach board" };

/** "Not contacted" lists only investors the scoring says are worth a message; the rest stay in the pipeline. */
const WORTH = new Set(["reach_out_now", "prepare_targeted_outreach", "research_further"]);

export default async function BoardPage() {
  const demo = await isDemoView();
  const res = await load((db) => listPipeline(db, today(), demo));
  if (!res.ok) return <SetupError message={res.error} />;
  const t = today();
  const toCard = (r: PipelineRow): BoardCard => ({
    id: r.id, firm_name: r.firm_name, entity_type: r.entity_type, score: r.follow_up_score, action: r.recommended_action, status: r.relationship_status,
    last_contact_date: r.last_contact_date, headline: r.lead?.headline ?? null, cadence: (() => { const c = cadence(r.relationship_status, r.last_contact_date, t); return c ? { label: c.label, tone: c.tone === "info" ? "neutral" : c.tone, due: c.due } : null; })(),
  });
  const started = res.data.filter((r) => r.relationship_status !== "not_contacted");
  const worth = res.data.filter((r) => r.relationship_status === "not_contacted" && r.state === "active" && WORTH.has(r.recommended_action ?? "")).sort((a, b) => (b.follow_up_score ?? 0) - (a.follow_up_score ?? 0));
  const hidden = res.data.filter((r) => r.relationship_status === "not_contacted").length - worth.length;
  const due = started.map((r) => cadence(r.relationship_status, r.last_contact_date, t)).filter((c) => c?.due).length;
  return (
    <>
      <PageTitle
        title="Outreach board"
        sub={`Drag an investor to the stage you are at, or use the “Move to” menu on each card. This is your data: a refresh can never move a card. ${due ? `${due} follow-up${due > 1 ? "s are" : " is"} due.` : ""}`}
      />
      <Board cards={[...worth, ...started].map(toCard)} needPass={!isOpenDemo()} hiddenInFirst={hidden} />
    </>
  );
}
