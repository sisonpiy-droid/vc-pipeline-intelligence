import { nameKey } from "@/lib/normalize";

export interface MatchTarget {
  firm_name: string;
  aliases: string[];
  partner_name?: string | null; // founder-supplied; only used for matching if present
}

/**
 * Does `text` mention this investor by a whole-word name, alias or known partner name?
 *
 * Deliberately strict: full-name phrase matching only. Shortened "stems" ("Accel" for "Accel India",
 * "Together" for "Together Fund") produce far more false matches than they recover, and a wrong
 * attribution is worse than a missed signal because it puts someone else's news on an investor's card.
 */
export function mentionsInvestor(text: string, target: MatchTarget): boolean {
  const hay = ` ${nameKey(text)} `;
  const names = [target.firm_name, ...target.aliases, ...(target.partner_name ? [target.partner_name] : [])];
  return names.map(nameKey).filter((k) => k.length >= 3).some((k) => hay.includes(` ${k} `));
}
