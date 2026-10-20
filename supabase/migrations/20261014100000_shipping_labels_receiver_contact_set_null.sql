-- 택배 주소록 연락처 삭제 허용: 과거 발송기록(shipping_labels)이 걸려 있어도 삭제 가능하도록
-- receiver_contact_id NULL 허용 + ON DELETE SET NULL. 수신처 정보는 notes에 텍스트로 남긴다.
ALTER TABLE public.shipping_labels ALTER COLUMN receiver_contact_id DROP NOT NULL;

ALTER TABLE public.shipping_labels DROP CONSTRAINT shipping_labels_receiver_contact_id_fkey;
ALTER TABLE public.shipping_labels
  ADD CONSTRAINT shipping_labels_receiver_contact_id_fkey
  FOREIGN KEY (receiver_contact_id) REFERENCES public.shipping_contacts(id) ON DELETE SET NULL;
