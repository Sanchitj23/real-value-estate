create or replace function public.activate_dataset(p_dataset uuid, p_receipt jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(auth.uid(),'admin') then raise exception 'Admin permission required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('housing-active-dataset',0));
  if not exists (select 1 from public.dataset_versions where id=p_dataset and status='staging') then raise exception 'Dataset must be staging'; end if;
  if (select count(*) from public.properties where dataset_id=p_dataset) <> 500 or
     (select count(*) from public.source_documents where dataset_id=p_dataset) <> 87 or
     (select count(*) from public.source_documents where dataset_id=p_dataset and text_available) < 54 then raise exception 'Expected 500 properties, 87 sources and at least the 54 baseline texts'; end if;
  update public.dataset_versions set status='archived' where status='active';
  update public.dataset_versions set status='active',receipt=p_receipt where id=p_dataset;
  insert into public.audit_log(actor,action,entity,entity_id,detail) values(auth.uid(),'import.activate','dataset_versions',p_dataset::text,p_receipt);
end $$;