import { Simulator } from "@/components/Simulator";
import { isDemoView } from "@/lib/demoData/mode";
import { Empty, PageTitle, SetupError } from "@/components/ui";
import { load, today } from "@/lib/page";
import { getSimulationInputs } from "@/lib/simulate";

export const dynamic = "force-dynamic";
export const metadata = { title: "What-if ranking" };

export default async function SimulatePage() {
  const demo = await isDemoView();
  const res = await load((db) => getSimulationInputs(db, demo ? true : "all"));
  if (!res.ok) return <SetupError message={res.error} />;
  return (
    <>
      <PageTitle title="What-if ranking" sub="Change what you care about and watch the ranking move. It uses the same scoring function as the dashboard on the stored evidence; nothing is saved, no search credits are used." />
      {res.data.length === 0 ? (
        <Empty title="Nothing to simulate yet">Run a refresh first: the simulator re-scores evidence that has already been collected.</Empty>
      ) : (
        <Simulator investors={res.data} now={today()} />
      )}
    </>
  );
}
