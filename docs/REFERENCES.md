# Reference products and repositories — what was actually reviewed

**Depth of review, stated plainly:** for the repositories I read the GitHub metadata (licence, language, last push) and the
**README only** — I did **not** audit their source code, run them, or copy anything from them. For the websites I did
**not** open or evaluate them in this build. No code from any reference is in this repository.

## Repositories (metadata + README, Oct 2026)

| Repo | Licence | What it is (from its README) | Idea taken (not code) |
|---|---|---|---|
| lalalune/outreachr | Apache-2.0 | local-first, founder-owned fundraising CRM, 192 bundled investor targets, source URLs + observation dates + confidence per datum | **founder-owned data stays founder-owned**; show evidence provenance and confidence next to every score |
| HlinorAI/funding-intelligence | Apache-2.0 | deterministic, evidence-gated routing engine; "unknown is not evidence", "a transport failure is not CLOSED", a failed gate can't become NOW through a high raw score | the **failed ≠ quiet** state model; decision trace kept with each recommendation; keep fit / readiness / status independent |
| AkashDeepSinghJassal/first-signal | none stated | evidence-first VC OS: claim-level citations, contradictions stay visible, **abstains with "insufficient evidence"** rather than inventing facts, Tavily-based public search | abstention as a first-class outcome; contradictory dates are surfaced as a rejection reason, not resolved by guessing |
| schneidavie/fundmomentum | none stated | MCP server over a curated VC-fund dataset, "live investor signals" | confirms the market framing; the dataset is a paid/keyed product and not needed here |
| adelaidasofia/investor-relations-mcp | MIT | FastMCP raise pipeline tracker syncing from an Obsidian CRM | pipeline-stage / follow-up-compliance vocabulary |
| suraj-shrivastav/PitchDekh | none stated | LLM + crawling + search investor matching | confirms the search→LLM matching pattern; no licence so no reuse |
| kunthive-Labs/Arthaive | **AGPL-3.0** | India startup funding tracker | **deliberately not consulted beyond metadata**: AGPL is incompatible with keeping this project's licence open for reuse |
| bjolo-de/investor-intelligence | — | **404 Not Found** (repository missing or private) | inaccessible; no information |

## Websites

pitchroom.net, capscope.vc, fundsignal.in, roundkey.co, getcapsignal.com, startt.ai — **not reviewed**. The product design
here follows the assignment brief directly; none of these are dependencies.

## Decisions these informed

1. **Evidence-first**: a signal row always carries source URL, event date, retrieval time, verbatim excerpt, confidence.
2. **Absence is a state, not a default**: five distinct "no signal" states (see `deriveState`).
3. **Deterministic prioritisation** with a visible breakdown.
4. **No dependency was added because it appeared in the list**; none of them is used at runtime.
