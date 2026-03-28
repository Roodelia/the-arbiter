-- Run in Supabase SQL Editor (once) before relying on ip_address from POST /log
alter table public.cases
  add column if not exists ip_address text;

comment on column public.cases.ip_address is 'Client IP from X-Forwarded-For or connection (usage logging).';
