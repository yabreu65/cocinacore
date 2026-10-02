-- Migration 012: Durable planned-meal consumption state

alter table public.user_meal_plans
  add column consumption_payload jsonb not null default '{}'::jsonb;

comment on column public.user_meal_plans.consumption_payload is
  'Idempotent per-meal cooking confirmations and inventory consumption evidence.';
