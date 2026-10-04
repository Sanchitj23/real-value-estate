import { useSyncExternalStore } from "react";
import { DEFAULT_AS_OF } from "@/lib/engine/applicability";
import { QueryDate } from "@/lib/engine/dates";

let date = DEFAULT_AS_OF;
const listeners = new Set<() => void>();
const subscribe = (callback: () => void) => { listeners.add(callback); return () => { listeners.delete(callback); }; };
/** A single evaluation date across renter, manager, map and property views. */
export function useAsOf() {
  const value = useSyncExternalStore(subscribe, () => date, () => DEFAULT_AS_OF);
  return [value, (next: string) => {
    if (QueryDate.safeParse(next).success) { date = next; for (const callback of listeners) callback(); }
  }] as const;
}
