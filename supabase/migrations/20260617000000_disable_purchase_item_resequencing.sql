-- Drop the trigger that re-aligns/re-sequences line_number on item soft-deletion
DROP TRIGGER IF EXISTS trg_resequence_items_on_soft_delete ON public.purchase_request_items;

-- Drop the restrictive SELECT policy so that soft-deleted items can be fetched by authenticated users
DROP POLICY IF EXISTS hide_soft_deleted_purchase_request_items ON public.purchase_request_items;
