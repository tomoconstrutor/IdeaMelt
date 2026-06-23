create extension if not exists pgcrypto;
create extension if not exists citext;
create extension if not exists pg_trgm;

do $$
begin
  create type public.issue_status as enum ('draft', 'approved', 'published', 'archived');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.sync_status as enum ('pending', 'synced', 'failed', 'skipped');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.subscribers (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  source_form text not null default 'unknown',
  utm jsonb not null default '{}'::jsonb,
  referring_site text,
  consent_at timestamptz not null default now(),
  beehiiv_subscription_id text,
  beehiiv_sync_status public.sync_status not null default 'pending',
  beehiiv_sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.subscribe_attempts (
  id uuid primary key default gen_random_uuid(),
  ip_hash text not null,
  email citext,
  source_form text,
  success boolean not null default false,
  reason text,
  created_at timestamptz not null default now()
);

create table if not exists public.issues (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null unique,
  status public.issue_status not null default 'draft',
  summary text,
  issue_number integer unique,
  displayed_date date,
  published_at timestamptz,
  beehiiv_post_id text,
  beehiiv_post_url text,
  beehiiv_sync_status public.sync_status not null default 'pending',
  beehiiv_sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint issues_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create table if not exists public.ideas (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.issues(id) on delete cascade,
  title text not null,
  slug text not null,
  thesis text,
  why_now text,
  target_customer text,
  market text,
  type text,
  opportunity_score smallint check (opportunity_score between 0 and 10),
  problem_score smallint check (problem_score between 0 and 10),
  feasibility_score smallint check (feasibility_score between 0 and 10),
  why_now_score smallint check (why_now_score between 0 and 10),
  revenue_potential text,
  execution_difficulty text,
  go_to_market_notes text,
  sort_order integer not null default 0,
  search_vector tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(thesis, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(why_now, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(target_customer, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(market, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(type, '')), 'C')
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (issue_id, slug),
  constraint ideas_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create table if not exists public.signals (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid references public.issues(id) on delete cascade,
  idea_id uuid references public.ideas(id) on delete cascade,
  signal_type text not null,
  source_title text not null,
  source_url text,
  excerpt text,
  source_date date,
  metadata jsonb not null default '{}'::jsonb,
  confidence_score smallint check (confidence_score between 0 and 10),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint signals_have_parent check (issue_id is not null or idea_id is not null)
);

create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  name citext not null unique,
  slug text not null unique,
  created_at timestamptz not null default now(),
  constraint tags_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create table if not exists public.idea_tags (
  idea_id uuid not null references public.ideas(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  primary key (idea_id, tag_id)
);

create index if not exists subscribe_attempts_ip_hash_created_idx
  on public.subscribe_attempts (ip_hash, created_at desc);

create index if not exists issues_status_published_idx
  on public.issues (status, published_at desc);

create index if not exists ideas_issue_id_sort_idx
  on public.ideas (issue_id, sort_order);

create index if not exists ideas_search_vector_idx
  on public.ideas using gin (search_vector);

create index if not exists ideas_title_trgm_idx
  on public.ideas using gin (title gin_trgm_ops);

create index if not exists signals_issue_id_idx
  on public.signals (issue_id);

create index if not exists signals_idea_id_idx
  on public.signals (idea_id);

create index if not exists tags_slug_idx
  on public.tags (slug);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists subscribers_set_updated_at on public.subscribers;
create trigger subscribers_set_updated_at
  before update on public.subscribers
  for each row execute function public.set_updated_at();

drop trigger if exists issues_set_updated_at on public.issues;
create trigger issues_set_updated_at
  before update on public.issues
  for each row execute function public.set_updated_at();

drop trigger if exists ideas_set_updated_at on public.ideas;
create trigger ideas_set_updated_at
  before update on public.ideas
  for each row execute function public.set_updated_at();

drop trigger if exists signals_set_updated_at on public.signals;
create trigger signals_set_updated_at
  before update on public.signals
  for each row execute function public.set_updated_at();

alter table public.subscribers enable row level security;
alter table public.subscribe_attempts enable row level security;
alter table public.issues enable row level security;
alter table public.ideas enable row level security;
alter table public.signals enable row level security;
alter table public.tags enable row level security;
alter table public.idea_tags enable row level security;

do $$
begin
  create policy "Published issues are readable"
    on public.issues for select
    using (status = 'published');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create policy "Published ideas are readable"
    on public.ideas for select
    using (
      exists (
        select 1
        from public.issues
        where issues.id = ideas.issue_id
          and issues.status = 'published'
      )
    );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create policy "Published signals are readable"
    on public.signals for select
    using (
      exists (
        select 1
        from public.issues
        where issues.id = signals.issue_id
          and issues.status = 'published'
      )
      or exists (
        select 1
        from public.ideas
        join public.issues on issues.id = ideas.issue_id
        where ideas.id = signals.idea_id
          and issues.status = 'published'
      )
    );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create policy "Tags are readable"
    on public.tags for select
    using (true);
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create policy "Published idea tags are readable"
    on public.idea_tags for select
    using (
      exists (
        select 1
        from public.ideas
        join public.issues on issues.id = ideas.issue_id
        where ideas.id = idea_tags.idea_id
          and issues.status = 'published'
      )
    );
exception
  when duplicate_object then null;
end $$;

create or replace function public.search_public_archive(
  search_query text default null,
  tag_slugs text[] default null,
  min_opportunity_score integer default null,
  result_limit integer default 25
)
returns table (
  idea_id uuid,
  idea_title text,
  idea_slug text,
  thesis text,
  why_now text,
  target_customer text,
  market text,
  idea_type text,
  opportunity_score integer,
  problem_score integer,
  feasibility_score integer,
  why_now_score integer,
  revenue_potential text,
  execution_difficulty text,
  go_to_market_notes text,
  issue_id uuid,
  issue_title text,
  issue_slug text,
  issue_summary text,
  published_at timestamptz,
  displayed_date date,
  tags jsonb,
  signals jsonb,
  rank real
)
language sql
stable
security definer
set search_path = public
as $$
  with input as (
    select
      nullif(trim(coalesce(search_query, '')), '') as q,
      greatest(1, least(coalesce(result_limit, 25), 100)) as capped_limit
  ),
  matched as (
    select
      i.id as idea_id,
      i.title as idea_title,
      i.slug as idea_slug,
      i.thesis,
      i.why_now,
      i.target_customer,
      i.market,
      i.type as idea_type,
      i.opportunity_score::integer,
      i.problem_score::integer,
      i.feasibility_score::integer,
      i.why_now_score::integer,
      i.revenue_potential,
      i.execution_difficulty,
      i.go_to_market_notes,
      i.sort_order,
      iss.id as issue_id,
      iss.title as issue_title,
      iss.slug as issue_slug,
      iss.summary as issue_summary,
      iss.published_at,
      iss.displayed_date,
      case
        when input.q is null then 0::real
        else ts_rank(i.search_vector, websearch_to_tsquery('english', input.q))
      end as rank
    from public.ideas i
    join public.issues iss on iss.id = i.issue_id
    cross join input
    where iss.status = 'published'
      and (min_opportunity_score is null or i.opportunity_score >= min_opportunity_score)
      and (
        input.q is null
        or i.search_vector @@ websearch_to_tsquery('english', input.q)
        or i.title ilike '%' || input.q || '%'
        or i.thesis ilike '%' || input.q || '%'
        or i.why_now ilike '%' || input.q || '%'
      )
      and (
        tag_slugs is null
        or cardinality(tag_slugs) = 0
        or exists (
          select 1
          from public.idea_tags it
          join public.tags t on t.id = it.tag_id
          where it.idea_id = i.id
            and t.slug = any(tag_slugs)
        )
      )
  )
  select
    m.idea_id,
    m.idea_title,
    m.idea_slug,
    m.thesis,
    m.why_now,
    m.target_customer,
    m.market,
    m.idea_type,
    m.opportunity_score,
    m.problem_score,
    m.feasibility_score,
    m.why_now_score,
    m.revenue_potential,
    m.execution_difficulty,
    m.go_to_market_notes,
    m.issue_id,
    m.issue_title,
    m.issue_slug,
    m.issue_summary,
    m.published_at,
    m.displayed_date,
    coalesce((
      select jsonb_agg(
        jsonb_build_object('slug', t.slug, 'name', t.name)
        order by t.name::text
      )
      from public.idea_tags it
      join public.tags t on t.id = it.tag_id
      where it.idea_id = m.idea_id
    ), '[]'::jsonb) as tags,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'type', s.signal_type,
          'title', s.source_title,
          'url', s.source_url,
          'excerpt', s.excerpt,
          'sourceDate', s.source_date,
          'confidenceScore', s.confidence_score,
          'metadata', s.metadata
        )
        order by s.created_at asc
      )
      from public.signals s
      where s.idea_id = m.idea_id
        or (s.issue_id = m.issue_id and s.idea_id is null)
    ), '[]'::jsonb) as signals,
    m.rank
  from matched m
  order by m.rank desc, m.published_at desc nulls last, m.sort_order asc, m.idea_title asc
  limit (select capped_limit from input);
$$;

grant usage on schema public to anon, authenticated;
grant select on public.issues, public.ideas, public.signals, public.tags, public.idea_tags to anon, authenticated;
grant execute on function public.search_public_archive(text, text[], integer, integer) to anon, authenticated;
