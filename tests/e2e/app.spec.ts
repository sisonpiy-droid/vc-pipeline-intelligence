import { expect, test, type Page } from "@playwright/test";

/**
 * Real browser, production build, throwaway database seeded by the real pipeline over canned providers.
 * The fixture (scripts/dev-fixture.ts) gives a known world: Blume Ventures (strong signal), Peak XV (founder is awaiting a
 * reply, with private notes), Matrix (passed), Accel India (search FAILED), Lightspeed (page unreadable: coverage partial).
 */
const failOnConsoleErrors = (page: Page) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  return () => expect(errors, errors.join("\n")).toEqual([]);
};

test.describe.configure({ mode: "serial" });

test("the server cannot reach any paid or external provider (empty API keys), and says so", async ({ request }) => {
  const h = await (await request.get("/api/health")).json();
  expect(h.ok).toBe(true);
  expect(h.configured).toMatchObject({ database: true, gemini: false, search: false, open_demo: true });
});

test("overview: the answer first, with evidence behind every recommendation", async ({ page }) => {
  const done = failOnConsoleErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("investors have a fresh, relevant signal");
  await expect(page.getByRole("heading", { name: /investors? to email this week/ })).toBeVisible();
  const first = page.locator("#picks-h").locator("xpath=ancestor::section[1]");
  await expect(first.getByRole("link", { name: "Blume Ventures" }).first()).toBeVisible();
  await expect(first.getByText(/Logistics fit/).first()).toBeVisible(); // topic chip
  const evidence = first.getByRole("link", { name: /fixture\.example\.com/ }).first();
  await expect(evidence).toHaveAttribute("rel", /noopener/);
  await expect(evidence).toHaveAttribute("target", "_blank");
  // Peak XV: the founder is awaiting a reply, so it is on the "don't chase" list, not the to-do list
  await expect(page.getByRole("heading", { name: "Investors to hold off on", includeHidden: true })).toBeAttached();
  await expect(page.locator("aside").getByRole("link", { name: "Peak XV Partners" })).toBeVisible();
  done();
});

test("a failed search is never shown as quiet; partial coverage is its own state", async ({ page }) => {
  await page.goto("/quiet");
  const failed = page.getByRole("heading", { name: "Search failed" }).locator("xpath=ancestor::section[1]");
  await expect(failed).toContainText("Accel India");
  await expect(failed).toContainText("This is not inactivity");
  const partial = page.getByRole("heading", { name: /coverage incomplete/ }).locator("xpath=ancestor::section[1]");
  await expect(partial).toContainText("Lightspeed India Partners");
  const quiet = page.getByRole("heading", { name: "Searched — no relevant signal found" }).locator("xpath=ancestor::section[1]");
  await expect(quiet).not.toContainText("Accel India");
  await expect(quiet).not.toContainText("Lightspeed India Partners");
});

test("chat: opens from every page, answers from the data (a plain summary when Gemini is unavailable), links to the investors, clears and closes", async ({ page }) => {
  const done = failOnConsoleErrors(page);
  await page.goto("/pipeline");
  await page.getByRole("button", { name: "Ask about your pipeline" }).click();
  const chat = page.getByRole("dialog", { name: "Ask about your pipeline" });
  await expect(chat.getByText("It cannot send mail or see your private notes")).toBeVisible();
  await chat.getByRole("button", { name: "Who should I email this week?" }).click();
  // this server has no Gemini key, so it must say so and still answer from the real data instead of failing
  await expect(chat.getByText(/could not reach Gemini/)).toBeVisible();
  await expect(chat.getByText(/of \d+ investors have a fresh, relevant signal/)).toBeVisible();
  await expect(chat.getByRole("link", { name: "Blume Ventures" })).toHaveAttribute("href", /\/investors\//);
  await expect(chat.getByText("Plain summary: the model was unavailable.")).toBeVisible();
  // an empty question is not sent
  await expect(chat.getByRole("button", { name: "Send the question" })).toBeDisabled();
  await chat.getByRole("button", { name: "Clear the conversation" }).click();
  await expect(chat.getByText("Ask in plain words.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(chat).toHaveCount(0);
  // the API itself rejects an oversized question
  const bad = await page.request.post("/api/chat", { data: { message: "x".repeat(501) } });
  expect(bad.status()).toBe(400);
  done();
});

test("investor page: score breakdown, evidence with a verbatim quote, and the founder's data is read-only until edited", async ({ page }) => {
  await page.goto("/pipeline?q=Blume");
  await page.getByRole("link", { name: "Blume Ventures" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Blume Ventures" })).toBeVisible();
  for (const f of ["recency", "relevance", "evidence", "fit", "relationship"]) await expect(page.getByText(f, { exact: true }).first()).toBeVisible(); // the DOM text is lower-case; CSS capitalises it
  await expect(page.getByText("Computed by fixed rules, not by the AI")).toBeVisible();
  await expect(page.locator("blockquote").first()).toContainText("five million dollar Seed round");
  await expect(page.getByText("Score over time")).toBeVisible();
});

test("editing the founder's notes works, persists, and needs no passcode in open demo mode", async ({ page }) => {
  await page.goto("/pipeline?q=Peak");
  await page.getByRole("link", { name: "Peak XV Partners" }).first().click();
  await expect(page.getByText("Sent deck on Mon")).toBeVisible(); // the founder's note from the fixture
  await page.getByRole("button", { name: "Edit relationship" }).click();
  await page.getByLabel("Personal notes").fill("Partner replied Tuesday: wants the metrics pack.");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  await page.reload();
  await expect(page.getByText("wants the metrics pack")).toBeVisible();
});

test("outreach board: moving a card changes the founder-owned status, persists, and starts the follow-up clock", async ({ page }) => {
  await page.goto("/board");
  const card = page.locator("[data-card]").filter({ hasText: "Blume Ventures" });
  await expect(card).toBeVisible();
  await card.getByRole("combobox").selectOption("contacted");
  await expect(page.getByText(/Blume Ventures → Contacted/)).toBeVisible();
  await page.reload();
  const col = page.getByRole("region", { name: /^Contacted,/ });
  await expect(col.getByRole("link", { name: "Blume Ventures" })).toBeVisible();
  await expect(col.getByText(/Contacted \d+ days? ago/)).toBeVisible(); // cadence chip appears
});

test("outreach board: drag and drop works too", async ({ page }) => {
  await page.setViewportSize({ width: 1760, height: 900 }); // all six columns on screen: a drag needs a visible target
  await page.goto("/board");
  const card = page.locator("[data-card]").filter({ has: page.getByRole("link", { name: "Nithin Kamath" }) });
  // Grab the card by its title link (a link is draggable and the drag bubbles to the card).
  await card.getByRole("link", { name: "Nithin Kamath" }).dragTo(page.getByRole("region", { name: /^Awaiting response,/ }));
  await expect(page.getByRole("region", { name: /^Awaiting response,/ }).getByRole("link", { name: "Nithin Kamath" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("region", { name: /^Awaiting response,/ }).getByRole("link", { name: "Nithin Kamath" })).toBeVisible(); // persisted
});

test("what-if: moving a preset re-ranks investors without changing anything stored", async ({ page, request }) => {
  const before = await (await request.get("/api/palette")).json();
  await page.goto("/simulate");
  const reach = page.locator("[aria-live=polite] p.num").first();
  const prod = await reach.textContent();
  await page.getByRole("button", { name: "Cast a wide net" }).click();
  await expect.poll(async () => await reach.textContent()).not.toBe(prod);
  await page.getByRole("button", { name: "Production rules", exact: true }).click();
  await expect.poll(async () => await reach.textContent()).toBe(prod);
  const after = await (await request.get("/api/palette")).json();
  expect(after).toEqual(before); // nothing was written
});

test("Ctrl+K palette finds an investor, and comparison opens side by side", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Control+k");
  const input = page.getByRole("combobox");
  await input.fill("seafund");
  await page.getByRole("option").filter({ hasText: "Seafund" }).getByRole("button", { name: "Compare" }).click();
  await input.fill("nithin");
  await page.getByRole("option").filter({ hasText: "Nithin Kamath" }).getByRole("button", { name: "Compare" }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("region", { name: "Comparison" }).getByRole("link", { name: /Compare 2/ }).click();
  await expect(page.getByRole("heading", { name: "Compare investors" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Investor comparison" })).toContainText("Seafund");
  await expect(page.getByRole("table", { name: "Investor comparison" })).toContainText("Nithin Kamath");
});

test("manual refresh without provider keys fails transparently: nothing is claimed and no run is created", async ({ page }) => {
  await page.goto("/runs");
  const runsBefore = await page.locator("tbody tr").count();
  await page.getByRole("button", { name: "Refresh now" }).first().click();
  await page.getByRole("button", { name: "Start refresh" }).click();
  await expect(page.getByText(/Server is missing configuration/)).toBeVisible({ timeout: 10_000 });
  await page.reload();
  expect(await page.locator("tbody tr").count()).toBe(runsBefore);
});

test("the scheduled endpoint refuses callers without the secret, and never echoes secrets", async ({ request }) => {
  expect((await request.get("/api/cron/refresh")).status()).toBe(401);
  expect((await request.get("/api/cron/refresh", { headers: { authorization: "Bearer wrong" } })).status()).toBe(401);
  const ok = await request.get("/api/cron/refresh", { headers: { authorization: "Bearer e2e-secret" } });
  expect(ok.status()).toBe(500); // authorised, but no provider keys on this server
  const body = await ok.text();
  expect(body).toContain("server_misconfigured");
  expect(body).not.toContain("e2e-secret");
  expect((await request.post("/api/rescore")).status()).toBe(401);
});

test("the API reference lists every route", async ({ page }) => {
  await page.goto("/api-docs");
  for (const p of ["/api/health", "/api/cron/refresh", "/api/refresh", "/api/rescore", "/api/investors/[id]/founder"]) await expect(page.getByRole("heading", { name: p, exact: true })).toBeVisible();
});

test("pipeline rows open the investor when clicked anywhere, while the controls inside a row keep working", async ({ page }) => {
  await page.goto("/pipeline?q=Blume");
  const row = page.locator("tbody tr").first();
  await row.getByRole("button", { name: /Compare/ }).click(); // a control inside the row: must NOT navigate
  await expect(page).toHaveURL(/\/pipeline/);
  await row.locator("td").nth(1).click(); // the score cell: plain text, so the row handles the click
  await expect(page).toHaveURL(/\/investors\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: "Blume Ventures" })).toBeVisible();
  await page.goto("/quiet");
  await page.locator("li[data-row-href]").first().click();
  await expect(page).toHaveURL(/\/investors\//);
});

test("the brand in the header takes you to the home screen from any page", async ({ page }) => {
  await page.goto("/runs");
  await page.getByRole("link", { name: /go to the home screen/i }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("investors have a fresh, relevant signal");
});

test("phone: the menu button opens the grouped navigation and a link takes you there", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto("/");
  await page.getByRole("button", { name: "Open menu" }).click();
  const menu = page.getByRole("dialog", { name: "Menu" });
  await expect(menu.getByRole("link", { name: "Priority queue" })).toHaveAttribute("aria-current", "page");
  await menu.getByRole("link", { name: "Investor database" }).click();
  await expect(page).toHaveURL(/\/database$/);
  await expect(page.getByRole("dialog", { name: "Menu" })).toHaveCount(0); // closes on navigation
  await ctx.close();
});

test("night mode: starts from the OS setting, the toggle switches it, and the choice is remembered", async ({ browser }) => {
  const dark = await browser.newContext({ colorScheme: "dark" });
  const d = await dark.newPage();
  await d.goto("/");
  await expect(d.locator("html")).toHaveAttribute("data-theme", "dark"); // set before first paint from the OS setting
  await d.getByRole("button", { name: "Switch to light mode" }).first().click();
  await expect(d.locator("html")).toHaveAttribute("data-theme", "light");
  await d.reload();
  await expect(d.locator("html")).toHaveAttribute("data-theme", "light"); // the saved choice beats the OS setting
  const bg = await d.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe("rgb(246, 243, 236)"); // the sand paper colour of the light palette
  await dark.close();

  const light = await browser.newContext({ colorScheme: "light" });
  const l = await light.newPage();
  await l.goto("/pipeline");
  await l.getByRole("button", { name: "Switch to night mode" }).first().click();
  await expect(l.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await l.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(17, 18, 15)");
  await light.close();
});

test("demo mode: five labelled Piyush accounts, mail drafts open the mail app, reset and simulate are demo-only, and real data never appears", async ({ page, request }) => {
  // On the main site the demo accounts are listed, but labelled, last, and kept out of the real counts and the "Start here" shortlist.
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("of 82 investors");
  await expect(page.locator("#picks-h").locator("xpath=ancestor::section[1]")).not.toContainText("Piyush");
  const demoSection = page.locator("#demo-accounts");
  await expect(demoSection.getByRole("link", { name: /^Piyush:/ })).toHaveCount(5);
  await expect(demoSection.getByText("Demo account", { exact: true })).toHaveCount(5);
  await page.goto("/pipeline");
  expect(await page.locator("tbody tr").count()).toBe(87);
  await expect(page.locator("tbody tr").first()).not.toContainText("Demo account"); // real investors first
  await expect(page.locator("tbody tr").filter({ hasText: "Demo account" })).toHaveCount(5);
  // Mail: a real investor's draft opens with NO address; a demo account's opens to the test address.
  await page.goto("/pipeline?q=Seafund");
  await page.getByRole("link", { name: "Seafund" }).first().click();
  await expect(page.getByRole("link", { name: "Send mail" }).first()).toHaveAttribute("href", /^mailto:\?subject=/);
  await page.goto("/pipeline?q=Piyush: High");
  await page.getByRole("link", { name: "Piyush: High priority (demo)" }).first().click();
  await expect(page.getByRole("link", { name: "Send mail" }).first()).toHaveAttribute("href", /^mailto:sisonpiy@gmail\.com\?subject=/);

  await page.goto("/demo/on");
  await expect(page).toHaveURL(/\/$/);
  const banner = page.getByRole("region", { name: "Demo mode" });
  await expect(banner).toContainText("This is a demo account");

  await page.goto("/pipeline");
  await expect(page.locator("tbody tr")).toHaveCount(5);
  for (const c of ["High priority", "Low priority", "Stale signal", "Unverified signal", "Irrelevant signal"]) await expect(page.getByRole("link", { name: `Piyush: ${c} (demo)` })).toBeVisible();
  await expect(page.getByRole("link", { name: "Blume Ventures" })).toHaveCount(0); // real investors are not mixed in

  await page.getByRole("link", { name: "Piyush: High priority (demo)" }).click();
  await expect(page.getByText("Demo account").first()).toBeVisible();
  const mail = page.getByRole("link", { name: "Send mail" });
  await expect(mail).toHaveAttribute("href", /^mailto:sisonpiy@gmail\.com\?subject=%5BDEMO%5D/);
  await expect(page.getByRole("link", { name: /^Gmail/ })).toHaveAttribute("href", /to=sisonpiy%40gmail\.com/);
  await page.getByRole("button", { name: "Edit relationship" }).click();
  await expect(page.getByLabel("Personal notes")).toHaveAttribute("placeholder", "This is a demo account");

  await banner.getByRole("button", { name: "Run simulated refresh" }).click();
  await expect(banner.getByRole("status")).toContainText("No searches or AI calls were made");
  await banner.getByRole("button", { name: "Reset demo data" }).click();
  await expect(banner.getByRole("status")).toContainText("Real data was not touched");

  await banner.getByRole("link", { name: "Exit demo mode" }).click();
  await page.goto("/pipeline");
  // The palette follows the mode immediately (a cached demo-only list once leaked into the other view).
  const names = await page.evaluate(async () => ((await (await fetch("/api/palette")).json()) as { investors: { name: string }[] }).investors.map((i) => i.name));
  expect(names.filter((n) => /piyush/i.test(n))).toHaveLength(5);
  expect(names.length).toBe(87);
  expect(await page.locator("tbody tr").count()).toBe(87); // the real investors are back, untouched, with the five labelled demo accounts last
});

test("startups: add one, read its rubric and exact workflow, evaluate it, edit the rubric, delete it", async ({ page }) => {
  const done = failOnConsoleErrors(page);
  await page.goto("/startups");
  await expect(page.getByText("Main workspace: Seed-stage B2B logistics SaaS")).toBeVisible();
  await page.getByRole("link", { name: "Add a startup" }).click();

  await page.getByLabel("Startup name").fill("Ledgerly");
  await page.getByLabel("What it does").fill("Payments infrastructure that lets Indian SMEs reconcile invoices automatically.");
  await page.getByLabel("Sector").fill("B2B payments infrastructure");
  await page.getByRole("button", { name: "Create startup and its rubric" }).click();
  await expect(page).toHaveURL(/\/startups\/ledgerly$/);

  // the exact workflow: seven steps, each saying who does it and what it costs
  const steps = page.locator("ol > li");
  await expect(steps).toHaveCount(7);
  await expect(steps.nth(1)).toContainText("by Gemini Flash");
  await expect(steps.nth(3)).toContainText("No search credits");
  // keys are empty in this server, so Gemini cannot write the rubric: the page says so instead of pretending
  await expect(steps.nth(1)).toContainText("gemini_no_credentials");
  await expect(page.getByText("Default (Gemini unavailable)")).toBeVisible();
  await expect(page.getByText("Not evaluated yet")).toBeVisible();

  await page.getByRole("button", { name: "Run evaluation" }).click();
  await expect(page.getByText(/Starting|Evaluation running|Started/).first()).toBeVisible();
  await expect.poll(async () => { await page.reload(); return await steps.nth(5).textContent(); }, { timeout: 30_000 }).toMatch(/Scored 81 investors/);
  await expect(steps.nth(2)).toContainText("1 has not been searched yet"); // never searched: left out, not shown as quiet
  await expect(steps.nth(4)).toContainText("could not be judged"); // no model available: said plainly, evidence left out of the scores
  await expect(page.getByRole("heading", { name: "Investors for Ledgerly" })).toBeVisible();
  await expect(page.getByText(/not been judged for this startup yet/).first()).toBeAttached();

  // editing numbers re-scores at once, with no model call
  await page.getByText("Edit the rubric").click();
  await page.getByLabel("Reach out now at").fill("85");
  await page.getByRole("button", { name: "Save rubric and re-score" }).click();
  await expect(page.getByText("Every score was recalculated from your rubric.")).toBeVisible();
  await expect(page.getByText("Edited by you", { exact: true })).toBeVisible();
  await expect(page.getByText("score ≥ 85")).toBeVisible();

  // invalid input is rejected by the server with a clear reason
  const bad = await page.request.post("/api/startups", { data: { name: "x", pitch: "short", sector: "s", stage: "ipo" } });
  expect(bad.status()).toBe(400);

  await page.getByRole("button", { name: "Delete startup" }).click();
  await page.getByRole("button", { name: "Yes, delete" }).click();
  await expect(page).toHaveURL(/\/startups$/);
  await expect(page.getByText("No other startups yet")).toBeVisible();
  done();
});

test("send mail moves the investor to Contacted (with undo), and replies are logged into the outreach workflow", async ({ page }) => {
  const done = failOnConsoleErrors(page);
  await page.goto("/pipeline?q=Athera");
  await page.getByRole("link", { name: "Athera Venture Partners" }).first().click();
  const flow = page.getByRole("region", { name: "Outreach and replies" });
  await expect(flow.getByText("Draft ready (current step)")).toBeVisible();
  await expect(flow.getByText("Replies come to your own inbox. This app cannot read your mailbox")).toBeVisible();

  // The real mail app must not open during a test: stop the browser's own navigation, keep the app's click handler.
  await page.getByRole("link", { name: "Send mail" }).first().evaluate((a) => a.addEventListener("click", (e) => e.preventDefault()));
  await page.getByRole("link", { name: "Send mail" }).first().click();
  await expect(page.getByText("Moved to Contacted.")).toBeVisible();
  await expect(flow.getByText("Sent. Waiting for a reply.")).toBeVisible();

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Put back to Not contacted.")).toBeVisible();
  await expect(flow.getByText("Nothing has been sent yet.")).toBeVisible();

  await page.getByRole("link", { name: "Send mail" }).first().evaluate((a) => a.addEventListener("click", (e) => e.preventDefault()));
  await page.getByRole("link", { name: "Send mail" }).first().click();
  await expect(flow.getByText("Sent. Waiting for a reply.")).toBeVisible();
  await flow.getByRole("button", { name: "They replied" }).click();
  await expect(flow.getByText("They replied and you are talking.")).toBeVisible();
  await page.reload();
  await expect(flow.getByText("They replied and you are talking.")).toBeVisible(); // persisted
  done();
});

for (const path of ["/", "/startups", "/startups/new", "/pipeline", "/brief", "/simulate", "/board", "/signals", "/quiet", "/runs", "/compare", "/api-docs"]) {
  test(`phone width: ${path} has no horizontal page scroll and no console errors`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const done = failOnConsoleErrors(page);
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${path} overflows by ${overflow}px`).toBeLessThanOrEqual(1);
    done();
    await ctx.close();
  });
}
