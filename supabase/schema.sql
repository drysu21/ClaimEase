-- ClaimEase tables (PS5 Expense Claim Assistant). Run this first, then seed_data.sql.
create table if not exists employees (
  id          text primary key,
  name        text not null,
  email       text not null unique,
  grade       text not null check (grade in ('L1','L2','L3','L4')),
  department  text not null,
  role        text not null default 'employee' check (role in ('employee','finance'))
);

create table if not exists policy_rules (
  id          bigint generated always as identity primary key,
  category    text not null,
  grade       text not null check (grade in ('L1','L2','L3','L4')),
  city_tier   text not null default 'any' check (city_tier in ('any','metro','other')),
  max_amount  integer not null check (max_amount > 0),
  unit        text not null default 'per_claim' check (unit in ('per_claim','per_night')),
  notes       text,
  unique (category, grade, city_tier)
);

create table if not exists claims (
  id            bigint generated always as identity primary key,
  employee_id   text not null references employees(id),
  category      text not null,
  description   text not null,
  amount        numeric(12,2) not null check (amount > 0),
  units         integer not null default 1 check (units >= 1),
  city          text,
  expense_date  date not null,
  submitted_at  timestamptz not null default now(),
  status        text not null check (status in ('pending','flagged','approved','rejected')),
  flag_reason   text,
  policy_limit  integer,
  reviewed_by   text references employees(id),
  reviewed_at   timestamptz,
  review_note   text
);

create index if not exists idx_claims_employee on claims (employee_id, id desc);
create index if not exists idx_claims_status   on claims (status);

-- RLS on with no policies: only the server (secret key) can read or write.
alter table employees    enable row level security;
alter table policy_rules enable row level security;
alter table claims       enable row level security;
