import { DemoPlayer } from "@/components/DemoPlayer";
import { PageTitle } from "@/components/ui";

export const metadata = { title: "Demo video" };

export default function VideoPage() {
  return (
    <>
      <PageTitle
        eyebrow="Watch"
        title="Two-minute demo"
        sub="The whole product in two minutes: who to email first and why, how the twice-weekly refresh works, and why your notes are never touched. Captions are on screen, so it works with the sound off."
      />
      <DemoPlayer />
    </>
  );
}
