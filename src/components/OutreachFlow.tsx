import { Check } from "@phosphor-icons/react/dist/ssr";
import { cadence } from "@/lib/cadence";
import { Pill } from "./ui";
import { ReplyLog } from "./ReplyLog";

const STEPS = [
  { title: "Draft ready", caption: "The email is written from the evidence." },
  { title: "Mail sent", caption: "You press send in your own mail app. The investor moves to Contacted." },
  { title: "Reply", caption: "It arrives in your inbox. You log it here with one click." },
  { title: "Outcome", caption: "In conversation, passed or committed." },
] as const;

const AT: Record<string, number> = { not_contacted: 0, contacted: 1, awaiting_response: 1, in_conversation: 2, passed: 3, committed: 3 };
const NOW: Record<string, string> = {
  not_contacted: "Nothing has been sent yet. Open the draft with “Send mail” above.",
  contacted: "Sent. Waiting for a reply.",
  awaiting_response: "Sent. Waiting for a reply, and the score is holding off new nudges.",
  in_conversation: "They replied and you are talking.",
  passed: "They passed. They will not be suggested again on a new article alone.",
  committed: "They committed.",
};

/** Where this investor is in the outreach, and how a reply gets back into the app. */
export function OutreachFlow({ id, status, lastContact, today, needPass }: { id: string; status: string; lastContact: string | null; today: string; needPass: boolean }) {
  const at = AT[status] ?? 0;
  const cad = cadence(status, lastContact, today);
  return (
    <section aria-labelledby="flow-h" className="mt-8 max-w-[62ch] rounded-2xl border border-line bg-surface p-5">
      <h2 id="flow-h" className="text-sm font-semibold tracking-tight">Outreach and replies</h2>
      <ol className="mt-4 grid grid-cols-4 gap-2">
        {STEPS.map((s, i) => {
          const done = i < at;
          const cur = i === at;
          return (
            <li key={s.title} className="relative">
              <div className="flex items-center gap-2">
                <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[0.7rem] font-medium ${done ? "border-accent bg-accent text-white dark:text-black" : cur ? "border-accent text-accent ring-4 ring-accent/15" : "border-line text-muted"}`}>
                  {done ? <Check aria-hidden size={11} weight="bold" /> : <span className="num">{i + 1}</span>}
                </span>
                {i < STEPS.length - 1 && <span aria-hidden className={`h-px flex-1 ${done ? "bg-accent/60" : "bg-line"}`} />}
              </div>
              <p className={`mt-2 text-xs font-medium ${cur ? "text-ink" : "text-muted"}`}>{s.title}{cur && <span className="sr-only"> (current step)</span>}</p>
              <p className="mt-0.5 hidden text-[0.7rem] leading-snug text-muted sm:block">{s.caption}</p>
            </li>
          );
        })}
      </ol>
      <p className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        <span>{NOW[status] ?? ""}</span>
        {cad && <Pill tone={cad.tone}>{cad.label}</Pill>}
      </p>
      <ReplyLog id={id} status={status} needPass={needPass} />
      <p className="mt-4 text-xs leading-relaxed text-muted">
        Replies come to your own inbox. This app cannot read your mailbox, so tell it what happened: the score, the follow-up reminders on the weekly brief and the outreach board all follow what you log.
      </p>
    </section>
  );
}
