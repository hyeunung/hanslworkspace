-- Fix: Preserve manually entered amount_value when unit_price_value is 0 or NULL
-- Background: A trigger was overwriting amount_value with quantity * unit_price_value.
-- Requirement: When unit_price_value is missing/0, allow entering amount_value directly.

CREATE OR REPLACE FUNCTION public.calc_amount_value_on_items()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  -- If unit price is 0/NULL, keep amount_value as provided (default to 0 if missing)
  IF COALESCE(NEW.unit_price_value, 0) = 0 THEN
    NEW.amount_value := COALESCE(NEW.amount_value, 0);
  ELSE
    NEW.amount_value := COALESCE(NEW.quantity, 0) * COALESCE(NEW.unit_price_value, 0);
  END IF;

  RETURN NEW;
END;
$function$;


