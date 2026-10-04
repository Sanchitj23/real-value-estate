-- Apply in Lovable Cloud before publishing the accompanying application changes.
-- Existing rules with unspecified scope remain unknown until re-extracted/reviewed.
alter table public.rule_versions add column coverage_status text not null default 'unknown'
  check (coverage_status in ('unknown','conditional','unconditional'));
alter table public.rule_versions add column exemptions_status text not null default 'unknown'
  check (exemptions_status in ('unknown','conditional','none'));
alter table public.scenarios add column base_rule_id uuid references public.rule_versions(id);

-- Admin RLS already exists; table privileges were missing for role management.
grant insert, update, delete on public.user_roles to authenticated;

-- Source/property records in completed packages must not change underneath rules.
create function public.guard_dataset_records() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op <> 'INSERT' and exists (select 1 from public.dataset_versions where id = old.dataset_id and status = 'active') then
    raise exception 'Active dataset records are immutable; import a new package version';
  end if;
  if tg_op <> 'DELETE' and not exists (select 1 from public.dataset_versions where id = new.dataset_id and status = 'staging') then
    raise exception 'Dataset must be staging';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger immutable_source before insert or update or delete on public.source_documents
  for each row execute function public.guard_dataset_records();
create trigger immutable_property before insert or update or delete on public.properties
  for each row execute function public.guard_dataset_records();

-- Transactions replace the previous multi-request deactivate/insert sequence.
-- Definer routines explicitly authorize staff; direct history edits are revoked.
-- Evidence offsets use JavaScript UTF-16 indices, including non-BMP characters.
create function public.utf16_slice(t text, s int, e int) returns text
language plpgsql immutable strict set search_path = public as $$
declare i int; pos int := 0; c text; out_text text := '';
begin
  for i in 1..length(t) loop
    c := substring(t from i for 1);
    if pos >= e then exit; end if;
    if pos >= s then out_text := out_text || c; end if;
    pos := pos + case when ascii(c) > 65535 then 2 else 1 end;
  end loop;
  return out_text;
end $$;
create function public.publish_rule_version(p_rule jsonb, p_evidence jsonb, p_expected uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare r public.rule_versions; previous public.rule_versions; e jsonb; source_text text; new_id uuid;
begin
  if not public.is_staff(auth.uid()) then raise exception 'Staff permission required'; end if;
  r := jsonb_populate_record(null::public.rule_versions, p_rule);
  perform pg_advisory_xact_lock(hashtextextended(r.rule_key || ':' || r.source_id::text, 0));
  select * into previous from public.rule_versions where rule_key = r.rule_key and source_id = r.source_id and is_current order by version desc limit 1 for update;
  if p_expected is not null and previous.id is distinct from p_expected then raise exception 'Rule was revised by another reviewer; reload'; end if;
  select text into source_text from public.source_documents where id = r.source_id;
  if source_text is null then raise exception 'Source text required'; end if;
  if jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence required'; end if;
  for e in select value from jsonb_array_elements(p_evidence) loop
    if (e->>'valid')::boolean and (
      (e->>'start_offset')::int < 0 or (e->>'end_offset')::int <= (e->>'start_offset')::int or
      public.utf16_slice(source_text,(e->>'start_offset')::int,(e->>'end_offset')::int) is distinct from e->>'quote'
    ) then raise exception 'Evidence offsets do not match source'; end if;
  end loop;
  if r.review_state <> 'invalid' and not exists (select 1 from jsonb_array_elements(p_evidence) x where x->>'field' = 'quoted_span' and (x->>'valid')::boolean and length(x->>'quote') >= 20) then raise exception 'Valid requirement quote required'; end if;
  if r.review_state <> 'invalid' then
    for e in select value from jsonb_array_elements(jsonb_build_array(
      case when r.legal_status <> 'unknown' then 'legal_status' end,
      case when r.effective_date is not null then 'effective_date' end,
      case when r.enacted_date is not null then 'enacted_date' end,
      case when r.expiry_date is not null then 'expiry_date' end,
      case when r.key_value is not null then 'key_value' end,
      case when r.coverage_status <> 'unknown' or r.coverage is not null then 'coverage' end,
      case when r.exemptions_status <> 'unknown' or r.exemptions is not null then 'exemptions' end
    )) loop
      if e <> 'null'::jsonb and not exists (select 1 from jsonb_array_elements(p_evidence) x where x->>'field' = e#>>'{}' and (x->>'valid')::boolean) then
        raise exception 'Field evidence required for %', e;
      end if;
    end loop;
  end if;
  r.id := gen_random_uuid();
  select coalesce(max(version),0)+1 into r.version from public.rule_versions where rule_key=r.rule_key and source_id=r.source_id;
  r.supersedes := previous.id;
  r.is_current := r.review_state <> 'invalid'; r.created_by := auth.uid(); r.created_at := now();
  r.validation_errors := coalesce(r.validation_errors,'[]'::jsonb);
  r.coverage_status := coalesce(r.coverage_status,'unknown'); r.exemptions_status := coalesce(r.exemptions_status,'unknown');
  if r.is_current or p_expected is not null then update public.rule_versions set is_current = false where source_id = r.source_id and rule_key = r.rule_key and is_current; end if;
  insert into public.rule_versions select r.* returning id into new_id;
  insert into public.rule_evidence(rule_version_id,field,quote,start_offset,end_offset,match_kind,valid)
    select new_id,x.field,x.quote,x.start_offset,x.end_offset,x.match_kind,x.valid
    from jsonb_to_recordset(p_evidence) x(field text,quote text,start_offset int,end_offset int,match_kind text,valid boolean);
  insert into public.audit_log(actor,action,entity,entity_id,detail)
    values(auth.uid(),'rule.publish','rule_versions',new_id::text,jsonb_build_object('supersedes',previous.id,'reason',r.change_reason));
  return new_id;
end $$;
revoke all on function public.publish_rule_version(jsonb,jsonb,uuid) from public, anon;
grant execute on function public.publish_rule_version(jsonb,jsonb,uuid) to authenticated;
revoke insert, update, delete on public.rule_versions, public.rule_evidence from authenticated;

create function public.activate_dataset(p_dataset uuid, p_receipt jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(auth.uid(),'admin') then raise exception 'Admin permission required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('housing-active-dataset',0));
  if not exists (select 1 from public.dataset_versions where id=p_dataset and status='staging') then raise exception 'Dataset must be staging'; end if;
  if (select count(*) from public.properties where dataset_id=p_dataset) <> 500 or
     (select count(*) from public.source_documents where dataset_id=p_dataset) <> 87 or
     (select count(*) from public.source_documents where dataset_id=p_dataset and text_available) <> 54 then raise exception 'Expected 500 properties, 87 sources and 54 texts'; end if;
  update public.dataset_versions set status='archived' where status='active';
  update public.dataset_versions set status='active',receipt=p_receipt where id=p_dataset;
  insert into public.audit_log(actor,action,entity,entity_id,detail) values(auth.uid(),'import.activate','dataset_versions',p_dataset::text,p_receipt);
end $$;
revoke all on function public.activate_dataset(uuid,jsonb) from public, anon;
grant execute on function public.activate_dataset(uuid,jsonb) to authenticated;

create function public.publish_resolution(p_row jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare r public.jurisdiction_resolutions;
begin
  if not public.is_staff(auth.uid()) then raise exception 'Staff permission required'; end if;
  r := jsonb_populate_record(null::public.jurisdiction_resolutions,p_row);
  perform pg_advisory_xact_lock(hashtextextended(r.property_id::text,0));
  r.id:=gen_random_uuid(); r.created_at:=now(); r.created_by:=auth.uid(); r.is_current:=true;
  r.provider:=coalesce(r.provider,'US Census Geocoder'); r.warnings:=coalesce(r.warnings,'[]'::jsonb); r.evidence:=coalesce(r.evidence,'{}'::jsonb);
  update public.jurisdiction_resolutions set is_current=false where property_id=r.property_id and is_current;
  insert into public.jurisdiction_resolutions select r.*;
end $$;
revoke all on function public.publish_resolution(jsonb) from public, anon;
grant execute on function public.publish_resolution(jsonb) to authenticated;
revoke insert, update, delete on public.jurisdiction_resolutions from authenticated;

-- Prevent clients reopening completed datasets to bypass the immutable-record guard.
revoke update, delete on public.dataset_versions from authenticated;
revoke delete on public.properties, public.source_documents from authenticated;

-- A running lease prevents two browser sessions paying to extract the same chunk.
create unique index extraction_chunk_running on public.extraction_runs(source_id,model,pipeline_version,chunk_index)
  where status='running' and pipeline_version='extract-v2-evidence';

-- Raw model output is operational data, not a public legal record.
drop policy "Public sample read" on public.extraction_runs;
create policy "Staff read extraction" on public.extraction_runs for select to authenticated using(public.is_staff(auth.uid()));

-- Scenarios are visible to their author and the project administrator only.
drop policy "Public sample read" on public.scenarios;
create policy "Owner read scenarios" on public.scenarios for select to authenticated
  using(created_by=auth.uid() or public.has_role(auth.uid(),'admin'));
drop policy "Staff insert" on public.scenarios;
create policy "Owner insert scenarios" on public.scenarios for insert to authenticated
  with check(public.is_staff(auth.uid()) and created_by=auth.uid());
revoke update, delete on public.scenarios from authenticated;
