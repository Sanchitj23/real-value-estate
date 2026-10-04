import { describe, expect, it } from "vitest";
import { cmpDate, evaluateProperty, lifecycleOn, type PropertyLite, type RuleLite } from "./applicability";
import { evaluate } from "./expr";
import { QueryDate, validLegalDate } from "./dates";
import { canonicalJson, diffLabel } from "./change";
import { chunkCount, chunkText, MODEL, pendingChunks, PIPELINE } from "./extraction";
import { anchorEvidence, PatchSchema, validateCandidate } from "./validation";
import { checkCase } from "./case-check";

const property: PropertyLite = {id:"p",address_id:"A1",street_address:"Synthetic Street",postal_city:"Unverified",state:"CA",zip:null,year_built:1990,units:4,use_code:null,use_description:"Residential apartments"};
const rule: RuleLite = {id:"r",rule_key:"synthetic",version:1,state:"CA",level:"state",city:null,jurisdiction:"CA",category:"rent_increase_limits",title:"Synthetic example",requirement:"Synthetic requirement",key_value:"5%",citation:"Synthetic section",source_url:null,legal_status:"enacted",effective_date:"2026-01-01",expiry_date:null,coverage:null,exemptions:null,coverage_status:"unconditional",exemptions_status:"none",review_state:"reviewed",quoted_span:"Synthetic quote only; not a real law.",confidence:null};
const outcome = (patch: Partial<RuleLite> = {}) => evaluateProperty(property,null,[{...rule,...patch}],[],"2026-10-01")[0]!;

describe("legal uncertainty and dates",()=>{
  it("requires affirmative evidence before reporting applies",()=>expect(outcome().result).toBe("applies"));
  it("missing coverage is unknown",()=>expect(outcome({coverage_status:"unknown",coverage_text:"Some buildings only"}).result).toBe("unknown"));
  it("missing exemptions are unknown",()=>expect(outcome({exemptions_status:"unknown",exemptions_text:"An owner exemption"}).result).toBe("unknown"));
  it("malformed expressions are unknown",()=>expect(outcome({coverage:{operator:"execute"}}).result).toBe("unknown"));
  it("missing effective date is unknown",()=>expect(lifecycleOn({...rule,effective_date:null},"2026-10-01")).toBe("unknown"));
  it("partial dates within the same year are unknown",()=>expect(cmpDate("2026","2026-10-01")).toBeNull());
  it("partial dates in different years can be ordered",()=>expect(cmpDate("2025","2026-10-01")).toBe(-1));
  it("rejects invalid calendar dates",()=>{ expect(validLegalDate("2026-02-30")).toBe(false);expect(validLegalDate("2024-02-29")).toBe(true);expect(QueryDate.safeParse("2026").success).toBe(false); });
  it("ambiguous expiry stays unknown",()=>expect(lifecycleOn({...rule,expiry_date:"2026"},"2026-10-01")).toBe("unknown"));
  it("does not report a law before enactment",()=>expect(lifecycleOn({...rule,enacted_date:"2027-01-01"},"2026-10-01")).toBe("unknown"));
  it("failed and pending measures never become current law",()=>{expect(outcome({legal_status:"failed"}).result).toBeNull();expect(outcome({legal_status:"pending"}).result).toBe("pending");});
  it("postal city does not establish municipal jurisdiction",()=>expect(outcome({level:"city",city:"Unverified"}).result).toBe("unknown"));
  it("construction year cannot substitute for a certificate",()=>expect(outcome({coverage:{operator:"gte",fact:"property.certificate_of_occupancy_year",value:1980}}).result).toBe("unknown"));
  it("uncertain supersession propagates to state result",()=>{
    const local={...rule,id:"local",rule_key:"local",level:"city",city:"Unverified"};
    const outs=evaluateProperty(property,null,[rule,local],[{from_rule_key:"local",to_rule_key:rule.rule_key,relation_type:"replaces",note:"Synthetic"}],"2026-10-01");
    expect(outs[0]?.result).toBe("unknown"); expect(outs[0]?.conflict_flag).toBe(true);
  });
  it("failed laws do not create current conflicts",()=>{
    const outs=evaluateProperty(property,null,[rule,{...rule,id:"failed",rule_key:"failed",legal_status:"failed"}],[{from_rule_key:"failed",to_rule_key:rule.rule_key,relation_type:"possible-preemption",note:null}],"2026-10-01");expect(outs[0]?.conflict_flag).toBe(false);
  });
});
describe("typed conditions and material changes",()=>{
  it("mismatched fact types remain unknown",()=>expect(evaluate({operator:"gte",fact:"property.units",value:2},{"property.units":"4"}).result).toBe("unknown"));
  it("mixed membership types remain unknown",()=>expect(evaluate({operator:"in",fact:"property.units",value:[2,"4"]},{"property.units":4}).result).toBe("unknown"));
  it("compares actual occupancy dates",()=>expect(evaluate({operator:"gte",fact:"property.certificate_of_occupancy_date",value:"1995-02-01"},{"property.certificate_of_occupancy_date":"1995-01-01"}).result).toBe(false));
  it("invalid date facts stay unknown",()=>expect(evaluate({operator:"gte",fact:"property.certificate_of_occupancy_date",value:"1995-02-01"},{"property.certificate_of_occupancy_date":"1995-02-30"}).result).toBe("unknown"));
  it("changed formula matters even when both rules apply",()=>expect(diffLabel("applies","applies",rule,{...rule,key_value:"3%"})).toBe("changed"));
  it("changed requirement matters",()=>expect(diffLabel("applies","applies",rule,{...rule,requirement:"A different obligation"})).toBe("changed"));
  it("unaffected properties do not change just because content changes",()=>expect(diffLabel(null,null,rule,{...rule,key_value:"3%"})).toBe("no_change"));
  it("unchanged content stays unchanged",()=>expect(diffLabel("applies","applies",rule,{...rule})).toBe("no_change"));
  it("canonical snapshot hashes survive JSONB key reordering",()=>expect(canonicalJson({z:1,a:{c:2,b:3}})).toBe(canonicalJson({a:{b:3,c:2},z:1})));
  it("scenario expressions are validated",()=>expect(PatchSchema.safeParse({coverage:{operator:"execute"}}).success).toBe(false));
});
describe("resumable extraction and evidence",()=>{
  const done={chunk_index:0,chunk_count:5,status:"done",pipeline_version:PIPELINE,model:MODEL};
  it("large documents need all chunks",()=>{expect(chunkCount(55982)).toBe(2);expect(chunkCount(161137)).toBe(5);expect(pendingChunks(161137,[done])).toEqual([1,2,3,4]);});
  it("does not reuse a previous pipeline",()=>expect(pendingChunks(161137,[{...done,pipeline_version:"extract-v1"}])).toEqual([0,1,2,3,4]));
  it("failed chunks are retried",()=>expect(pendingChunks(1000,[{...done,chunk_count:1,status:"error"}])).toEqual([0]));
  it("a newer failed attempt cannot be hidden by an older completed chunk",()=>expect(pendingChunks(1000,[{...done,chunk_count:1,created_at:"2026-10-01"},{...done,chunk_count:1,status:"error",created_at:"2026-10-02"}])).toEqual([0]));
  it("rejects an out-of-range chunk",()=>expect(()=>chunkText("sample",2)).toThrow());
  const text="Synthetic requirement: rental notices must be written. Effective January 1, 2026. Applies to all rentals. No exemptions are provided. Enacted law applies here. Maximum fee five dollars.";
  const candidate={category:"application_screening_fees",title:"Synthetic",requirement:"Written notice",quoted_span:"Synthetic requirement: rental notices must be written.",key_value:null,legal_status:"enacted",enacted_date:null,effective_date:"2026-01-01",expiry_date:null,coverage_status:"unconditional",exemptions_status:"none",coverage_expr_json:null,exemptions_expr_json:null,supporting_quotes:[{field:"legal_status",quote:"Enacted law applies here."},{field:"effective_date",quote:"Effective January 1, 2026."},{field:"coverage",quote:"Applies to all rentals."},{field:"exemptions",quote:"No exemptions are provided."}]};
  it("accepts source-anchored fields",()=>expect(validateCandidate(candidate,text).valid).toBe(true));
  it("unsupported dates invalidate a candidate",()=>expect(validateCandidate({...candidate,supporting_quotes:[]},text).valid).toBe(false));
  it("invalid calendar dates invalidate a candidate",()=>expect(validateCandidate({...candidate,effective_date:"2026-02-30"},text).valid).toBe(false));
  it("fabricated supporting quotes invalidate a candidate",()=>expect(validateCandidate({...candidate,supporting_quotes:[...candidate.supporting_quotes,{field:"key_value",quote:"Invented fee amount here"}]},text).valid).toBe(false));
  it("unclaimed missing scope remains unknown",()=>{const c=validateCandidate({...candidate,legal_status:"unknown",effective_date:null,coverage_status:"unknown",exemptions_status:"unknown",supporting_quotes:[]},text);expect(c.valid).toBe(true);expect(c.coverage_status).toBe("unknown");});
  it("matches whitespace but preserves the original quote",()=>expect(anchorEvidence("A   sufficiently long quote.",[{field:"quoted_span",quote:"A sufficiently long quote."}])[0]?.quote).toBe("A   sufficiently long quote."));
});

describe("supplied change-case specification checks",()=>{
  const row={address_id:"A1",state:"CA",before:"not_yet_effective",after:"applies",conflict_after:false,legal_city:null,geo_status:null,place_kind:null};
  it("checks a temporal transition",()=>expect(checkCase({test_id:"T1",type:"as_of",states:["CA"]},rule,[row]).status).toBe("passed"));
  it("does not pass unknown applicability",()=>expect(checkCase({test_id:"T1",type:"as_of",states:["CA"]},rule,[{...row,after:"unknown"}]).status).toBe("unresolved"));
  it("does not pass the wrong temporal result",()=>expect(checkCase({test_id:"T1",type:"as_of",states:["CA"]},rule,[{...row,before:"applies"}]).status).toBe("failed"));
  it("does not infer legal city from a postal label",()=>expect(checkCase({test_id:"T2",type:"boundary"},{...rule,level:"city",city:"Synthetic City"},[{...row,before:null,after:"unknown"}]).status).toBe("unresolved"));
  it("requires negative-case law status as well as empty results",()=>expect(checkCase({test_id:"T5",type:"negative"},rule,[{...row,before:null,after:null}]).status).toBe("failed"));
});
