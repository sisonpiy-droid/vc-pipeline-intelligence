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

test("demo mode: six labelled Piyush accounts, mail drafts open the mail app, reset and simulate are demo-only, and real data never appears", async ({ page, request }) => {
  const live = await (await request.get("/api/palette")).json();
  expect(live.investors.some((i: { name: string }) => /piyush/i.test(i.name))).toBe(false);

  await page.goto("/demo/on");
  await expect(page).toHaveURL(/\/$/);
  const banner = page.getByRole("region", { name: "Demo mode" });
  await expect(banner).toContainText("This is a demo account");

  await page.goto("/pipeline");
  await expect(page.locator("tbody tr")).toHaveCount(6);
  for (const c of ["High priority", "Low priority", "Stale signal", "Unverified signal", "Duplicate signal", "Irrelevant signal"]) await expect(page.getByRole("link", { name: `Piyush: ${c} (demo)` })).toBeVisible();
  await expect(page.getByRole("link", { name: "Blume Ventures" })).toHaveCount(0); // real investors are not mixed in

  await page.getByRole("link", { name: "Piyush: High priority (demo)" }).click();
  await expect(page.getByText("Demo account").first()).toBeVisible();
  const mail = page.getByRole("link", { name: "Open in email app" });
  await expect(mail).toHaveAttribute("href", /^mailto:sisonpiy@gmail\.com\?subject=%5BDEMO%5D/);
  await expect(page.getByRole("link", { name: /Open in Gmail/ })).toHaveAttribute("href", /to=sisonpiy%40gmail\.com/);
  await page.getByRole("button", { name: "Edit relationship" }).click();
  await expect(page.getByLabel("Personal notes")).toHaveAttribute("placeholder", "This is a demo account");

  await banner.getByRole("button", { name: "Run simulated refresh" }).click();
  await expect(banner.getByRole("status")).toContainText("No searches or AI calls were made");
  await banner.getByRole("button", { name: "Reset demo data" }).click();
  await expect(banner.getByRole("status")).toContainText("Real data was not touched");

  await banner.getByRole("link", { name: "Exit demo mode" }).click();
  await page.goto("/pipeline");
  await expect(page.getByText(/Piyush/)).toHaveCount(0);
  // The palette list must follow the mode immediately (a cached demo list once leaked into the real view).
  const names = await page.evaluate(async () => ((await (await fetch("/api/palette")).json()) as { investors: { name: string }[] }).investors.map((i) => i.name));
  expect(names.some((n) => /piyush/i.test(n))).toBe(false);
  await expect(page.locator("tbody tr").first()).toBeVisible();
  expect(await page.locator("tbody tr").count()).toBeGreaterThan(20); // the real investors are back, untouched
});

for (const path of ["/", "/pipeline", "/brief", "/simulate", "/board", "/signals", "/quiet", "/runs", "/compare"]) {
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
