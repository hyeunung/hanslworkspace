alter table transaction_statement_items
  add column if not exists inferred_po_number text,
  add column if not exists inferred_po_source text,
  add column if not exists inferred_po_confidence numeric,
  add column if not exists inferred_po_group_id text;
