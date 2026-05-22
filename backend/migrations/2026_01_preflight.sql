-- ICME Preflight integration: store the cryptographic check_id from each
-- verified assistant message so proofs can be re-verified independently.
--
-- Run via the Supabase SQL editor after applying schema.sql.

alter table public.chat_messages
  add column if not exists preflight_check_id text,
  add column if not exists preflight_verdict  text,
  add column if not exists preflight_policy_id text,
  add column if not exists preflight_policy_version text;

create index if not exists idx_chat_messages_preflight_check
  on public.chat_messages(preflight_check_id);

comment on column public.chat_messages.preflight_check_id is
  'ICME Preflight check_id — cryptographic proof receipt for this message.';
comment on column public.chat_messages.preflight_verdict is
  'SAT (allowed), UNSAT (blocked), or ERROR (verification unavailable).';
