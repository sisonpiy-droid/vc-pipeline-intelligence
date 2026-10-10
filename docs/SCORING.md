# Follow-up score

`src/lib/scoring/score.ts` — pure, deterministic, no model in the arithmetic.

## Formula (0–100)

```
score = recency (≤30) + relevance (≤30) + evidence (≤20) + fit (≤15) + relationship (≤5)
```

Only the **lead signal** (best relevance × recency among relevant, in-window, de-duplicated, verified signals) feeds the first three.

| Component | Points | Definition |
|---|---|---|
| Recency | 30 × `recencyFactor(age)` × gate | factor = 1.0 for ≤3 days, then linear to 0.2 at day 30 |
| Relevance | 30 × relevance/100 | Gemini's 0–100 judgement of fit to "B2B logistics / supply-chain SaaS" |
| Evidence | 20 × confidence × gate | high 1.0 · medium 0.65 · low 0.3, **+0.15** if a second distinct relevant event exists (cap 1) |
| Fit | 15 × (0.4·sector + 0.4·stage + 0.2·geography) | sector: logistics terms 1.0, B2B/SaaS 0.6, other 0.2, unknown 0.2 · stage: seed/angel/accelerator 1.0, "early" 0.8, Series A/growth 0.4, unknown 0.3 · geography: India 1.0, other 0.4, unknown 0.5 |
| Relationship | 5 × factor | not contacted 0.5 · contacted 0.8 · in conversation / awaiting 1.0 · passed / committed 0 |

`gate = clamp(relevance / 70, 0, 1)` — recency and evidence only count **as far as the signal is relevant**.

## Rules that matter more than the weights

1. A signal is *relevant* only at relevance ≥ **40**. Below that it is stored and shown under "all verified", but it earns nothing:
   a fresh, well-sourced, off-topic article cannot create a high score. (Test: relevance 15, high confidence, today ⇒ score ≤ 20.)
2. **No relevant signal ⇒ recency = relevance = evidence = 0**, so the score cannot exceed fit + relationship (≤ 20).
   Missing data cannot inflate a score; unknown profile fields score *lower* than known-good ones.
3. A **failed** retrieval never produces a score of 0 — the investor keeps its previous values (see ARCHITECTURE §2).
4. The four concepts stay separate in the breakdown: signal **relevance**, investor **fit**, relationship **readiness**,
   evidence **confidence**.

## Actions

| Condition (first match) | Action |
|---|---|
| relationship `passed` / `committed` | no action now |
| `awaiting_response` and last contact ≤ 14 days (or undated) | wait for response |
| relevant signal and score ≥ **75** | **reach out now** |
| relevant signal and 55 ≤ score < 75 | prepare targeted outreach |
| relevant signal and score < 55 | research further |
| no relevant signal, coverage partial | research further ("absence is not conclusive") |
| no relevant signal, strong profile fit (≥ 0.7) | research further |
| otherwise | no action now |

Every result carries a plain-language explanation plus the per-component numbers, shown on the dashboard ("Why this score").

## Why these weights and thresholds

The brief proposes 30/30/20/15/5 as *starting values*, not requirements. I kept them because they encode the product's
question — "who is worth contacting **now**, and is it **relevant to me**" — as 60% timing × topic, 20% evidence quality,
and only 20% for static profile and relationship data (which the founder already knows).

The two changes I made are structural rather than numeric: the relevance **gate** on recency/evidence and the
**relevance floor of 40**. Without them the literal weights would score a *recent, high-confidence, off-topic article
(relevance 15)* at **72** for a good-fit investor — as high as a genuinely relevant signal. With them it scores **18**.
(Both numbers computed from `scoreInvestor`; `tests/scoring.test.ts` asserts the real one stays ≤ 20 — fit + relationship only.)

The action thresholds (75 / 55) were chosen from this grid — score for a perfect-fit investor (sector, stage, geography
all 1.0), not yet contacted, **high-confidence** evidence — so the choice is inspectable:

| age (days) \ relevance | 45 | 55 | 65 | 70 | 80 | 90 |
|---|---|---|---|---|---|---|
| 0–3 | 63 | 73 | **83** | **89** | **92** | **95** |
| 7 | 61 | 70 | **80** | **85** | **88** | **91** |
| 14 | 57 | 66 | 74 | **79** | **82** | **85** |
| 21 | 53 | 61 | 69 | 73 | **76** | **79** |
| 28 | 49 | 56 | 63 | 66 | 69 | 72 |

Bold = "reach out now" (≥ 75). A merely *adjacent* signal (relevance ~55) never qualifies even when fresh — it lands in
"prepare targeted outreach" — while relevance 65 qualifies for about a week, 70 for about two weeks, and 80+ for about three. With
medium-confidence evidence every cell drops ~4–7 points, so a weakly-sourced signal needs to be fresher or more relevant. A lower-fit investor loses up to ~10 points more. The first version used 70 / 50 and was
raised after this grid showed relevance-55 signals triggering "reach out now". All thresholds are constants in
`scoring/score.ts` and are exercised by tests; recalibrate against real outcomes once there are any.

## Worked example (from the tests)

Fresh (2 days), relevance 90, high confidence, seed-stage logistics investor in India, not yet contacted:
recency 30 + relevance 27 + evidence 20 + fit 15 + relationship 2.5 = **94.5 → 95 · reach out now**.
Same investor, relevance 15: recency 0 + relevance 0 + evidence 0 + fit 15 + relationship 2.5 = **18 · no signal credit**.
