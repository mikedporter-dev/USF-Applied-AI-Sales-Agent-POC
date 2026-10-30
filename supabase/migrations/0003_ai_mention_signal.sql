-- A weaker signal kind: AI named as a priority or capability with nothing
-- concrete behind it. Scored at 5 Intent points each, 10 at most.
-- Run on its own: Postgres won't use a new enum value in the transaction that adds it.

alter type signal_kind add value if not exists 'ai_mention' after 'ai_commitment';
