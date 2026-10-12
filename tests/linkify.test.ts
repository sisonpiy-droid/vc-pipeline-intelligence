import { describe, expect, it } from "vitest";
import { toHtml } from "../src/lib/linkify";

describe("linkify", () => {
  it("turns the Calendly address into a real link and keeps sentence punctuation out of it", () => {
    const html = toHtml("Pick a time: https://calendly.com/x/30min.\nThanks <3");
    expect(html).toContain('<a href="https://calendly.com/x/30min">https://calendly.com/x/30min</a>.<br>Thanks &lt;3');
  });
});
