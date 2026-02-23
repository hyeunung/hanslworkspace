export interface ReceiptItem {
  id: string;
  receipt_image_url: string;
  file_name: string;
  file_size: number;
  uploaded_by: string;
  uploaded_by_name?: string;
  uploaded_at: string;
  memo?: string;
  purchase_request_id?: number | null;
  item_id?: number | null;
  description?: string;
  is_printed?: boolean;
  printed_at?: string;
  printed_by?: string;
  printed_by_name?: string;
  group_id?: string | null;
}

export interface ReceiptGroup {
  group_id: string | null;
  receipts: ReceiptItem[];
  primary: ReceiptItem;
  count: number;
}

export interface ReceiptUploadData {
  receipt_image_url: string;
  file_name: string;
  file_size: number;
  uploaded_by: string;
  uploaded_by_name?: string;
  memo?: string;
  purchase_request_id?: number | null;
  item_id?: number | null;
  description?: string;
}

export type UserRole = 'app_admin' | 'hr' | 'lead buyer' | string;

export interface ReceiptPermissions {
  canView: boolean;
  canUpload: boolean;
  canDownload: boolean;
  canPrint: boolean;
  canDelete: boolean;
  canViewUploaderInfo: boolean;
}