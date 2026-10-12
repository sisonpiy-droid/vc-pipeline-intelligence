import { StartupForm } from "@/components/StartupForm";
import { PageTitle } from "@/components/ui";
import { isOpenDemo } from "@/lib/demo";

export const dynamic = "force-dynamic";
export const metadata = { title: "Add a startup" };

export default function NewStartupPage() {
  return (
    <>
      <PageTitle title="Add a startup" sub="Describe it in a few lines. Gemini drafts a scoring rubric for it; you review and can edit that rubric before anything is scored." />
      <StartupForm needPass={!isOpenDemo()} />
    </>
  );
}
