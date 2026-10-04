import { z } from "zod";

export function validLegalDate(value: string): boolean {
  if (!/^\d{4}(-\d{2}(-\d{2})?)?$/.test(value)) return false;
  const [year = 0, month = 1, day = 1] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export const LegalDate = z.string().refine(validLegalDate, "Invalid calendar date");
export const QueryDate = LegalDate.refine((v) => v.length === 10, "Use YYYY-MM-DD");

const ORDINAL: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, eighteenth: 18, "twenty-fourth": 24 };
const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Resolves a relative effective-date clause ("first day of the twelfth month next following the date of enactment",
 * "take effect immediately", "90 days after enactment") against a full enactment date. Returns null whenever the
 * clause is not one of these unambiguous forms; the caller must then keep the date unknown.
 */
export function deriveEffectiveDate(clause: string, enacted: string | null | undefined): string | null {
  if (!enacted || enacted.length !== 10 || !validLegalDate(enacted)) return null;
  const [y = 0, mo = 1, d = 1] = enacted.split("-").map(Number);
  const t = clause.toLowerCase().replace(/\s+/g, " ");
  const month = t.match(/first day of the ([a-z-]+|\d+)(?:st|nd|rd|th)? month (?:next )?(?:following|after) (?:the date of )?(?:its )?enactment/);
  if (month) {
    const n = ORDINAL[month[1] ?? ""] ?? Number.parseInt(month[1] ?? "", 10);
    return Number.isInteger(n) && n > 0 && n <= 60 ? iso(new Date(Date.UTC(y, mo - 1 + n, 1))) : null;
  }
  const days = t.match(/(\d{1,4})(?:st|nd|rd|th)? days? (?:next )?(?:after|following) (?:the date of )?(?:its )?enactment/);
  if (days) return iso(new Date(Date.UTC(y, mo - 1, d + Number(days[1]))));
  if (/(?:take|takes|shall take) effect immediately|effective immediately/.test(t)) return enacted;
  return null;
}
