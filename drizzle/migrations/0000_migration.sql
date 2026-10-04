
create type public.app_role as enum ('admin', 'reviewer', 'user');

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.user_roles where user_id = _user_id and role = _role) $$;

create or replace function public.is_staff(_user_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.user_roles where user_id = _user_id and role in ('admin','reviewer')) $$;

create policy "Users read own roles" on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.has_role(auth.uid(),'admin'));
create policy "Admins manage roles" on public.user_roles for all to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

-- First account becomes admin (bootstrap); everyone else is a plain user.
create or replace function public.handle_new_user_role()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.user_roles where role = 'admin') then
    insert into public.user_roles(user_id, role) values (new.id, 'admin');
  else
    insert into public.user_roles(user_id, role) values (new.id, 'user');
  end if;
  return new;
end $$;
create trigger on_auth_user_created_role after insert on auth.users
  for each row execute function public.handle_new_user_role();

create table public.dataset_versions (
  id uuid primary key default gen_random_uuid(),
  upload_sha256 text not null unique,
  format_version text not null,
  package_name text,
  default_as_of date not null default '2026-10-01',
  counts jsonb not null default '{}',
  package_metadata jsonb not null default '{}',
  known_gaps jsonb not null default '[]',
  change_tests jsonb not null default '[]',
  rule_record_schema jsonb,
  status text not null default 'staging',
  receipt jsonb not null default '{}',
  created_by uuid,
  created_at timestamptz not null default now()
);

create table public.source_documents (
  id uuid primary key default gen_random_uuid(),
  dataset_id uuid not null references public.dataset_versions(id) on delete cascade,
  doc_id text not null,
  jurisdictions text,
  url text,
  source_type text,
  capture text,
  retrieved_at text,
  manifest_sha256 text,
  local_sha256 text,
  hash_matches boolean,
  text_available boolean not null default false,
  text text,
  manifest_row jsonb not null default '{}',
  link_only_row jsonb,
  imported_at timestamptz not null default now(),
  unique (dataset_id, doc_id)
);
create index on public.source_documents(dataset_id);

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  dataset_id uuid not null references public.dataset_versions(id) on delete cascade,
  address_id text not null,
  street_address text not null,
  postal_city text,
  state text not null,
  zip text,
  year_built int,
  units int,
  use_code text,
  use_description text,
  source_dataset text,
  retrieved_at text,
  raw_row jsonb not null default '{}',
  unique (dataset_id, address_id)
);
create index on public.properties(dataset_id, state);

create table public.jurisdiction_resolutions (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  status text not null,
  lat double precision,
  lon double precision,
  matched_address text,
  state_name text,
  county_name text,
  place_name text,
  place_geoid text,
  place_kind text,
  provider text not null default 'US Census Geocoder',
  benchmark text,
  vintage text,
  warnings jsonb not null default '[]',
  evidence jsonb not null default '{}',
  is_current boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index on public.jurisdiction_resolutions(property_id, is_current);

create table public.extraction_runs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.source_documents(id) on delete cascade,
  model text not null,
  pipeline_version text not null,
  chunk_index int not null default 0,
  chunk_count int not null default 1,
  status text not null default 'running',
  candidates int not null default 0,
  valid int not null default 0,
  invalid int not null default 0,
  error text,
  raw_output jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index on public.extraction_runs(source_id);

create table public.rule_versions (
  id uuid primary key default gen_random_uuid(),
  rule_key text not null,
  version int not null default 1,
  supersedes uuid references public.rule_versions(id),
  is_current boolean not null default true,
  run_id uuid references public.extraction_runs(id) on delete set null,
  source_id uuid not null references public.source_documents(id) on delete cascade,
  state text not null,
  level text not null,
  city text,
  jurisdiction text not null,
  category text not null,
  title text not null,
  requirement text not null,
  key_value text,
  citation text not null,
  source_url text,
  legal_status text not null default 'unknown',
  enacted_date text,
  effective_date text,
  expiry_date text,
  coverage jsonb,
  exemptions jsonb,
  coverage_text text,
  exemptions_text text,
  interaction_text text,
  quoted_span text not null,
  confidence numeric,
  review_state text not null default 'validated_auto',
  validation_errors jsonb not null default '[]',
  change_reason text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index on public.rule_versions(rule_key, is_current);
create index on public.rule_versions(state, is_current);

create table public.rule_evidence (
  id uuid primary key default gen_random_uuid(),
  rule_version_id uuid not null references public.rule_versions(id) on delete cascade,
  field text not null,
  quote text not null,
  start_offset int,
  end_offset int,
  match_kind text not null,
  valid boolean not null
);
create index on public.rule_evidence(rule_version_id);

create table public.rule_relations (
  id uuid primary key default gen_random_uuid(),
  from_rule_key text not null,
  to_rule_key text not null,
  relation_type text not null,
  category text,
  note text,
  evidence_quote text,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table public.semantic_mappings (
  challenge_rule_id text primary key,
  rule_key text,
  note text,
  mapped_by uuid,
  mapped_at timestamptz not null default now()
);

create table public.scenarios (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  rule_key text not null,
  patch jsonb not null default '{}',
  as_of date not null default '2026-10-01',
  created_by uuid,
  created_at timestamptz not null default now()
);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor uuid,
  action text not null,
  entity text not null,
  entity_id text,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['dataset_versions','source_documents','properties','jurisdiction_resolutions','extraction_runs','rule_versions','rule_evidence','rule_relations','semantic_mappings','scenarios']
  loop
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "Public sample read" on public.%I for select to anon, authenticated using (true)', t);
    execute format('create policy "Staff insert" on public.%I for insert to authenticated with check (public.is_staff(auth.uid()))', t);
    execute format('create policy "Staff update" on public.%I for update to authenticated using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()))', t);
    execute format('create policy "Admin delete" on public.%I for delete to authenticated using (public.has_role(auth.uid(),''admin''))', t);
  end loop;
end $$;

grant select, insert on public.audit_log to authenticated;
grant all on public.audit_log to service_role;
alter table public.audit_log enable row level security;
create policy "Staff read audit" on public.audit_log for select to authenticated using (public.is_staff(auth.uid()));
create policy "Staff write audit" on public.audit_log for insert to authenticated with check (public.is_staff(auth.uid()) and actor = auth.uid());
