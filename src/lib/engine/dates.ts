import { z } from "zod";

export function validLegalDate(value: string): boolean {
  if (!/^\d{4}(-\d{2}(-\d{2})?)?$/.test(value)) return false;
  const [year = 0, month = 1, day = 1] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export const LegalDate = z.string().refine(validLegalDate, "Invalid calendar date");
export const QueryDate = LegalDate.refine((v) => v.length === 10, "Use YYYY-MM-DD");
