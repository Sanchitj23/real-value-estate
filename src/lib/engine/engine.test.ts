import { describe, expect, it } from "vitest";
import { cmpDate, effectiveDateOf, evaluateProperty, lifecycleOn, type PropertyLite, type RuleLite } from "./applicability";
import { evaluate } from "./expr";
import { deriveEffectiveDate, QueryDate, validLegalDate } from "./dates";
import { canonicalJson, diffLabel } from "./change";
import { chunkCount, chunkText, MODEL, pendingChunks, PIPELINE } from "./extraction";
import { anchorEvidence, PatchSchema, validateCandidate } from "./validation";
import { checkCase } from "./case-check";
import { firstOfRange, geocodeAttempts } from "./geocode";
import { findPreemptionSentence, suggestLinks, type CaseSpec, type LinkRule } from "./case-link";
import { matchProperties } from "./address-match";
import { dateDiff, lawChangeItems } from "./changes-view";
import { findQuote } from "./quote";
import { propertyInsights } from "./insights";
import type { RuleOutcome } from "./applicability";

const property: PropertyLite = {id:"p",address_id:"A1",street_address:"Synthetic Street",postal_city:"Unverified",state:"CA",zip:null,year_built:1990,units:4,use_code:null,use_description:"Residential apartments"};
const rule: RuleLite = {id:"r",rule_key:"synthetic",version:1,state:"CA",level:"state",city:null,jurisdiction:"CA",category:"rent_increase_limits",title:"Synthetic example",requirement:"Synthetic requirement",key_value:"5%",citation:"Synthetic section",source_url:null,legal_status:"enacted",effective_date:"2026-01-01",expiry_date:null,coverage:null,exemptions:null,coverage_status:"unconditional",exemptions_status:"none",review_state:"reviewed",quoted_span:"Synthetic quote only; not a real law.",confidence:null};
const outcome = (patch: Partial<RuleLite> = {}) => evaluateProperty(property,null,[{...rule,...patch}],[],"2026-10-01")[0]!;

describe("legal uncertainty and dates",()=>{
  it("requires affirmative evidence before reporting applies",()=>expect(outcome().result).toBe("applies"));
  it("missing coverage is unknown",()=>expect(outcome({coverage_status:"unknown",coverage_text:"Some buildings only"}).result).toBe("unknown"));
  it("missing exemptions are unknown",()=>expect(outcome({exemptions_status:"unknown",exemptions_text:"An owner exemption"}).result).toBe("unknown"));
  it("malformed expressions are unknown",()=>expect(outcome({coverage:{operator:"execute"}}).result).toBe("unknown"));
  it("codified law with no stated dates is treated as in force",()=>expect(lifecycleOn({...rule,effective_date:null},"2026-10-01")).toBe("in_force"));
  it("an enacted law with an enactment date but no effective date stays unknown",()=>expect(lifecycleOn({...rule,state:"NJ",effective_date:null,enacted_date:"2026-07-20"},"2026-10-01")).toBe("unknown"));
  it("a California statute with no stated date starts on 1 January after enactment",()=>{
    const ab={...rule,effective_date:null,enacted_date:"2025-10-06"};
    expect(effectiveDateOf(ab)).toEqual({date:"2026-01-01",derived:true,basis:"state_default"});
    expect(lifecycleOn(ab,"2025-12-31")).toBe("future");expect(lifecycleOn(ab,"2026-01-02")).toBe("in_force");
    expect(effectiveDateOf({...ab,level:"city"}).date).toBeNull();
  });
  it("an unresolved effective-date clause stays unknown",()=>expect(lifecycleOn({...rule,effective_date:null,effective_clause:"This act takes effect when the Secretary certifies readiness."},"2026-10-01")).toBe("unknown"));
  it("derives a relative effective date from the enactment date",()=>{
    const fair={...rule,effective_date:null,enacted_date:"2026-07-20",effective_clause:"9.    This act shall take effect on the first day of\nthe twelfth month next following the date of enactment."};
    expect(deriveEffectiveDate(fair.effective_clause,fair.enacted_date)).toBe("2027-07-01");
    expect(lifecycleOn(fair,"2026-10-01")).toBe("future");expect(lifecycleOn(fair,"2027-07-02")).toBe("in_force");
    expect(deriveEffectiveDate("This act shall take effect immediately.","2026-01-20")).toBe("2026-01-20");
    expect(deriveEffectiveDate("takes effect 90 days after enactment","2026-01-01")).toBe("2026-04-01");
    expect(deriveEffectiveDate("first day of the twelfth month next following the date of enactment","2026")).toBeNull();
  });
  it("partial dates within the same year are unknown",()=>expect(cmpDate("2026","2026-10-01")).toBeNull());
  it("partial dates in different years can be ordered",()=>expect(cmpDate("2025","2026-10-01")).toBe(-1));
  it("rejects invalid calendar dates",()=>{ expect(validLegalDate("2026-02-30")).toBe(false);expect(validLegalDate("2024-02-29")).toBe(true);expect(QueryDate.safeParse("2026").success).toBe(false); });
  it("ambiguous expiry stays unknown",()=>expect(lifecycleOn({...rule,expiry_date:"2026"},"2026-10-01")).toBe("unknown"));
  it("does not report a law before enactment",()=>expect(lifecycleOn({...rule,enacted_date:"2027-01-01"},"2026-10-01")).toBe("unknown"));
  it("failed and pending measures never become current law",()=>{expect(outcome({legal_status:"failed"}).result).toBeNull();expect(outcome({legal_status:"pending"}).result).toBe("pending");});
  it("postal city does not establish municipal jurisdiction",()=>expect(outcome({level:"city",city:"Unverified"}).result).toBe("unknown"));
  it("a building in the certificate cutoff year stays unknown",()=>expect(outcome({coverage_status:"conditional",coverage:{operator:"lte",fact:"property.certificate_of_occupancy_year",value:1990}}).result).toBe("unknown"));
  it("year built settles a certificate cutoff in any other year",()=>{
    expect(outcome({coverage_status:"conditional",coverage:{operator:"lte",fact:"property.certificate_of_occupancy_date",value:"1995-02-01"}}).result).toBe("applies");
    expect(outcome({coverage_status:"conditional",coverage:{operator:"lte",fact:"property.certificate_of_occupancy_date",value:"1978-10-01"}}).result).toBeNull();
  });
  it("silence in the source is stated as an assumption, unchecked wording stays unknown",()=>{
    const silent=outcome({coverage_status:"unknown",exemptions_status:"unknown"});
    expect(silent.result).toBe("applies");expect(silent.assumptions).toHaveLength(2);
    expect(outcome({coverage_status:"unknown",coverage_text:"Some buildings only",exemptions_status:"unknown"}).result).toBe("unknown");
  });
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

describe("scope evidence problems keep the provision with unknown scope",()=>{
  const text="Synthetic requirement: rental notices must be written. Effective January 1, 2026. Enacted law applies here.";
  const base={category:"application_screening_fees",title:"Synthetic",requirement:"Written notice",quoted_span:"Synthetic requirement: rental notices must be written.",key_value:null,legal_status:"enacted",enacted_date:null,effective_date:"2026-01-01",expiry_date:null,coverage_status:"conditional",exemptions_status:"unknown",coverage_expr_json:'{"operator":"gte","fact":"property.units","value":2}',exemptions_expr_json:null,
    supporting_quotes:[{field:"legal_status",quote:"Enacted law applies here."},{field:"effective_date",quote:"Effective January 1, 2026."}]};
  it("a coverage expression without its own quote stays valid but unknown",()=>{const c=validateCandidate(base,text);expect(c.valid).toBe(true);expect(c.coverage).toBeNull();expect(c.coverage_status).toBe("unknown");expect(c.warnings.length).toBeGreaterThan(0);});
  it("a fabricated coverage quote is a warning, not an invalid rule",()=>{const c=validateCandidate({...base,supporting_quotes:[...base.supporting_quotes,{field:"coverage",quote:"Invented coverage sentence here"}]},text);expect(c.valid).toBe(true);expect(c.coverage_status).toBe("unknown");});
  it("unconditional claim without a quote stays unknown",()=>{const c=validateCandidate({...base,coverage_expr_json:null,coverage_status:"unconditional"},text);expect(c.valid).toBe(true);expect(c.coverage_status).toBe("unknown");});
  it("a missing requirement quote still invalidates",()=>expect(validateCandidate({...base,quoted_span:"Not in the document at all, sorry."},text).valid).toBe(false));
});
describe("Census geocoder request plan",()=>{
  const sf={street_address:"3515 FILLMORE ST",state:"CA",zip:null,postal_city:"San Francisco"};
  it("never builds a request without ZIP or city (the geocoder answers HTTP 400)",()=>expect(geocodeAttempts({...sf,postal_city:null})).toEqual([]));
  it("uses the postal city only as a search hint when ZIP is missing",()=>{const a=geocodeAttempts(sf);expect(a).toHaveLength(1);expect(a[0]?.params).toEqual({street:"3515 FILLMORE ST",state:"CA",city:"San Francisco"});});
  it("retries without a ZIP that may belong to another state",()=>{const a=geocodeAttempts({street_address:"876-878 S 14TH ST",state:"NJ",zip:"11219",postal_city:"Newark"});expect(a[0]?.params["zip"]).toBe("11219");expect(a.some(x=>!x.params["zip"] && x.params["city"]==="Newark")).toBe(true);});
  it("falls back to the first number of a range last",()=>{const a=geocodeAttempts({street_address:"876-878 S 14TH ST",state:"NJ",zip:null,postal_city:"Newark"});expect(a.at(-1)?.params["street"]).toBe("876 S 14TH ST");expect(a[0]?.params["street"]).toBe("876-878 S 14TH ST");});
  it("parses ranges",()=>{expect(firstOfRange("322-322.5 Western Ave")).toBe("322 Western Ave");expect(firstOfRange("10050 MOUNTAIR AVE")).toBeNull();});
});

describe("linking challenge IDs to extracted rules",()=>{
  const r=(o:Partial<LinkRule>):LinkRule=>({rule_key:"k",title:"t",citation:"c",state:"CA",level:"state",city:null,category:"algorithmic_rent_setting",legal_status:"enacted",confidence:0.5,...o});
  const tests:CaseSpec[]=[
    {test_id:"T1",title:"California AB 325 / SB 763 takes effect",type:"as_of",rule_ids:["CA-ALG-01"]},
    {test_id:"T2",title:"Hoboken vs Jersey City local algorithmic bans",type:"boundary",rule_ids:["HOB-ALG-01","JC-ALG-01"]},
    {test_id:"T4",title:"Massachusetts pending bills S.2983 and H.5222",type:"pending",rule_ids:["MA-ALG-P1","MA-ALG-P2"]},
    {test_id:"T5",title:"Massachusetts rent-control ballot question struck",type:"negative",rule_ids:["MA-RENT-P1"]},
  ];
  const rules=[
    r({rule_key:"ca-a",citation:"AB 325, Cartwright Act",confidence:0.6}),r({rule_key:"ca-b",citation:"Business and Professions Code",confidence:0.9}),
    r({rule_key:"jc",state:"NJ",level:"city",city:"Jersey City"}),r({rule_key:"jc-rent",state:"NJ",level:"city",city:"Jersey City",category:"rent_increase_limits"}),
    r({rule_key:"ma-h",state:"MA",legal_status:"pending",citation:"Bill H.5222"}),r({rule_key:"ma-s",state:"MA",legal_status:"pending",citation:"Bill S.2983"}),
    r({rule_key:"ma-ban",state:"MA",category:"rent_increase_limits",legal_status:"enacted"}),
  ];
  const by=Object.fromEntries(suggestLinks(tests,rules).map(l=>[l.challenge_id,l]));
  it("prefers the rule naming the bill in the case title",()=>expect(by["CA-ALG-01"]?.rule_key).toBe("ca-a"));
  it("never links a city ID to another city or topic",()=>{expect(by["JC-ALG-01"]?.rule_key).toBe("jc");expect(by["HOB-ALG-01"]?.rule_key).toBeNull();});
  it("matches several bills to their IDs in order",()=>{expect(by["MA-ALG-P1"]?.rule_key).toBe("ma-s");expect(by["MA-ALG-P2"]?.rule_key).toBe("ma-h");});
  it("a struck measure is not linked to an enacted rule",()=>expect(by["MA-RENT-P1"]?.rule_key).toBeNull());
  it("finds a state law's limit on local ordinances",()=>{
    expect(findPreemptionSentence("6. a. This act is in addition to that act.\nb.    A municipality shall be prohibited from enacting\nan ordinance that conflicts with this act.  This subsection shall not apply.")).toContain("prohibited from enacting");
    expect(findPreemptionSentence("No city or town may enact rent control of any kind.")).toBeNull();
  });
});
describe("finding a sample address in a question",()=>{
  const props=[{address_id:"A0001",street_address:"6238 DE LONGPRE AVE",postal_city:"Los Angeles",state:"CA",zip:"90028"},{address_id:"A0002",street_address:"1031-1035 CLINTON ST",postal_city:"Hoboken",state:"NJ",zip:"07030"},{address_id:"A0009",street_address:"6238 MAIN ST",postal_city:"Newark",state:"NJ",zip:null}];
  it("matches number plus street name, ignoring case and suffix spelling",()=>expect(matchProperties("what applies at 6238 de longpre avenue?",props).map(p=>p.address_id)).toEqual(["A0001"]));
  it("matches a number inside a range and a sample ID",()=>{expect(matchProperties("1035 Clinton St Hoboken",props)[0]?.address_id).toBe("A0002");expect(matchProperties("tell me about a0009",props)[0]?.address_id).toBe("A0009");});
  it("a street name without a number matches nothing",()=>expect(matchProperties("rules on Clinton Street",props)).toEqual([]));
});
describe("law changes view",()=>{
  const p2:PropertyLite={...property,id:"q",address_id:"A2",state:"NJ"};
  const fair:RuleLite={...rule,id:"f",rule_key:"fair",state:"NJ",jurisdiction:"NJ",effective_date:null,enacted_date:"2026-07-20",effective_clause:"This act shall take effect on the first day of the twelfth month next following the date of enactment."};
  const inp={properties:[property,p2],resolutions:new Map(),rules:[rule,fair,{...rule,id:"b",rule_key:"bill",legal_status:"pending"}],relations:[]};
  it("groups upcoming, proposed and recent laws and counts addresses in their area",()=>{
    const items=lawChangeItems(inp,"2026-10-01");
    expect(items.map(i=>[i.rule_key,i.kind,i.in_area_ids.length])).toEqual([["fair","upcoming",1],["bill","proposed",1],["synthetic","recent",1]]);
    expect(items[0]?.effective_date).toBe("2027-07-01");expect(items[0]?.date_basis).toBe("clause");
  });
  it("reports what differs between two dates",()=>expect(dateDiff(inp,"2026-10-01","2027-07-02").map(d=>[d.rule_key,d.before,d.after,d.address_ids])).toEqual([["fair","not_yet_effective","applies",["A2"]]]));
});

describe("quote matching tolerates capture artefacts but not rewording",()=>{
  const text="No-fault evictions require the payment of\nrelocation assistance\n.\nIt is a violation of the \u201CNew Jersey Antitrust Act,\u201D P.L.1970 \u2014 as amended.";
  it("matches across a line break before the full stop and keeps the original substring",()=>{
    const m=findQuote(text,"No-fault evictions require the payment of relocation assistance.");
    expect(m?.kind).toBe("normalized");expect(text.slice(m!.start,m!.end)).toBe("No-fault evictions require the payment of\nrelocation assistance\n.");
  });
  it("treats straight and curly quotes, and plain and long dashes, as the same",()=>expect(findQuote(text,'violation of the "New Jersey Antitrust Act," P.L.1970 - as amended.')?.kind).toBe("normalized"));
  it("still rejects a changed word",()=>expect(findQuote(text,"No-fault evictions require the payment of relocation benefits.")).toBeNull());
  it("prefers the stricter match kinds",()=>{expect(findQuote(text,"It is a violation of the")?.kind).toBe("exact");expect(findQuote(text,"the payment of relocation assistance")?.kind).toBe("whitespace");});
});
describe("field-level evidence",()=>{
  const text="Bill H.1234\nStatus:\nChaptered\nSynthetic requirement: rental notices must be written and delivered. The fee may not exceed five dollars.";
  const base={category:"application_screening_fees",title:"Synthetic",requirement:"Written notice",quoted_span:"Synthetic requirement: rental notices must be written and delivered.",key_value:null,legal_status:"enacted",enacted_date:null,effective_date:null,expiry_date:null,coverage_status:"unknown",exemptions_status:"unknown",coverage_expr_json:null,exemptions_expr_json:null,supporting_quotes:[{field:"legal_status",quote:"Chaptered"}]};
  it("accepts a short status line as evidence for the status",()=>{const c=validateCandidate(base,text);expect(c.valid).toBe(true);expect(c.legal_status).toBe("enacted");});
  it("still needs a real passage for the requirement itself",()=>expect(validateCandidate({...base,quoted_span:"Chaptered"},text).valid).toBe(false));
  it("leaves out a headline value that has no quote, keeping the rule",()=>{const c=validateCandidate({...base,key_value:"$5"},text);expect(c.valid).toBe(true);expect(c.key_value).toBeNull();expect(c.warnings.join(" ")).toContain("key_value");});
  it("keeps a headline value that is quoted",()=>expect(validateCandidate({...base,key_value:"$5",supporting_quotes:[...base.supporting_quotes,{field:"key_value",quote:"may not exceed five dollars"}]},text).key_value).toBe("$5"));
});

describe("actionable insights for one address",()=>{
  const o=(p:Partial<RuleOutcome>&{requirement?:string;starts?:string|null}):RuleOutcome=>({rule_id:"r",rule_key:"k",category:"rent_increase_limits",title:"Synthetic cap",jurisdiction:"CA",level:"state",citation:"c",key_value:"5%",review_state:"validated_auto",lifecycle:"in_force",geo:"true",applicability:"true",result:"applies",explanation:"",missing:[],conflict_flag:false,conflict_note:null,assumptions:[],trace:[],...p});
  const built=propertyInsights({addressId:"A1",legalCity:null,outcomes:[
    o({}),o({rule_id:"r2",title:"Second cap",key_value:null}),
    o({rule_id:"u1",category:"just_cause_eviction",result:"unknown",missing:["property.units"]}),o({rule_id:"u2",category:"just_cause_eviction",result:"unknown",missing:["property.units","manual_review:Check the lease"]}),
    o({rule_id:"f",category:"algorithmic_rent_setting",result:"not_yet_effective",title:"Future ban",starts:"2027-07-01"}),
  ]});
  it("leads with what applies, one line per topic, with the headline figure",()=>{expect(built.insights[0]?.title).toBe("Rent increase limits: 5%");expect(built.insights[0]?.detail).toContain("Plus 1 more rule");});
  it("says what starts later and when",()=>expect(built.insights.some(i=>i.title==="Starts 2027-07-01: Future ban")).toBe(true));
  it("ranks the fact that settles the most rules first",()=>{const checks=built.insights.filter(i=>i.title.startsWith("Check:"));expect(checks[0]?.title).toContain("How many residential units");expect(checks[0]?.detail).toContain("decides 2 rules");});
  it("flags an unconfirmed legal city and topics with nothing found",()=>{expect(built.insights.some(i=>/legal city isn't confirmed/.test(i.title))).toBe(true);expect(built.insights.at(-1)?.title).toContain("Security deposits");});
  it("summarises the counts in the headline",()=>expect(built.headline).toBe("2 rules apply · 2 rules may apply · 1 rule starts later"));
});
