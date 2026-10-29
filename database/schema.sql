-- =====================================================================
-- CPMS unified schema for Supabase (PostgreSQL)
-- Run once in the Supabase SQL editor (or `supabase db push`).
-- The FastAPI backend uses the service-role key, which bypasses RLS.
-- RLS below protects direct browser access (supabase-js, Realtime).
-- Safe to re-run: everything is idempotent. Databases created by an earlier
-- version are upgraded in place by the "upgrade from earlier versions" block below.
-- =====================================================================
create extension if not exists "pgcrypto";

-- ---------- enums ----------
do $$ begin
  create type app_role as enum ('admin','supervisor','student');
exception when duplicate_object then null; end $$;
do $$ begin
  create type project_role as enum ('owner','member');
exception when duplicate_object then null; end $$;

-- ---------- profiles (1:1 with auth.users) ----------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  avatar_url text,
  university text,
  course text,
  semester smallint check (semester between 1 and 8),
  skills text[] not null default '{}',
  interests text[] not null default '{}',
  availability text,
  github_username text,
  role app_role not null default 'student',
  is_suspended boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists profiles_email_idx on profiles (lower(email));

-- ---------- projects ----------
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  course text,
  owner_id uuid not null references profiles(id) on delete cascade,
  supervisor_id uuid references profiles(id) on delete set null,
  status text not null default 'active' check (status in ('active','on_hold','completed','archived')),
  visibility text not null default 'public' check (visibility in ('public','private')),
  required_skills text[] not null default '{}',
  start_date date,
  due_date date,
  github_owner text,
  github_repo text,
  github_token_enc text,            -- Fernet-encrypted PAT / OAuth token (never returned by the API)
  github_auth_type text check (github_auth_type in ('pat','oauth')),
  github_webhook_secret text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role project_role not null default 'member',
  joined_at timestamptz not null default now(),
  unique (project_id, user_id)
);
create index if not exists pm_user_idx on project_members(user_id);

create table if not exists project_invites (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  email text not null,
  name text,
  token text not null unique default encode(gen_random_bytes(24),'hex'),
  invited_by uuid references profiles(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','accepted','revoked','expired')),
  expires_at timestamptz not null default now() + interval '14 days',
  created_at timestamptz not null default now()
);
create index if not exists invites_email_idx on project_invites (lower(email));

create table if not exists join_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  message text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by uuid references profiles(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists join_requests_one_pending
  on join_requests(project_id, user_id) where status = 'pending';

-- ---------- milestones ----------
create table if not exists milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  title text not null,
  description text,
  completion_criteria text,
  phase text,
  weight integer not null check (weight between 1 and 100),
  start_date date,
  end_date date,
  status text not null default 'planned'
    check (status in ('planned','in_progress','in_review','approved','changes_requested')),
  assignee_id uuid references profiles(id) on delete set null,
  submission_note text,
  submission_commit_shas text[] not null default '{}',
  review_note text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- weights of all milestones in a project may never exceed 100
create or replace function enforce_milestone_weight() returns trigger language plpgsql as $$
declare total integer;
begin
  select coalesce(sum(weight),0) into total from milestones
   where project_id = new.project_id and id <> new.id;
  if total + new.weight > 100 then
    raise exception 'Milestone weights for this project would total % (max 100)', total + new.weight;
  end if;
  return new;
end $$;
drop trigger if exists trg_milestone_weight on milestones;
create trigger trg_milestone_weight before insert or update of weight, project_id on milestones
  for each row execute function enforce_milestone_weight();

-- ---------- tasks ----------
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  milestone_id uuid references milestones(id) on delete set null,
  title text not null,
  description text not null default '',
  status text not null default 'todo' check (status in ('todo','in_progress','in_review','completed')),
  priority text not null default 'medium' check (priority in ('low','medium','high','urgent')),
  start_date date,
  deadline date,
  position integer not null default 0,
  created_by uuid references profiles(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (deadline is null or start_date is null or deadline >= start_date)
);
create index if not exists tasks_project_idx on tasks(project_id);

create table if not exists task_assignees (
  task_id uuid not null references tasks(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

create table if not exists task_dependencies (
  task_id uuid not null references tasks(id) on delete cascade,
  depends_on_task_id uuid not null references tasks(id) on delete cascade,
  primary key (task_id, depends_on_task_id),
  check (task_id <> depends_on_task_id)
);

-- ---------- logs ----------
create table if not exists activity_logs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  actor_id uuid references profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists activity_project_idx on activity_logs(project_id, created_at desc);

create table if not exists task_contribution_logs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  task_id uuid references tasks(id) on delete set null,
  actor_id uuid references profiles(id) on delete set null,
  action text not null,       -- created | assigned | reassigned | status_changed | completed | deleted
  from_value text,
  to_value text,
  created_at timestamptz not null default now()
);

create table if not exists file_contribution_logs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  actor_id uuid references profiles(id) on delete set null,
  file_name text not null,
  storage_path text,
  action text not null,       -- uploaded | replaced | downloaded | deleted
  created_at timestamptz not null default now()
);

create table if not exists milestone_logs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  milestone_id uuid references milestones(id) on delete set null,
  actor_id uuid references profiles(id) on delete set null,
  action text not null,       -- created | updated | submitted | approved | changes_requested | deleted
  note text,
  created_at timestamptz not null default now()
);

-- ---------- idea board ----------
create table if not exists ideas (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  author_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  body text not null default '',
  color text not null default 'slate',
  status text not null default 'open' check (status in ('open','planned','done','dropped')),
  created_at timestamptz not null default now()
);
create table if not exists idea_votes (
  idea_id uuid not null references ideas(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  reaction text not null default 'up',
  created_at timestamptz not null default now(),
  primary key (idea_id, user_id, reaction)
);
create table if not exists idea_comments (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references ideas(id) on delete cascade,
  author_id uuid not null references profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

-- ---------- messaging ----------
create table if not exists direct_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references profiles(id) on delete cascade,
  recipient_id uuid not null references profiles(id) on delete cascade,
  body text not null,
  kind text not null default 'text' check (kind in ('text','meeting','system')),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists dm_pair_idx on direct_messages(sender_id, recipient_id, created_at desc);

create table if not exists forum_threads (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  body text not null default '',
  category text not null default 'general',
  created_at timestamptz not null default now()
);
create table if not exists forum_posts (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references forum_threads(id) on delete cascade,
  author_id uuid not null references profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

-- ---------- meetings ----------
create table if not exists meetings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  title text not null,
  description text,
  starts_at timestamptz not null,
  duration_min integer not null default 30,
  is_instant boolean not null default false,
  meet_link text,
  link_provider text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists meeting_participants (
  meeting_id uuid not null references meetings(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  primary key (meeting_id, user_id)
);

-- ---------- notifications ----------
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  link text,
  dedupe_key text unique,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notif_user_idx on notifications(user_id, created_at desc);

-- ---------- GitHub events (webhook feed) ----------
create table if not exists github_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  kind text not null,         -- push | issues | pull_request | create | delete
  title text not null,
  author text,
  url text,
  ref text,
  occurred_at timestamptz not null default now(),
  payload jsonb not null default '{}'
);
create index if not exists gh_events_idx on github_events(project_id, occurred_at desc);

-- ---------- risk indicators / complaints / system logs ----------
create table if not exists risk_indicators (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  kind text not null,         -- overdue_task | delayed_milestone | unassigned_high_priority | stalled_review
  severity text not null check (severity in ('low','medium','high')),
  title text not null,
  entity_id uuid,
  detected_at timestamptz not null default now()
);
create index if not exists risk_project_idx on risk_indicators(project_id);

create table if not exists complaints (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references profiles(id) on delete cascade,
  reported_user_id uuid not null references profiles(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  reason text not null,
  details text,
  status text not null default 'open' check (status in ('open','resolved','dismissed')),
  resolved_by uuid references profiles(id) on delete set null,
  resolution_note text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  check (reporter_id <> reported_user_id)
);

create table if not exists system_logs (
  id uuid primary key default gen_random_uuid(),
  level text not null,
  message text not null,
  context jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- ---------- upgrade from earlier versions (idempotent; no-ops on a fresh database) ----------
-- 1) profiles.class_name (free text) -> profiles.semester (1-8). Only plain digits 1-8 are carried over.
alter table profiles add column if not exists semester smallint;
do $$ begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'profiles' and column_name = 'class_name') then
    update profiles set semester = trim(class_name)::smallint
     where semester is null and class_name ~ '^\s*[1-8]\s*$';
    alter table profiles drop column class_name;
  end if;
end $$;
alter table profiles drop constraint if exists profiles_semester_check;
alter table profiles add constraint profiles_semester_check check (semester between 1 and 8);

-- 2) the University section is gone
alter table profiles drop column if exists university_id;
drop table if exists universities cascade;

-- 3) the Reviewer actor is gone: project roles are owner | member, milestones have no designated reviewer
alter table milestones drop column if exists reviewer_id;
do $$ begin
  if exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
             where t.typname = 'project_role' and e.enumlabel = 'reviewer') then
    update project_members set role = 'member' where role::text = 'reviewer';
    alter type project_role rename to project_role_old;
    create type project_role as enum ('owner','member');
    alter table project_members alter column role drop default;
    alter table project_members alter column role type project_role using role::text::project_role;
    alter table project_members alter column role set default 'member';
    drop type project_role_old;
  end if;
end $$;

-- 4) complaints no longer have a 'reviewing' state
update complaints set status = 'open' where status = 'reviewing';
alter table complaints drop constraint if exists complaints_status_check;
alter table complaints add constraint complaints_status_check check (status in ('open','resolved','dismissed'));

-- ---------- triggers ----------
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
do $$ declare t text; begin
  foreach t in array array['profiles','projects','milestones','tasks'] loop
    execute format('drop trigger if exists trg_%1$s_updated on %1$s', t);
    execute format('create trigger trg_%1$s_updated before update on %1$s for each row execute function set_updated_at()', t);
  end loop;
end $$;

-- auto-create a profile when a user signs up (email or Google)
create or replace function handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, full_name, avatar_url)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
          new.raw_user_meta_data->>'avatar_url')
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- the project owner becomes a project member automatically
create or replace function add_owner_member() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into project_members (project_id, user_id, role) values (new.id, new.owner_id, 'owner')
  on conflict do nothing;
  return new;
end $$;
drop trigger if exists trg_project_owner on projects;
create trigger trg_project_owner after insert on projects for each row execute function add_owner_member();

-- every new text DM creates exactly one notification for the recipient (dedupe_key makes it idempotent)
create or replace function notify_on_dm() returns trigger language plpgsql security definer set search_path = public as $$
declare sender_name text;
begin
  if new.kind <> 'text' then return new; end if;
  select coalesce(nullif(full_name, ''), email) into sender_name from profiles where id = new.sender_id;
  insert into notifications (user_id, type, title, body, link, dedupe_key)
  values (new.recipient_id, 'dm', 'New message from ' || coalesce(sender_name, 'a teammate'),
          left(new.body, 120), '/messages?with=' || new.sender_id::text, 'dm:' || new.id::text)
  on conflict (dedupe_key) do nothing;
  return new;
end $$;
drop trigger if exists trg_dm_notify on direct_messages;
create trigger trg_dm_notify after insert on direct_messages for each row execute function notify_on_dm();

-- ---------- RLS helper functions ----------
create or replace function is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin') $$;
create or replace function is_project_member(pid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from project_members where project_id = pid and user_id = auth.uid())
      or exists (select 1 from projects where id = pid and supervisor_id = auth.uid())
      or is_admin() $$;
-- "manager" = the project lead (an owner) or a platform admin. Supervisors are deliberately NOT managers:
-- they may read, comment and react, nothing else.
create or replace function is_project_manager(pid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from project_members where project_id = pid and user_id = auth.uid() and role = 'owner')
      or is_admin() $$;
-- "contributor" = owner or member (or admin). Used for creating tasks, ideas and files.
create or replace function is_project_contributor(pid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from project_members where project_id = pid and user_id = auth.uid())
      or is_admin() $$;

-- ---------- direct-message eligibility ----------
-- Everyone a user may start or continue a DM with:
--   * anyone who is a member of at least one project the user is a member of
--   * the supervisor of any non-archived project the user is a member of
--   * every member of any non-archived project the user supervises
create or replace function dm_contacts(uid uuid) returns table (contact_id uuid)
language sql stable security definer set search_path = public as $$
  select other.user_id
    from project_members me join project_members other on other.project_id = me.project_id
   where me.user_id = uid and other.user_id <> uid
  union
  select pm.user_id
    from projects p join project_members pm on pm.project_id = p.id
   where p.supervisor_id = uid and p.status <> 'archived' and pm.user_id <> uid
  union
  select p.supervisor_id
    from projects p join project_members pm on pm.project_id = p.id
   where pm.user_id = uid and p.status <> 'archived' and p.supervisor_id is not null and p.supervisor_id <> uid
$$;

create or replace function can_send_dm(sender_id uuid, recipient_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select sender_id <> recipient_id
     and exists (select 1 from profiles s where s.id = sender_id and not s.is_suspended)
     and exists (select 1 from profiles r where r.id = recipient_id and not r.is_suspended)
     and exists (select 1 from dm_contacts(sender_id) c where c.contact_id = recipient_id)
$$;
revoke all on function dm_contacts(uuid), can_send_dm(uuid, uuid) from public, anon;
grant execute on function dm_contacts(uuid), can_send_dm(uuid, uuid) to authenticated, service_role;

-- a profile is visible to its owner, to admins and to people it may message
create or replace function can_see_profile(pid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select pid = auth.uid() or is_admin() or exists (select 1 from dm_contacts(auth.uid()) c where c.contact_id = pid) $$;

-- ---------- enable RLS everywhere ----------
do $$ declare t text; begin
  foreach t in array array['profiles','projects','project_members','project_invites','join_requests',
    'milestones','tasks','task_assignees','task_dependencies','activity_logs','task_contribution_logs',
    'file_contribution_logs','milestone_logs','ideas','idea_votes','idea_comments','direct_messages',
    'forum_threads','forum_posts','meetings','meeting_participants','notifications','github_events',
    'risk_indicators','complaints','system_logs'] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- ---------- policies ----------
-- profiles: readable by yourself, admins and people you may message; users edit only themselves and can
-- change neither their own role nor their own suspension flag
drop policy if exists profiles_read on profiles;
create policy profiles_read on profiles for select to authenticated using (can_see_profile(id));
drop policy if exists profiles_update_self on profiles;
create policy profiles_update_self on profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid()
              and role = (select p.role from profiles p where p.id = auth.uid())
              and is_suspended = (select p.is_suspended from profiles p where p.id = auth.uid()));

-- projects
drop policy if exists projects_read on projects;
create policy projects_read on projects for select to authenticated
  using (is_project_member(id) or visibility = 'public');
drop policy if exists projects_insert on projects;
create policy projects_insert on projects for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists projects_update on projects;
create policy projects_update on projects for update to authenticated using (is_project_manager(id));
drop policy if exists projects_delete on projects;
create policy projects_delete on projects for delete to authenticated
  using (owner_id = auth.uid() or is_admin());

drop policy if exists pm_read on project_members;
create policy pm_read on project_members for select to authenticated using (is_project_member(project_id));
drop policy if exists pm_manage on project_members;
create policy pm_manage on project_members for all to authenticated
  using (is_project_manager(project_id)) with check (is_project_manager(project_id));

drop policy if exists invites_manage on project_invites;
create policy invites_manage on project_invites for all to authenticated
  using (is_project_manager(project_id)) with check (is_project_manager(project_id));

drop policy if exists jr_read on join_requests;
create policy jr_read on join_requests for select to authenticated
  using (user_id = auth.uid() or is_project_manager(project_id));
drop policy if exists jr_insert on join_requests;
create policy jr_insert on join_requests for insert to authenticated with check (user_id = auth.uid());
drop policy if exists jr_decide on join_requests;
create policy jr_decide on join_requests for update to authenticated using (is_project_manager(project_id));

-- project-scoped tables: members read
do $$ declare t text; begin
  foreach t in array array['milestones','tasks','activity_logs','task_contribution_logs','file_contribution_logs',
                           'milestone_logs','ideas','meetings','github_events','risk_indicators'] loop
    execute format('drop policy if exists %1$s_read on %1$s', t);
    execute format('create policy %1$s_read on %1$s for select to authenticated using (is_project_member(project_id))', t);
  end loop;
end $$;

drop policy if exists milestones_write on milestones;
create policy milestones_write on milestones for all to authenticated
  using (is_project_manager(project_id)) with check (is_project_manager(project_id));
drop policy if exists tasks_write on tasks;
create policy tasks_write on tasks for all to authenticated
  using (is_project_contributor(project_id)) with check (is_project_contributor(project_id));
drop policy if exists ideas_write on ideas;
create policy ideas_write on ideas for insert to authenticated
  with check (author_id = auth.uid() and is_project_contributor(project_id));
drop policy if exists ideas_modify on ideas;
create policy ideas_modify on ideas for update to authenticated
  using (author_id = auth.uid() or is_project_manager(project_id));
drop policy if exists ideas_remove on ideas;
create policy ideas_remove on ideas for delete to authenticated
  using (author_id = auth.uid() or is_project_manager(project_id));
drop policy if exists meetings_write on meetings;
create policy meetings_write on meetings for all to authenticated
  using (is_project_manager(project_id)) with check (is_project_manager(project_id));

drop policy if exists ta_read on task_assignees;
create policy ta_read on task_assignees for select to authenticated
  using (exists (select 1 from tasks t where t.id = task_id and is_project_member(t.project_id)));
drop policy if exists td_read on task_dependencies;
create policy td_read on task_dependencies for select to authenticated
  using (exists (select 1 from tasks t where t.id = task_id and is_project_member(t.project_id)));
drop policy if exists mp_read on meeting_participants;
create policy mp_read on meeting_participants for select to authenticated
  using (user_id = auth.uid()
         or exists (select 1 from meetings m where m.id = meeting_id and is_project_manager(m.project_id)));

drop policy if exists votes_read on idea_votes;
create policy votes_read on idea_votes for select to authenticated
  using (exists (select 1 from ideas i where i.id = idea_id and is_project_member(i.project_id)));
drop policy if exists votes_write on idea_votes;
create policy votes_write on idea_votes for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid()
              and exists (select 1 from ideas i where i.id = idea_id and is_project_member(i.project_id)));
drop policy if exists icomments_read on idea_comments;
create policy icomments_read on idea_comments for select to authenticated
  using (exists (select 1 from ideas i where i.id = idea_id and is_project_member(i.project_id)));
drop policy if exists icomments_insert on idea_comments;
create policy icomments_insert on idea_comments for insert to authenticated
  with check (author_id = auth.uid()
              and exists (select 1 from ideas i where i.id = idea_id and is_project_member(i.project_id)));

-- direct messages: only the two parties can read (Realtime respects this); sending requires a shared project
-- or a supervisor/student relationship (can_send_dm). 'meeting' and 'system' rows come from the backend only.
drop policy if exists dm_read on direct_messages;
create policy dm_read on direct_messages for select to authenticated
  using (sender_id = auth.uid() or recipient_id = auth.uid());
drop policy if exists dm_insert on direct_messages;
create policy dm_insert on direct_messages for insert to authenticated
  with check (sender_id = auth.uid() and kind = 'text' and can_send_dm(sender_id, recipient_id));
drop policy if exists dm_mark_read on direct_messages;
create policy dm_mark_read on direct_messages for update to authenticated
  using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

-- forum: visible to all signed-in users
drop policy if exists ft_read on forum_threads;
create policy ft_read on forum_threads for select to authenticated using (true);
drop policy if exists ft_insert on forum_threads;
create policy ft_insert on forum_threads for insert to authenticated with check (author_id = auth.uid());
drop policy if exists ft_delete on forum_threads;
create policy ft_delete on forum_threads for delete to authenticated using (author_id = auth.uid() or is_admin());
drop policy if exists fp_read on forum_posts;
create policy fp_read on forum_posts for select to authenticated using (true);
drop policy if exists fp_insert on forum_posts;
create policy fp_insert on forum_posts for insert to authenticated with check (author_id = auth.uid());
drop policy if exists fp_delete on forum_posts;
create policy fp_delete on forum_posts for delete to authenticated using (author_id = auth.uid() or is_admin());

-- notifications: own rows only
drop policy if exists notif_own on notifications;
create policy notif_own on notifications for select to authenticated using (user_id = auth.uid());
drop policy if exists notif_update_own on notifications;
create policy notif_update_own on notifications for update to authenticated using (user_id = auth.uid());

-- complaints: reporter files and sees their own; admins see and resolve all
drop policy if exists complaints_insert on complaints;
create policy complaints_insert on complaints for insert to authenticated with check (reporter_id = auth.uid());
drop policy if exists complaints_read on complaints;
create policy complaints_read on complaints for select to authenticated using (reporter_id = auth.uid() or is_admin());
drop policy if exists complaints_admin on complaints;
create policy complaints_admin on complaints for update to authenticated using (is_admin());

drop policy if exists syslogs_admin on system_logs;
create policy syslogs_admin on system_logs for select to authenticated using (is_admin());

-- ---------- realtime ----------
do $$ begin
  begin alter publication supabase_realtime add table direct_messages; exception when others then null; end;
  begin alter publication supabase_realtime add table notifications; exception when others then null; end;
  begin alter publication supabase_realtime add table tasks; exception when others then null; end;
end $$;

-- ---------- storage bucket for project files ----------
insert into storage.buckets (id, name, public) values ('project-files','project-files', false)
on conflict (id) do nothing;

-- ---------- first admin ----------
-- After you sign up once, promote yourself:
--   update profiles set role = 'admin' where email = 'you@university.edu';
