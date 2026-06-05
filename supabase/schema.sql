create extension if not exists pgcrypto;

create table if not exists public.equipment (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default '기자재',
  total integer not null check (total >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  capacity integer not null default 1 check (capacity > 0),
  location text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  auth_id uuid references auth.users(id) on delete set null,
  email text not null unique,
  name text not null,
  student_id text not null unique,
  team_name text not null default '',
  role text not null default 'student' check (role in ('student', 'admin')),
  approved boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.rental_requests (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('equipment', 'room')),
  equipment_id uuid references public.equipment(id) on delete restrict,
  room_id uuid references public.rooms(id) on delete restrict,
  quantity integer not null default 1 check (quantity > 0),
  start_date date,
  return_date date,
  usage_date date,
  start_time time,
  end_time time,
  purpose text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'returned', 'rejected')),
  applicant_auth_id uuid not null references auth.users(id) on delete cascade,
  applicant_name text not null,
  student_id text not null,
  team_name text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists rental_requests_status_idx on public.rental_requests(status);
create index if not exists rental_requests_applicant_idx on public.rental_requests(applicant_auth_id);
create index if not exists rental_requests_equipment_idx on public.rental_requests(equipment_id);
create index if not exists rental_requests_room_time_idx on public.rental_requests(room_id, usage_date, start_time, end_time);

alter table public.equipment enable row level security;
alter table public.rooms enable row level security;
alter table public.members enable row level security;
alter table public.rental_requests enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.members
    where auth_id = auth.uid()
      and role = 'admin'
      and approved = true
  );
$$;

create policy "Anyone signed in can read active equipment"
on public.equipment for select
to authenticated
using (active = true or public.is_admin());

create policy "Admins manage equipment"
on public.equipment for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "Anyone signed in can read active rooms"
on public.rooms for select
to authenticated
using (active = true or public.is_admin());

create policy "Admins manage rooms"
on public.rooms for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "Members read own profile or admins read all"
on public.members for select
to authenticated
using (auth_id = auth.uid() or public.is_admin());

create policy "Users create own pending student profile"
on public.members for insert
to authenticated
with check (
  auth_id = auth.uid()
  and role = 'student'
  and approved = false
);

create policy "Admins manage members"
on public.members for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "Signed in users read reservation board"
on public.rental_requests for select
to authenticated
using (true);

create policy "Approved members create own requests"
on public.rental_requests for insert
to authenticated
with check (
  applicant_auth_id = auth.uid()
  and exists (
    select 1
    from public.members
    where auth_id = auth.uid()
      and approved = true
  )
);

create policy "Admins update requests"
on public.rental_requests for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

insert into public.equipment (name, category, total) values
  ('Sony A7M3', '카메라', 3),
  ('삼각대', '촬영 보조', 8),
  ('무선 마이크', '음향', 5),
  ('LED 조명', '조명', 6),
  ('짐벌', '촬영 보조', 2),
  ('녹음기', '음향', 4)
on conflict do nothing;

insert into public.rooms (name, capacity, location) values
  ('영상 스튜디오 A', 12, '미디어관 301'),
  ('편집실', 20, '미디어관 405'),
  ('세미나실', 30, '미디어관 502')
on conflict do nothing;

-- 첫 관리자 계정은 Supabase Auth에서 가입한 뒤 아래 값을 실제 계정 정보로 바꿔 한 번 실행하세요.
-- update public.members
-- set role = 'admin', approved = true
-- where email = 'admin@example.com';
