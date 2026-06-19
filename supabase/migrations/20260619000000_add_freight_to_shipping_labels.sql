ALTER TABLE shipping_labels DROP CONSTRAINT IF EXISTS shipping_labels_delivery_type_check;
ALTER TABLE shipping_labels ADD CONSTRAINT shipping_labels_delivery_type_check CHECK (delivery_type = ANY (ARRAY['택배'::text, '퀵'::text, '화물'::text]));
