import { normCity, type RuleLite } from "./applicability";

type CaseRow = {state:string;address_id:string;before:string|null;after:string|null;conflict_after:boolean;
  legal_city:string|null;geo_status:string|null;place_kind:string|null};
type CaseSpec = {test_id:string;type:string;states?:string[];conflict_with?:string[]};
/** Checks the supplied T1–T5 invariants. These are not official judge scores. */
export function checkCase(spec:CaseSpec, rule:RuleLite, rows:CaseRow[], conflictCities:string[] = []) {
  const failures:string[] = [], unresolved:string[] = [];
  const uncertain=(r:CaseRow)=>r.before==="unknown" || r.after==="unknown";
  for(const row of rows) {
    const selected=spec.states?.includes(row.state) ?? row.state===rule.state;
    if(spec.type==="negative") {
      if(row.before || row.after || rule.legal_status!=="failed") failures.push(row.address_id);
    } else if(spec.type==="boundary") {
      if(row.state!==rule.state) {if(row.after) failures.push(row.address_id); continue;}
      if(row.geo_status!=="resolved") {unresolved.push(row.address_id);continue;}
      const expected=row.place_kind==="incorporated" && normCity(row.legal_city)===normCity(rule.city)?"applies":null;
      if(row.after!==expected) (uncertain(row)?unresolved:failures).push(row.address_id);
    } else if(selected) {
      const before=spec.type==="pending"?"pending":"not_yet_effective";
      if(row.before!==before || row.after!=="applies") (uncertain(row)?unresolved:failures).push(row.address_id);
      if(spec.conflict_with?.length) {
        if(row.geo_status!=="resolved") unresolved.push(row.address_id);
        else if(conflictCities.some(c=>normCity(c)===normCity(row.legal_city)) && !row.conflict_after) failures.push(row.address_id);
      }
    } else if(row.before || row.after) failures.push(row.address_id);
  }
  return {status:failures.length?"failed" as const:unresolved.length?"unresolved" as const:"passed" as const,
    failed_address_ids:Array.from(new Set(failures)),unresolved_address_ids:Array.from(new Set(unresolved)),
    note:"Checks against the provided case specification, using resolved legal jurisdiction; not an official answer-key score."};
}
