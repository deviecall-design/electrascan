-- ElectraScan Phase 1 Schema
-- Run in Supabase dashboard SQL editor (or via supabase db push)
-- All tables use Row Level Security (RLS) — update policies for your auth model.

-- ─────────────────────────────────────────────
-- PROJECTS
-- ─────────────────────────────────────────────
create table if not exists projects (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  address      text not null default '',
  client       text not null default '',
  builder      text not null default '',
  status       text not null default 'active'
                 check (status in ('active', 'pending', 'complete')),
  color        text not null default '#1D6EFD',
  description  text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Denormalised counts updated by triggers
alter table projects
  add column if not exists version_count  int not null default 0,
  add column if not exists last_estimate  numeric not null default 0;

-- Auto-update updated_at
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists projects_updated_at on projects;
create trigger projects_updated_at
  before update on projects
  for each row execute function update_updated_at();

-- ─────────────────────────────────────────────
-- DRAWING VERSIONS
-- ─────────────────────────────────────────────
create table if not exists drawing_versions (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references projects(id) on delete cascade,
  tag             text not null,          -- V001, V002
  label           text not null,          -- "Version 001"
  source          text not null default 'Direct upload',
  page_count      int  not null default 1,
  scale_detected  text not null default 'unknown',
  legend_found    boolean not null default false,
  component_count int  not null default 0,
  estimate_id     text,                   -- populated after estimate created
  status          text not null default 'active'
                    check (status in ('active', 'superseded')),
  created_at      timestamptz not null default now()
);

create index if not exists drawing_versions_project_id_idx on drawing_versions(project_id);

-- Increment version_count on project when a version is inserted
create or replace function increment_project_version_count()
returns trigger language plpgsql as $$
begin
  update projects set version_count = version_count + 1 where id = new.project_id;
  return new;
end;
$$;

drop trigger if exists drawing_versions_after_insert on drawing_versions;
create trigger drawing_versions_after_insert
  after insert on drawing_versions
  for each row execute function increment_project_version_count();

-- ─────────────────────────────────────────────
-- ESTIMATES
-- ─────────────────────────────────────────────
create table if not exists estimates (
  id            text primary key,         -- EST-2026-001-001
  project_id    uuid not null references projects(id) on delete cascade,
  version_id    uuid not null references drawing_versions(id),
  margin_pct    numeric not null default 0 check (margin_pct >= 0 and margin_pct <= 100),
  status        text not null default 'draft'
                  check (status in ('draft','locked','submitted','approved','rejected','superseded')),
  locked_at     timestamptz,
  subtotal      numeric not null default 0,
  margin_amount numeric not null default 0,
  gst           numeric not null default 0,
  total         numeric not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists estimates_project_id_idx on estimates(project_id);
create index if not exists estimates_version_id_idx on estimates(version_id);

drop trigger if exists estimates_updated_at on estimates;
create trigger estimates_updated_at
  before update on estimates
  for each row execute function update_updated_at();

-- Update project.last_estimate when estimate total changes
create or replace function sync_project_last_estimate()
returns trigger language plpgsql as $$
begin
  update projects set last_estimate = new.total where id = new.project_id;
  return new;
end;
$$;

drop trigger if exists estimates_sync_project on estimates;
create trigger estimates_sync_project
  after insert or update of total on estimates
  for each row execute function sync_project_last_estimate();

-- ─────────────────────────────────────────────
-- ESTIMATE LINE ITEMS
-- ─────────────────────────────────────────────
create table if not exists estimate_line_items (
  id              uuid primary key default gen_random_uuid(),
  estimate_id     text not null references estimates(id) on delete cascade,
  description     text not null,
  unit            text not null default 'EA'
                    check (unit in ('EA','LM','LS','HR')),
  qty             numeric not null default 1 check (qty >= 0),
  rate            numeric not null default 0 check (rate >= 0),
  line_total      numeric generated always as (qty * rate) stored,
  component_type  text,
  room            text,
  confidence      int check (confidence >= 0 and confidence <= 100),
  flags           text[] not null default '{}',
  voice_note      text,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now()
);

create index if not exists estimate_line_items_estimate_id_idx on estimate_line_items(estimate_id);

-- ─────────────────────────────────────────────
-- AUDIT LOG (schema ready for Phase 3)
-- ─────────────────────────────────────────────
create table if not exists audit_log (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid references projects(id),
  estimate_id text references estimates(id),
  actor       text not null,
  action      text not null,
  label       text not null default '',
  note        text not null default '',
  doc         text,
  signature   text,
  hash        text,            -- SHA-256 of previous entry + this entry content
  created_at  timestamptz not null default now()
);

create index if not exists audit_log_project_id_idx on audit_log(project_id);

-- ─────────────────────────────────────────────
-- ROW LEVEL SECURITY (enable — update policies when auth is added)
-- ─────────────────────────────────────────────
alter table projects           enable row level security;
alter table drawing_versions   enable row level security;
alter table estimates          enable row level security;
alter table estimate_line_items enable row level security;
alter table audit_log          enable row level security;

-- Temporary open policies (replace with user-scoped policies when auth is added)
create policy "allow_all_projects"            on projects            for all using (true) with check (true);
create policy "allow_all_drawing_versions"    on drawing_versions    for all using (true) with check (true);
create policy "allow_all_estimates"           on estimates           for all using (true) with check (true);
create policy "allow_all_estimate_line_items" on estimate_line_items for all using (true) with check (true);
create policy "allow_all_audit_log"           on audit_log           for all using (true) with check (true);
