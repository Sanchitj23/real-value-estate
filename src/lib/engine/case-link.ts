import { normCity } from "./applicability";

/** Challenge IDs encode the jurisdiction they refer to; a link must match it independently of the linked rule. */
export function expectedIdentity(cid: string): { state: string; city: string | null } | null {
  const p = cid.split("-")[0];
  const m: Record<string, { state: string; city: string | null }> = { CA: { state: "CA", city: null }, NJ: { state: "NJ", city: null }, MA: { state: "MA", city: null }, HOB: { state: "NJ", city: "Hoboken" }, JC: { state: "NJ", city: "Jersey City" } };
  return (p && m[p]) || null;
}

const TOPIC: Record<string, string> = { ALG: "algorithmic_rent_setting", RENT: "rent_increase_limits" };

export type LinkRule = { rule_key: string; title: string; citation: string; state: string; level: string; city: string | null; category: string; legal_status: string; confidence: number | null; source_url?: string | null };
export type CaseSpec = { test_id: string; title?: string; type: string; rule_ids: string[] };
export type LinkSuggestion = { challenge_id: string; test_id: string; rule_key: string | null; candidates: number; reason: string };

/**
 * Suggests which extracted rule each challenge ID refers to, from what the ID and the case text themselves say:
 * jurisdiction (ID prefix), topic (ID middle), expected legal status (case type) and any bill number in the case
 * title. Nothing here encodes an expected answer; a reviewer can change any link.
 */
export function suggestLinks(tests: CaseSpec[], rules: LinkRule[]): LinkSuggestion[] {
  const out: LinkSuggestion[] = [];
  for (const t of tests) {
    const bills = Array.from((t.title ?? "").matchAll(/\b(?:[SH]\.? ?|AB ?|SB ?|IP ?)(\d{1,2}-\d{1,3}|\d{2,5})\b/g)).map((m) => m[1]!);
    const wantStatus = t.type === "negative" ? "failed" : t.type === "pending" ? "pending" : "enacted";
    t.rule_ids.forEach((cid, i) => {
      const who = expectedIdentity(cid), topic = TOPIC[cid.split("-")[1] ?? ""];
      if (!who || !topic) { out.push({ challenge_id: cid, test_id: t.test_id, rule_key: null, candidates: 0, reason: "This ID's jurisdiction or topic isn't recognised; link it by hand." }); return; }
      let c = rules.filter((r) => r.state === who.state && r.category === topic && r.legal_status === wantStatus && (who.city ? r.level === "city" && normCity(r.city) === normCity(who.city) : r.level === "state"));
      const total = c.length;
      const where = who.city ?? `${who.state} statewide`;
      if (!total) { out.push({ challenge_id: cid, test_id: t.test_id, rule_key: null, candidates: 0, reason: `No ${wantStatus} ${topic.replace(/_/g, " ")} rule for ${where} has been read from the sources.` }); return; }
      const bill = bills[Math.min(i, bills.length - 1)];
      let how = "";
      if (bill && c.length > 1) {
        const digits = bill.replace(/\D/g, "");
        const named = c.filter((r) => `${r.citation} ${r.title} ${r.source_url ?? ""}`.replace(/[^0-9A-Za-z]/g, "").includes(digits));
        if (named.length) { c = named; how = ` naming ${bill}`; }
      }
      c = [...c].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0) || a.rule_key.localeCompare(b.rule_key));
      out.push({ challenge_id: cid, test_id: t.test_id, rule_key: c[0]!.rule_key, candidates: total, reason: total === 1 ? `Only ${wantStatus} ${topic.replace(/_/g, " ")} rule for ${where}.` : `${total} matching rules for ${where}; picked the most confident one${how}. Check it.` });
    });
  }
  return out;
}

/** A sentence in a state law limiting conflicting local ordinances, or null. Used only to raise a review flag. */
export function findPreemptionSentence(text: string): string | null {
  const m = text.match(/[^.;]*\b(?:municipalit(?:y|ies)|local (?:government|ordinance)s?|political subdivisions?)\b[^.;]*\b(?:prohibited from enacting|preempt\w*|supersed\w*|conflicts? with)\b[^.;]*[.;]/i);
  const s = m?.[0]?.trim() ?? null;
  return s && s.length >= 20 && s.length <= 600 ? s : null;
}
