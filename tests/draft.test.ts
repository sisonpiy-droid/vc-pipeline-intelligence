import { describe, expect, it } from "vitest";
import { draftLinks } from "@/components/EmailDraft";
import { composeEmail, greeting, sender, templateDraft } from "@/lib/draft";

const lead = { headline: "Drivn Funding: ₹45 Cr Seed Round Led by Avaana Capital", summary: "Avaana Capital invested in Drivn.", published_at: "2026-09-21" };

describe("templateDraft", () => {
  it("uses only what the source says: its headline and date, with a placeholder for the sender", () => {
    const d = templateDraft({ relationship_status: "not_contacted", lead })!;
    expect(d).toContain("“Drivn Funding: ₹45 Cr Seed Round Led by Avaana Capital”");
    expect(d).toContain("21 Sep 2026");
    expect(d).toContain("Seed round");
    expect(d.endsWith("[Your name]")).toBe(true); // no FOUNDER_NAME set in tests: a visible placeholder, never an invented name
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
    expect(draftLinks({ to: null, subject: "Intro", body }).mailto.startsWith("mailto:?subject=Intro&body=Hi")).toBe(true);
    expect(draftLinks({ to: "sisonpiy@gmail.com", subject: "[DEMO] Intro", body }).mailto.startsWith("mailto:sisonpiy@gmail.com?subject=")).toBe(true);
    expect(draftLinks({ to: null, subject: "Intro", body }).gmail).toContain("&to=&su=");
  });
});

describe("composeEmail: greeting, why you, a brief about the startup, a meeting link, sign-off", () => {
  const set = { name: "Vikram Rao", company: "Haulr", brief: "We build freight software for trucking fleets.", calendly: "https://calendly.com/vikram/20min" };
  const m = composeEmail({ opening: "I read about your new fund.", firm: "Kae Capital", kind: "vc_firm", sender: set });

  it("has every part, in order", () => {
    const at = ["Hi Kae Capital team,", "I read about your new fund.", "A little about us: We build freight software", "https://calendly.com/vikram/20min", "Vikram Rao\nHaulr"].map((t) => m.body.indexOf(t));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(m.subject).toBe("Introduction: Haulr, Seed-stage B2B logistics SaaS");
  });

  it("greets an angel by first name and a firm as a team", () => {
    expect(greeting("Anupam Mittal", "angel")).toBe("Hi Anupam,");
    expect(greeting("Blume Ventures", "vc_firm")).toBe("Hi Blume Ventures team,");
  });

  it("never invents the founder's details: anything not configured stays a visible placeholder, and only an https link is accepted", () => {
    const s = sender({});
    expect(s).toMatchObject({ name: "[Your name]", company: null, calendly: "[your Calendly link]" });
    expect(s.brief).toContain("[Add one line of traction");
    expect(sender({ CALENDLY_URL: "javascript:alert(1)" }).calendly).toBe("[your Calendly link]");
    expect(sender({ CALENDLY_URL: "https://calendly.com/x/y", FOUNDER_NAME: " Vikram " })).toMatchObject({ calendly: "https://calendly.com/x/y", name: "Vikram" });
  });
});

