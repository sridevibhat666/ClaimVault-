-- Run this once in Supabase: SQL Editor -> New query -> paste -> Run
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  employee_name text not null,
  merchant text not null,
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'INR',
  expense_date date not null,
  category text not null default 'Other',
  description text not null default '',
  payment_method text not null default '',
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  source text not null default 'claude',
  review_note text not null default '',
  history jsonb not null default '[]'::jsonb
);

-- The app talks to the database only from the server using the service key,
-- so lock the table down for everyone else.
alter table public.expenses enable row level security;
