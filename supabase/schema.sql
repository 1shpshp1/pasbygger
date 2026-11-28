-- Træningsparat (formerly Pasbygger): the database (Supabase / PostgreSQL), version 2.
-- Paste the whole file into Supabase → SQL Editor → Run. It can be run again: it only adds what is missing and
-- replaces the functions.
--
-- What is where
--   clubs, teams          a club has teams (a team = one group of players and their coaches)
--   club_admins           who runs a club (may make teams and add coaches)
--   team_members          who coaches a team, and as what: admin (holdleder), coach (træner), assistant (hjælpetræner)
--   players               a team's players: name, level band (lo–hi), favourite positions, active
--   player_levels         every change of a player's level, with when and by whom (so 25-50-25 history is not lost)
--   saved_groups          the groups of one training (key = the date, or the date + " fri"), as [[names]]
--   saved_signups         who signed up for one training, as [names]
--   saved_matches         the matches of one training, as [[[team A], [team B] (, [team C])]]
--   fixture_sets          the Kampe tab: sets of real matches (e.g. a weekend)
--   trainings             a team's training plan: one row per training, with its parts (opstart, stations, afslutning)
--   drill_sources         where drills come from (DBU, later an own library, …); only active sources are shown
--   drills                the drill library: the whole drill as the app shows it, its Danish texts, and (later)
--                         drawings and animations; a shared drill (owner_club empty) or a club's own
--   library_settings      the library's column order, tag renames and tag groups (one row)
--   app_admins            who looks after the shared library (you)
--   usage_counts          the app's statistics: counts per day, nothing about who
--
-- The app reads and writes through the functions at the end (get_group_data, save_groups, …), which give back
-- exactly what the Google Sheet server (apps-script/Grupper.gs) gives, so the app works the same on both.
--
-- Who may see what is decided here, in the database (row-level security), not in the app: a coach only ever gets the
-- rows of the teams they are a member of. Assistants see the players but not their levels (get_group_data leaves
-- them out) and may only save signups.

create extension if not exists pgcrypto;   -- gen_random_uuid() on older PostgreSQL

-- ---------------------------------------------------------------- tables

create table if not exists clubs (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(name) between 1 and 100),
  created_at timestamptz not null default now()
);

create table if not exists teams (
  id         uuid primary key default gen_random_uuid(),
  club_id    uuid not null references clubs on delete cascade,
  name       text not null check (length(name) between 1 and 100),
  settings   jsonb not null default '{}',            -- later: age group, 3/5/8/11-a-side, level scale
  created_at timestamptz not null default now()
);

create table if not exists club_admins (
  club_id uuid not null references clubs on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  primary key (club_id, user_id)
);

do $$ begin
  create type team_role as enum ('admin', 'coach', 'assistant');
exception when duplicate_object then null; end $$;

create table if not exists team_members (
  team_id uuid not null references teams on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role    team_role not null default 'coach',
  primary key (team_id, user_id)
);

create table if not exists players (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references teams on delete cascade,
  name       text not null check (length(name) between 1 and 60),
  lo         numeric(3, 1) check (lo between 0 and 9),
  hi         numeric(3, 1) check (hi between 0 and 9),
  positions  text not null default '' check (length(positions) <= 100),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (team_id, name),
  check (lo is null or hi is null or lo <= hi)
);

create table if not exists player_levels (
  id         bigint generated always as identity primary key,
  player_id  uuid not null references players on delete cascade,
  lo         numeric(3, 1),
  hi         numeric(3, 1),
  changed_at timestamptz not null default now(),
  changed_by uuid default auth.uid()
);

create table if not exists saved_groups (
  team_id  uuid not null references teams on delete cascade,
  key      text not null check (length(key) between 1 and 40),
  groups   jsonb not null,
  saved_at timestamptz not null default now(),
  saved_by uuid default auth.uid(),
  primary key (team_id, key)
);

create table if not exists saved_signups (
  team_id  uuid not null references teams on delete cascade,
  key      text not null check (length(key) between 1 and 40),
  names    jsonb not null,
  saved_at timestamptz not null default now(),
  saved_by uuid default auth.uid(),
  primary key (team_id, key)
);

create table if not exists saved_matches (
  team_id  uuid not null references teams on delete cascade,
  key      text not null check (length(key) between 1 and 40),
  matches  jsonb not null,
  saved_at timestamptz not null default now(),
  saved_by uuid default auth.uid(),
  primary key (team_id, key)
);

create table if not exists fixture_sets (
  team_id  uuid not null references teams on delete cascade,
  id       text not null check (length(id) between 1 and 40),
  name     text not null default '' check (length(name) <= 100),
  games    jsonb not null,
  saved_at timestamptz not null default now(),
  saved_by uuid default auth.uid(),
  primary key (team_id, id)
);

-- a level change is kept (the first level too)
create or replace function log_player_level() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.lo is distinct from old.lo or new.hi is distinct from old.hi then
    insert into player_levels (player_id, lo, hi) values (new.id, new.lo, new.hi);
  end if;
  return new;
end $$;
drop trigger if exists player_level_log on players;
create trigger player_level_log after insert or update on players for each row execute function log_player_level();

-- ---------------------------------------------------------------- who may do what

-- the user's role on a team (null: not a member). security definer: reads team_members past its own policies.
create or replace function team_role_of(t uuid) returns team_role
language sql stable security definer set search_path = public as $$
  select role from team_members where team_id = t and user_id = auth.uid()
$$;
-- at least this role on the team (admin > coach > assistant)
create or replace function has_team_role(t uuid, at_least team_role) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select case role when 'admin' then 3 when 'coach' then 2 else 1 end from team_members
                   where team_id = t and user_id = auth.uid())
                  >= case at_least when 'admin' then 3 when 'coach' then 2 else 1 end, false)
      or exists (select 1 from club_admins a join teams x on x.club_id = a.club_id where x.id = t and a.user_id = auth.uid())
$$;
create or replace function is_club_admin(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from club_admins where club_id = c and user_id = auth.uid())
$$;

alter table clubs         enable row level security;
alter table teams         enable row level security;
alter table club_admins   enable row level security;
alter table team_members  enable row level security;
alter table players       enable row level security;
alter table player_levels enable row level security;
alter table saved_groups  enable row level security;
alter table saved_signups enable row level security;
alter table saved_matches enable row level security;
alter table fixture_sets  enable row level security;

do $$ declare r record; begin                              -- run again: the policies are made afresh
  for r in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on %I', r.policyname, r.tablename);
  end loop;
end $$;

create policy "club: admins and members see it" on clubs for select
  using (is_club_admin(id) or exists (select 1 from teams t where t.club_id = clubs.id and team_role_of(t.id) is not null));
create policy "club: admins change it" on clubs for update using (is_club_admin(id));

create policy "team: members see it" on teams for select using (has_team_role(id, 'assistant'));
create policy "team: club admins make it" on teams for insert with check (is_club_admin(club_id));
create policy "team: holdleder changes it" on teams for update using (has_team_role(id, 'admin'));
create policy "team: club admins remove it" on teams for delete using (is_club_admin(club_id));

create policy "club admins: see each other" on club_admins for select using (is_club_admin(club_id));

create policy "members: see the team's" on team_members for select using (has_team_role(team_id, 'assistant'));
create policy "members: holdleder adds" on team_members for insert with check (has_team_role(team_id, 'admin'));
create policy "members: holdleder changes" on team_members for update using (has_team_role(team_id, 'admin'));
create policy "members: holdleder removes, or you leave" on team_members for delete
  using (has_team_role(team_id, 'admin') or user_id = auth.uid());

create policy "players: coaches see them" on players for select using (has_team_role(team_id, 'coach'));
create policy "players: coaches add" on players for insert with check (has_team_role(team_id, 'coach'));
create policy "players: coaches change" on players for update using (has_team_role(team_id, 'coach'));
create policy "players: holdleder removes" on players for delete using (has_team_role(team_id, 'admin'));

create policy "levels: coaches see the history" on player_levels for select
  using (exists (select 1 from players p where p.id = player_id and has_team_role(p.team_id, 'coach')));

create policy "groups: members see" on saved_groups for select using (has_team_role(team_id, 'assistant'));
create policy "groups: coaches save" on saved_groups for all
  using (has_team_role(team_id, 'coach')) with check (has_team_role(team_id, 'coach'));
create policy "signups: members see" on saved_signups for select using (has_team_role(team_id, 'assistant'));
create policy "signups: members save" on saved_signups for all
  using (has_team_role(team_id, 'assistant')) with check (has_team_role(team_id, 'assistant'));
create policy "matches: members see" on saved_matches for select using (has_team_role(team_id, 'assistant'));
create policy "matches: coaches save" on saved_matches for all
  using (has_team_role(team_id, 'coach')) with check (has_team_role(team_id, 'coach'));
create policy "fixtures: members see" on fixture_sets for select using (has_team_role(team_id, 'assistant'));
create policy "fixtures: coaches save" on fixture_sets for all
  using (has_team_role(team_id, 'coach')) with check (has_team_role(team_id, 'coach'));

-- ---------------------------------------------------------------- what the app calls

-- "dd.MM.yyyy HH:mm" in Danish time, as the sheet writes it
create or replace function saved_text(t timestamptz) returns text language sql immutable as $$
  select to_char(t at time zone 'Europe/Copenhagen', 'DD.MM.YYYY HH24:MI')
$$;

-- The teams the user is on: [{ id, name, club, role }], the user's own first
create or replace function my_teams() returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'club', c.name, 'role', m.role)
                            order by c.name, t.name), '[]')
  from team_members m join teams t on t.id = m.team_id join clubs c on c.id = t.club_id
  where m.user_id = auth.uid()
$$;

-- Everything Grupper, Kampe and Spilleroversigt need, as getGroupData in apps-script/Grupper.gs:
-- { version, players: [{ name, lo, hi, pos? }], history, signups, matches, fixtures }, or { unchanged, version } when
-- the phone already has this version. Assistants get the players without levels.
create or replace function get_group_data(team uuid, have text default '') returns jsonb
language plpgsql stable security definer set search_path = public as $$   -- definer: checks the membership itself (below),
                                                                       -- so an assistant gets the players without levels
declare
  levels boolean := has_team_role(team, 'coach');
  data jsonb; v text;
begin
  if not has_team_role(team, 'assistant') then raise exception 'LOGIN'; end if;
  data := jsonb_build_object(
    'players', coalesce((select jsonb_agg(
        jsonb_strip_nulls(jsonb_build_object('name', p.name,
          'pos', nullif(p.positions, ''))) || jsonb_build_object(
          'lo', case when levels then p.lo end, 'hi', case when levels then p.hi end)
        order by p.created_at, p.name)
      from players p where p.team_id = team and p.active), '[]'),
    'history', coalesce((select jsonb_object_agg(g.key, jsonb_build_object('saved', saved_text(g.saved_at), 'groups', g.groups))
      from saved_groups g where g.team_id = team), '{}'),
    'signups', coalesce((select jsonb_object_agg(s.key, jsonb_build_object('saved', saved_text(s.saved_at), 'names', s.names))
      from saved_signups s where s.team_id = team), '{}'),
    'matches', coalesce((select jsonb_object_agg(m.key, jsonb_build_object('saved', saved_text(m.saved_at), 'matches', m.matches))
      from saved_matches m where m.team_id = team), '{}'),
    'fixtures', coalesce((select jsonb_object_agg(f.id, jsonb_build_object('saved', saved_text(f.saved_at), 'name', f.name, 'games', f.games))
      from fixture_sets f where f.team_id = team), '{}'));
  -- players without a level come through as null (the app: fits everywhere), and the server version the app expects
  v := left(md5(data::text), 12);
  if have <> '' and have = v then return jsonb_build_object('unchanged', true, 'version', v, 'server', 5); end if;
  return data || jsonb_build_object('version', v, 'server', 5);
end $$;

-- names: trimmed, no empty ones
create or replace function clean_names(a jsonb) returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(to_jsonb(left(btrim(x), 60))), '[]')
  from jsonb_array_elements_text(case when jsonb_typeof(a) = 'array' then a else '[]' end) x where btrim(x) <> ''
$$;

-- Saves one training's groups ([[names]]); [] removes them. Gives back { ok, saved }.
create or replace function save_groups(team uuid, key text, groups jsonb) returns jsonb
language plpgsql security invoker set search_path = public as $$
#variable_conflict use_column
declare g jsonb; now_ timestamptz := now();
begin
  key := btrim(coalesce(key, ''));
  if key = '' or length(key) > 40 then raise exception 'No training given.'; end if;
  if jsonb_typeof(groups) <> 'array' or exists (select 1 from jsonb_array_elements(groups) e where jsonb_typeof(e) <> 'array')
    then raise exception 'The groups could not be read.'; end if;
  select coalesce(jsonb_agg(clean_names(e)), '[]') into g from jsonb_array_elements(groups) e;
  if not exists (select 1 from jsonb_array_elements(g) e where jsonb_array_length(e) > 0) then
    delete from saved_groups s where s.team_id = team and s.key = save_groups.key;
  else
    insert into saved_groups (team_id, key, groups, saved_at) values (team, key, g, now_)
      on conflict (team_id, key) do update set groups = excluded.groups, saved_at = now_, saved_by = auth.uid();
  end if;
  return jsonb_build_object('ok', true, 'saved', saved_text(now_));
end $$;

-- Saves who signed up for one training ([names]); [] removes them.
create or replace function save_signups(team uuid, key text, names jsonb) returns jsonb
language plpgsql security invoker set search_path = public as $$
#variable_conflict use_column
declare n jsonb := clean_names(names); now_ timestamptz := now();
begin
  key := btrim(coalesce(key, ''));
  if key = '' or length(key) > 40 then raise exception 'No training given.'; end if;
  if jsonb_typeof(names) <> 'array' then raise exception 'The list could not be read.'; end if;
  if jsonb_array_length(n) = 0 then
    delete from saved_signups s where s.team_id = team and s.key = save_signups.key;
  else
    insert into saved_signups (team_id, key, names, saved_at) values (team, key, n, now_)
      on conflict (team_id, key) do update set names = excluded.names, saved_at = now_, saved_by = auth.uid();
  end if;
  return jsonb_build_object('ok', true, 'saved', saved_text(now_));
end $$;

-- Saves one training's matches ([[[A], [B] (, [C])], …]); [] removes them.
create or replace function save_matches(team uuid, key text, matches jsonb) returns jsonb
language plpgsql security invoker set search_path = public as $$
#variable_conflict use_column
declare m jsonb; now_ timestamptz := now();
begin
  key := btrim(coalesce(key, ''));
  if key = '' or length(key) > 40 then raise exception 'No training given.'; end if;
  if jsonb_typeof(matches) <> 'array' or exists (select 1 from jsonb_array_elements(matches) e
       where jsonb_typeof(e) <> 'array' or jsonb_array_length(e) not in (2, 3)
          or exists (select 1 from jsonb_array_elements(e) t where jsonb_typeof(t) <> 'array'))
    then raise exception 'The matches could not be read.'; end if;
  select coalesce(jsonb_agg((select jsonb_agg(clean_names(t)) from jsonb_array_elements(e) t)), '[]') into m
    from jsonb_array_elements(matches) e;
  if jsonb_array_length(m) = 0 then
    delete from saved_matches s where s.team_id = team and s.key = save_matches.key;
  else
    insert into saved_matches (team_id, key, matches, saved_at) values (team, key, m, now_)
      on conflict (team_id, key) do update set matches = excluded.matches, saved_at = now_, saved_by = auth.uid();
  end if;
  return jsonb_build_object('ok', true, 'saved', saved_text(now_));
end $$;

-- Saves one set of matches from the Kampe tab ({ name, games: [{ name, date, level 1–4, size, avail, players,
-- locked }] }); no matches removes it.
create or replace function save_fixture_set(team uuid, set_id text, fixture_set jsonb) returns jsonb
language plpgsql security invoker set search_path = public as $$
#variable_conflict use_column
declare games jsonb := coalesce(fixture_set -> 'games', '[]'); clean jsonb; now_ timestamptz := now();
begin
  set_id := btrim(coalesce(set_id, ''));
  if set_id = '' or length(set_id) > 40 then raise exception 'No set given.'; end if;
  if jsonb_typeof(games) <> 'array' or exists (select 1 from jsonb_array_elements(games) g
       where jsonb_typeof(g -> 'avail') is distinct from 'array' or jsonb_typeof(g -> 'players') is distinct from 'array'
          or not coalesce((g ->> 'level') ~ '^[1-4]$', false))
    then raise exception 'The matches could not be read.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'name', left(btrim(coalesce(g ->> 'name', '')), 100), 'date', left(btrim(coalesce(g ->> 'date', '')), 10),
      'level', (g ->> 'level')::int, 'size', greatest(1, coalesce(nullif(g ->> 'size', '')::int, 1)),
      'avail', clean_names(g -> 'avail'),
      'players', (select coalesce(jsonb_agg(x), '[]') from jsonb_array_elements(clean_names(g -> 'players')) x
                  where clean_names(g -> 'avail') @> jsonb_build_array(x)),
      'locked', (select coalesce(jsonb_agg(x), '[]') from jsonb_array_elements(clean_names(coalesce(g -> 'locked', '[]'))) x
                 where clean_names(g -> 'avail') @> jsonb_build_array(x)))), '[]')
    into clean from jsonb_array_elements(games) g;
  if jsonb_array_length(clean) = 0 then
    delete from fixture_sets f where f.team_id = team and f.id = set_id;
  else
    insert into fixture_sets (team_id, id, name, games, saved_at)
      values (team, set_id, left(btrim(coalesce(fixture_set ->> 'name', '')), 100), clean, now_)
      on conflict (team_id, id) do update set name = excluded.name, games = excluded.games, saved_at = now_, saved_by = auth.uid();
  end if;
  return jsonb_build_object('ok', true, 'saved', saved_text(now_));
end $$;

-- GDPR: removes a player and every trace of their name in the team's saved groups, signups, matches and sets
-- (holdleder only). Gives back how many saved trainings were changed.
create or replace function forget_player(team uuid, player_name text) returns integer
language plpgsql security invoker set search_path = public as $$
#variable_conflict use_column
declare n integer := 0; c integer; who jsonb := to_jsonb(player_name);
begin
  if not has_team_role(team, 'admin') then raise exception 'Only the holdleder may remove a player.'; end if;
  delete from players p where p.team_id = team and p.name = player_name;
  update saved_groups s set groups = (select coalesce(jsonb_agg((select coalesce(jsonb_agg(x), '[]') from jsonb_array_elements(e) x where x <> who)), '[]')
                                      from jsonb_array_elements(s.groups) e)
    where s.team_id = team and s.groups::text like '%' || replace(who::text, '%', '\%') || '%';
  get diagnostics c = row_count; n := n + c;
  update saved_signups s set names = (select coalesce(jsonb_agg(x), '[]') from jsonb_array_elements(s.names) x where x <> who)
    where s.team_id = team and s.names @> jsonb_build_array(who);
  get diagnostics c = row_count; n := n + c;
  update saved_matches s set matches = (select coalesce(jsonb_agg((select coalesce(jsonb_agg((select coalesce(jsonb_agg(x), '[]')
                                         from jsonb_array_elements(t) x where x <> who)), '[]') from jsonb_array_elements(e) t)), '[]')
                                        from jsonb_array_elements(s.matches) e)
    where s.team_id = team and s.matches::text like '%' || replace(who::text, '%', '\%') || '%';
  get diagnostics c = row_count; n := n + c;
  update fixture_sets f set games = (select coalesce(jsonb_agg(g || jsonb_build_object(
      'avail',   (select coalesce(jsonb_agg(x), '[]') from jsonb_array_elements(g -> 'avail') x where x <> who),
      'players', (select coalesce(jsonb_agg(x), '[]') from jsonb_array_elements(g -> 'players') x where x <> who),
      'locked',  (select coalesce(jsonb_agg(x), '[]') from jsonb_array_elements(coalesce(g -> 'locked', '[]')) x where x <> who))), '[]')
    from jsonb_array_elements(f.games) g)
    where f.team_id = team and f.games::text like '%' || replace(who::text, '%', '\%') || '%';
  get diagnostics c = row_count; n := n + c;
  return n;
end $$;

-- ================================================================ training plans and the drill library

-- each team's plan has a public code for its link (<app>?hold=<code>), so players and parents can see it
alter table teams add column if not exists plan_code text unique default substr(md5(gen_random_uuid()::text), 1, 8);
alter table teams add column if not exists plan_public boolean not null default true;
update teams set plan_code = substr(md5(gen_random_uuid()::text), 1, 8) where plan_code is null;

create table if not exists trainings (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references teams on delete cascade,
  day        date,                                     -- the date (empty: not set yet)
  date_text  text not null default '' check (length(date_text) <= 60),   -- as written, e.g. "Mandag 3. nov."
  theme      text not null default '' check (length(theme) <= 200),
  subtheme   text not null default '' check (length(subtheme) <= 200),
  focus      text not null default '' check (length(focus) <= 200),
  notes      jsonb not null default '[]',              -- [{ text, url }]
  parts      jsonb not null default '{}',              -- { startup, station1–4, finish: { text, url, drillId, coaches } }
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
create index if not exists trainings_team_day on trainings (team_id, day);

create table if not exists drill_sources (
  id      text primary key check (id ~ '^[a-z0-9-]{1,20}$'),
  name    text not null,                               -- shown on the drill, e.g. "DBU"
  credit  text not null default '',                    -- e.g. "Øvelse fra DBU's øvelsesbank"
  url     text not null default '',
  active  boolean not null default false               -- only drills from active sources are shown
);
insert into drill_sources (id, name, credit, url, active) values
  ('dbu', 'DBU', 'Øvelse fra DBU''s øvelsesbank', 'https://www.dbu.dk', true),
  ('egne', 'Træningsparat', 'Øvelse fra Træningsparats eget bibliotek', '', false),
  ('fck', 'FCK', 'Øvelse fra FCK', 'https://fck.better-coaching.dk', false),
  ('fa', 'FA', 'Øvelse fra England Football', 'https://learn.englandfootball.com', false),
  ('nff', 'NFF', 'Øvelse fra Norges Fotballforbund', 'https://www.fotball.no', false)
on conflict (id) do nothing;

create table if not exists drills (
  id          text primary key check (length(id) between 1 and 40),   -- e.g. "1234" (DBU's id) or "EGNE-12"
  source_id   text not null references drill_sources,
  owner_club  uuid references clubs on delete cascade,  -- empty: the shared library; set: that club's own drill
  name        text not null check (length(name) between 1 and 200),
  content     jsonb not null,                          -- the drill as the app shows it: { "Navn", "Beskrivelse", "Fokus", … }
  content_da  jsonb not null default '{}',             -- Danish texts of a drill in another language: { "Navn (DA)", … }
  media       jsonb not null default '[]',             -- later: drawings and animations of an own drill
  published   boolean not null default true,
  updated_at  timestamptz not null default now()
);
create index if not exists drills_source on drills (source_id);

create table if not exists library_settings (
  id      integer primary key default 1 check (id = 1),
  headers jsonb not null default '[]',                 -- the order of the drill's sections
  aliases jsonb not null default '[]',                 -- tag renames [{ col, from, to }]
  groups  jsonb not null default '[]'                  -- tag groups [{ col, tag, group }]
);
insert into library_settings (id) values (1) on conflict (id) do nothing;

create table if not exists app_admins (
  user_id uuid primary key references auth.users on delete cascade
);

create table if not exists usage_counts (
  day   date not null,
  what  text not null check (length(what) <= 120),
  n     integer not null default 0,
  primary key (day, what)
);

create or replace function is_app_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_admins where user_id = auth.uid())
$$;
-- drills the user may see: published, from an active source, shared or their club's own
create or replace function drill_visible(d drills) returns boolean
language sql stable security definer set search_path = public as $$
  select d.published and exists (select 1 from drill_sources s where s.id = d.source_id and s.active)
     and (d.owner_club is null or exists (select 1 from teams t join team_members m on m.team_id = t.id
                                          where t.club_id = d.owner_club and m.user_id = auth.uid())
                               or is_club_admin(d.owner_club))
$$;

alter table trainings        enable row level security;
alter table drill_sources    enable row level security;
alter table drills           enable row level security;
alter table library_settings enable row level security;
alter table app_admins       enable row level security;
alter table usage_counts     enable row level security;

create policy "plan: members see it" on trainings for select using (has_team_role(team_id, 'assistant'));
create policy "plan: coaches write it" on trainings for all
  using (has_team_role(team_id, 'coach')) with check (has_team_role(team_id, 'coach'));
create policy "sources: everyone logged in sees them" on drill_sources for select using (true);
create policy "sources: app admins change them" on drill_sources for all using (is_app_admin()) with check (is_app_admin());
create policy "drills: visible ones" on drills for select using (drill_visible(drills) or is_app_admin());
create policy "drills: app admins keep the shared library" on drills for all
  using (owner_club is null and is_app_admin()) with check (owner_club is null and is_app_admin());
create policy "drills: club admins keep the club's own" on drills for all
  using (owner_club is not null and is_club_admin(owner_club)) with check (owner_club is not null and is_club_admin(owner_club));
create policy "library: everyone logged in reads it" on library_settings for select using (true);
create policy "library: app admins change it" on library_settings for update using (is_app_admin());
create policy "app admins: see themselves" on app_admins for select using (user_id = auth.uid());
create policy "usage: app admins read it" on usage_counts for select using (is_app_admin());

-- One drill as the app gets it: its content, with ID, Navn and Kilde filled in, and __da when it has Danish texts
create or replace function drill_json(d drills) returns jsonb
language sql stable security definer set search_path = public as $$
  select d.content || jsonb_build_object('ID', d.id, 'Navn', coalesce(d.content ->> 'Navn', d.name),
           'Kilde', coalesce(nullif(d.content ->> 'Kilde', ''), (select name from drill_sources where id = d.source_id)))
         || case when d.content_da <> '{}' then jsonb_build_object('__da', 1) else '{}' end
$$;

-- The team whose plan is asked for: by its public code, or the user's chosen team (code empty)
create or replace function plan_team(code text, team uuid default null) returns uuid
language sql stable security definer set search_path = public as $$
  select id from teams
  where (code <> '' and plan_code = code and (plan_public or has_team_role(id, 'assistant')))
     or (coalesce(code, '') = '' and id = team and has_team_role(id, 'assistant'))
  limit 1
$$;

-- The plan, as getPlan in apps-script/Code.gs: { version, sessions: [{ date, iso, theme, subtheme, focus, notes,
-- startup, station1–4, finish }] }, or { unchanged, version }. Anyone with the team's code may read a public plan.
create or replace function get_plan(code text default '', have text default '', team uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t uuid := plan_team(coalesce(code, ''), team); data jsonb; v text;
begin
  if t is null then raise exception 'Holdets træningsplan findes ikke, eller den er ikke offentlig.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', x.id, 'date', coalesce(nullif(x.date_text, ''), coalesce(to_char(x.day, 'YYYY-MM-DD'), '')),
      'iso', coalesce(to_char(x.day, 'YYYY-MM-DD'), ''), 'theme', x.theme, 'subtheme', x.subtheme, 'focus', x.focus,
      'notes', x.notes) || (select coalesce(jsonb_object_agg(k, coalesce(x.parts -> k,
        '{"text": "", "url": "", "drillId": "", "coaches": []}'::jsonb)), '{}')
        from unnest(array['startup', 'station1', 'station2', 'station3', 'station4', 'finish']) k)
      order by x.day nulls last, x.updated_at), '[]')
    into data from trainings x where x.team_id = t;
  v := left(md5(data::text), 12);
  if have <> '' and have = v then return jsonb_build_object('unchanged', true, 'version', v, 'server', 6); end if;
  return jsonb_build_object('version', v, 'sessions', data, 'server', 6, 'team', t,
                            'code', (select plan_code from teams where id = t));
end $$;

-- Saves one training of the plan (a new one when id is empty) and gives back { ok, id }. Coaches only.
create or replace function save_training(team uuid, training jsonb) returns jsonb
language plpgsql security invoker set search_path = public as $$
#variable_conflict use_column
declare tid uuid := nullif(training ->> 'id', '')::uuid; parts jsonb := '{}'; k text; p jsonb;
begin
  if not has_team_role(team, 'coach') then raise exception 'Du har ikke adgang til at rette holdets træningsplan.'; end if;
  foreach k in array array['startup', 'station1', 'station2', 'station3', 'station4', 'finish'] loop
    p := coalesce(training -> k, '{}');
    parts := parts || jsonb_build_object(k, jsonb_build_object('text', left(coalesce(p ->> 'text', ''), 300),
      'url', left(coalesce(p ->> 'url', ''), 500), 'drillId', left(coalesce(p ->> 'drillId', ''), 40),
      'coaches', coalesce((select jsonb_agg(left(btrim(c), 60)) from jsonb_array_elements_text(coalesce(p -> 'coaches', '[]')) c
                          where btrim(c) <> ''), '[]')));
  end loop;
  if tid is null then
    insert into trainings (team_id, day, date_text, theme, subtheme, focus, notes, parts)
    values (team, nullif(training ->> 'iso', '')::date, left(coalesce(training ->> 'date', ''), 60),
            left(coalesce(training ->> 'theme', ''), 200), left(coalesce(training ->> 'subtheme', ''), 200),
            left(coalesce(training ->> 'focus', ''), 200), coalesce(training -> 'notes', '[]'), parts)
    returning id into tid;
  else
    update trainings set day = nullif(training ->> 'iso', '')::date, date_text = left(coalesce(training ->> 'date', ''), 60),
      theme = left(coalesce(training ->> 'theme', ''), 200), subtheme = left(coalesce(training ->> 'subtheme', ''), 200),
      focus = left(coalesce(training ->> 'focus', ''), 200), notes = coalesce(training -> 'notes', '[]'), parts = parts,
      updated_at = now(), updated_by = auth.uid()
    where id = tid and team_id = team;
    if not found then raise exception 'Træningen findes ikke på holdet.'; end if;
  end if;
  return jsonb_build_object('ok', true, 'id', tid);
end $$;

create or replace function delete_training(team uuid, training_id uuid) returns jsonb
language plpgsql security invoker set search_path = public as $$
begin
  if not has_team_role(team, 'coach') then raise exception 'Du har ikke adgang til at rette holdets træningsplan.'; end if;
  delete from trainings where id = training_id and team_id = team;
  return jsonb_build_object('ok', true);
end $$;

-- The whole library, as getDrills in Code.gs: { version, daVersion, headers, drills, aliases, groups }, or
-- { unchanged, version, daVersion }. Logged in only.
create or replace function get_drills(have text default '') returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare s library_settings; list jsonb; da jsonb; v text; dv text;
begin
  if auth.uid() is null then raise exception 'LOGIN'; end if;
  select * into s from library_settings where id = 1;
  select coalesce(jsonb_agg(drill_json(d) order by d.name), '[]'),
         coalesce(jsonb_object_agg(d.id, d.content_da) filter (where d.content_da <> '{}'), '{}')
    into list, da from drills d;                         -- (the access rules leave only the visible ones)
  v := left(md5(list::text || coalesce(s.headers, '[]')::text || coalesce(s.aliases, '[]')::text || coalesce(s.groups, '[]')::text), 12);
  dv := left(md5(da::text), 12);
  if have <> '' and have = v then return jsonb_build_object('unchanged', true, 'version', v, 'daVersion', dv); end if;
  return jsonb_build_object('version', v, 'daVersion', dv, 'headers', coalesce(s.headers, '[]'), 'drills', list,
                            'aliases', coalesce(s.aliases, '[]'), 'groups', coalesce(s.groups, '[]'));
end $$;

-- The Danish texts: { version, da: { drill id: { "Navn (DA)": … } } }
create or replace function get_drills_da(have text default '') returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare da jsonb; v text;
begin
  if auth.uid() is null then raise exception 'LOGIN'; end if;
  select coalesce(jsonb_object_agg(d.id, d.content_da) filter (where d.content_da <> '{}'), '{}') into da from drills d;
  v := left(md5(da::text), 12);
  if have <> '' and have = v then return jsonb_build_object('unchanged', true, 'version', v); end if;
  return jsonb_build_object('version', v, 'da', da);
end $$;

-- Drills opened from a plan, without a login, but only drills that the team's (public) plan uses:
-- { headers, aliases, drills } as getSessionDrills in Code.gs, or null
create or replace function get_session_drills(ids text[], code text default '', team uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t uuid := plan_team(coalesce(code, ''), team); used text[]; list jsonb; s library_settings;
begin
  if t is null then return null; end if;
  select array_agg(distinct x.parts -> k ->> 'drillId') into used
    from trainings x, unnest(array['startup', 'station1', 'station2', 'station3', 'station4', 'finish']) k
    where x.team_id = t and coalesce(x.parts -> k ->> 'drillId', '') <> '';
  select jsonb_agg(drill_json(d) || d.content_da order by d.name) into list
    from drills d join drill_sources src on src.id = d.source_id
    where d.id = any(ids[1:12]) and d.id = any(coalesce(used, '{}')) and d.published and src.active
      and (d.owner_club is null or d.owner_club = (select club_id from teams where id = t));
  if list is null then return null; end if;
  select * into s from library_settings where id = 1;
  return jsonb_build_object('headers', coalesce(s.headers, '[]'), 'aliases', coalesce(s.aliases, '[]'), 'drills', list);
end $$;

-- The app's statistics, as track in apps-script/Statistik.gs: counts per day, nothing about who
create or replace function track(event text, a text default '', b text default '') returns boolean
language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'Europe/Copenhagen')::date; keys text[] := '{}';
begin
  if event = 'open' then keys := array['App åbnet'] || case when coalesce(a, '') in ('true', '1') then array['Unikke telefoner'] else '{}' end;
  elsif event = 'drill' then keys := array['Øvelser åbnet', 'Øvelse: ' || left(coalesce(nullif(b, ''), a, ''), 100)];
  else return false; end if;
  insert into usage_counts (day, what, n) select today, k, 1 from unnest(keys) k
    on conflict (day, what) do update set n = usage_counts.n + 1;
  return true;
end $$;

-- Who may call what: logged-in users (Supabase's "authenticated" role) the functions above; without a login (anon)
-- only reading a public plan, the drills it uses, and counting app opens
revoke all on all functions in schema public from public, anon;
grant usage on schema public to authenticated, anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
grant execute on function get_plan(text, text, uuid), get_session_drills(text[], text, uuid), track(text, text, text),
  plan_team(text, uuid), has_team_role(uuid, team_role), team_role_of(uuid), is_club_admin(uuid), drill_json(drills) to anon;
