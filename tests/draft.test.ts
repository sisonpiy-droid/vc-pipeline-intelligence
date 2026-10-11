import { describe, expect, it } from "vitest";
import { draftLinks } from "@/components/EmailDraft";
import { templateDraft } from "@/lib/draft";

const lead = { headline: "Drivn Funding: ₹45 Cr Seed Round Led by Avaana Capital", summary: "Avaana Capital invested in Drivn.", published_at: "2026-09-21" };

describe("templateDraft", () => {
  it("uses only what the source says: its headline and date, with a placeholder for the sender", () => {
    const d = templateDraft({ relationship_status: "not_contacted", lead })!;
    expect(d).toContain("“Drivn Funding: ₹45 Cr Seed Round Led by Avaana Capital”");
    expect(d).toContain("21 Sep 2026");
    expect(d).toContain("Seed round for a B2B logistics SaaS");
    expect(d.endsWith("[Your name]")).toBe(true);
  });

  it("falls back to the summary when the page title is unusable (a bare platform name, 'Someone's Post')", () => {
    expect(templateDraft({ relationship_status: "not_contacted", lead: { ...lead, headline: "Sid Choudhury's Post" } })).toContain("Avaana Capital invested in Drivn");
    expect(templateDraft({ relationship_status: "not_contacted", lead: { ...lead, headline: "- YouTube", summary: null } })).toBeNull(); // nothing safe to say
  });

  it("offers no draft without a lead signal, or to someone who passed, committed, or whose reply is awaited", () => {
    expect(templateDraft({ relationship_status: "not_contacted", lead: null })).toBeNull();
    for (const s of ["passed", "committed", "awaiting_response"]) expect(templateDraft({ relationship_status: s, lead })).toBeNull();
    expect(templateDraft({ relationship_status: "contacted", lead })).not.toBeNull();
  });

  it("opens in the viewer's mail app with NO recipient for a real investor, and the test address for a demo one", () => {
    const body = templateDraft({ relationship_status: "not_contacted", lead })!;
    expect(draftLinks({ to: null, subject: "Intro", body }).mailto.startsWith("mailto:?subject=Intro&body=Hello")).toBe(true);
    expect(draftLinks({ to: "sisonpiy@gmail.com", subject: "[DEMO] Intro", body }).mailto.startsWith("mailto:sisonpiy@gmail.com?subject=")).toBe(true);
    expect(draftLinks({ to: null, subject: "Intro", body }).gmail).toContain("&to=&su=");
  });
});
