export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "12.2.3 (519615d)"
  }
  public: {
    Tables: {
      app_settings: {
        Row: {
          created_at: string | null
          key: string
          updated_at: string | null
          value: string
        }
        Insert: {
          created_at?: string | null
          key: string
          updated_at?: string | null
          value: string
        }
        Update: {
          created_at?: string | null
          key?: string
          updated_at?: string | null
          value?: string
        }
        Relationships: []
      }
      attendance_records: {
        Row: {
          clock_in: string | null
          clock_out: string | null
          created_at: string | null
          date: string
          employee_id: string
          employee_name: string | null
          id: number
          note: string | null
          remarks: string | null
          status: string | null
          updated_at: string | null
          user_email: string | null
        }
        Insert: {
          clock_in?: string | null
          clock_out?: string | null
          created_at?: string | null
          date: string
          employee_id: string
          employee_name?: string | null
          id?: number
          note?: string | null
          remarks?: string | null
          status?: string | null
          updated_at?: string | null
          user_email?: string | null
        }
        Update: {
          clock_in?: string | null
          clock_out?: string | null
          created_at?: string | null
          date?: string
          employee_id?: string
          employee_name?: string | null
          id?: number
          note?: string | null
          remarks?: string | null
          status?: string | null
          updated_at?: string | null
          user_email?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_records_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_is_app_admin"
            referencedColumns: ["employee_id"]
          },
        ]
      }
      employees: {
        Row: {
          adress: string | null
          annual_leave_granted_current_year: number | null
          attendance_role: string[] | null
          bank_account: string | null
          birthday: string | null
          department: string | null
          email: string | null
          employeeID: string | null
          fcm_token: string | null
          id: string
          is_admin: boolean | null
          is_active: boolean
          join_date: string | null
          name: string | null
          phone: string | null
          position: string | null
          purchase_role: string[] | null
          remaining_annual_leave: number | null
          role: string | null
          terminated_at: string | null
          updated_at: string | null
          used_annual_leave: number | null
        }
        Insert: {
          adress?: string | null
          annual_leave_granted_current_year?: number | null
          attendance_role?: string[] | null
          bank_account?: string | null
          birthday?: string | null
          department?: string | null
          email?: string | null
          employeeID?: string | null
          fcm_token?: string | null
          id?: string
          is_admin?: boolean | null
          is_active?: boolean
          join_date?: string | null
          name?: string | null
          phone?: string | null
          position?: string | null
          purchase_role?: string[] | null
          remaining_annual_leave?: number | null
          role?: string | null
          terminated_at?: string | null
          updated_at?: string | null
          used_annual_leave?: number | null
        }
        Update: {
          adress?: string | null
          annual_leave_granted_current_year?: number | null
          attendance_role?: string[] | null
          bank_account?: string | null
          birthday?: string | null
          department?: string | null
          email?: string | null
          employeeID?: string | null
          fcm_token?: string | null
          id?: string
          is_admin?: boolean | null
          is_active?: boolean
          join_date?: string | null
          name?: string | null
          phone?: string | null
          position?: string | null
          purchase_role?: string[] | null
          remaining_annual_leave?: number | null
          role?: string | null
          terminated_at?: string | null
          updated_at?: string | null
          used_annual_leave?: number | null
        }
        Relationships: []
      }
      holidays: {
        Row: {
          created_at: string | null
          date: string
          id: string
          is_alternative: boolean | null
          is_lunar: boolean | null
          name: string
          updated_at: string | null
          year: number
        }
        Insert: {
          created_at?: string | null
          date: string
          id?: string
          is_alternative?: boolean | null
          is_lunar?: boolean | null
          name: string
          updated_at?: string | null
          year: number
        }
        Update: {
          created_at?: string | null
          date?: string
          id?: string
          is_alternative?: boolean | null
          is_lunar?: boolean | null
          name?: string
          updated_at?: string | null
          year?: number
        }
        Relationships: []
      }
      leave: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string | null
          end_date: string
          end_day_of_week: string | null
          id: number
          name: string | null
          position: string | null
          reason: string | null
          rejected_at: string | null
          rejected_by: string | null
          start_date: string
          start_day_of_week: string | null
          status: string
          type: string
          updated_at: string | null
          user_email: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          end_date: string
          end_day_of_week?: string | null
          id?: number
          name?: string | null
          position?: string | null
          reason?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          start_date: string
          start_day_of_week?: string | null
          status?: string
          type: string
          updated_at?: string | null
          user_email: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          end_date?: string
          end_day_of_week?: string | null
          id?: number
          name?: string | null
          position?: string | null
          reason?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          start_date?: string
          start_day_of_week?: string | null
          status?: string
          type?: string
          updated_at?: string | null
          user_email?: string
        }
        Relationships: []
      }
      monthly_attendance: {
        Row: {
          attendance_days: number | null
          created_at: string | null
          earned_leave_days: number | null
          employee_id: string
          id: number
          is_full_attendance: boolean | null
          month: number
          updated_at: string | null
          work_days: number | null
          year: number
        }
        Insert: {
          attendance_days?: number | null
          created_at?: string | null
          earned_leave_days?: number | null
          employee_id: string
          id?: number
          is_full_attendance?: boolean | null
          month: number
          updated_at?: string | null
          work_days?: number | null
          year: number
        }
        Update: {
          attendance_days?: number | null
          created_at?: string | null
          earned_leave_days?: number | null
          employee_id?: string
          id?: number
          is_full_attendance?: boolean | null
          month?: number
          updated_at?: string | null
          work_days?: number | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "monthly_attendance_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_attendance_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_is_app_admin"
            referencedColumns: ["employee_id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          created_at: string | null
          data: Json | null
          id: number
          is_read: boolean | null
          read_at: string | null
          title: string
          type: string
          user_email: string
        }
        Insert: {
          body: string
          created_at?: string | null
          data?: Json | null
          id?: number
          is_read?: boolean | null
          read_at?: string | null
          title: string
          type: string
          user_email: string
        }
        Update: {
          body?: string
          created_at?: string | null
          data?: Json | null
          id?: number
          is_read?: boolean | null
          read_at?: string | null
          title?: string
          type?: string
          user_email?: string
        }
        Relationships: []
      }
      purchase_receipts: {
        Row: {
          created_at: string
          card_last_digits: string | null
          dining_date: string | null
          expense_amount: number | null
          file_name: string | null
          file_size: number | null
          id: number
          is_printed: boolean | null
          participants: string | null
          memo: string | null
          printed_at: string | null
          printed_by: string | null
          printed_by_name: string | null
          receipt_image_url: string
          uploaded_at: string
          uploaded_by: string | null
          uploaded_by_name: string | null
        }
        Insert: {
          created_at?: string
          card_last_digits?: string | null
          dining_date?: string | null
          expense_amount?: number | null
          file_name?: string | null
          file_size?: number | null
          id?: never
          is_printed?: boolean | null
          participants?: string | null
          memo?: string | null
          printed_at?: string | null
          printed_by?: string | null
          printed_by_name?: string | null
          receipt_image_url: string
          uploaded_at?: string
          uploaded_by?: string | null
          uploaded_by_name?: string | null
        }
        Update: {
          created_at?: string
          card_last_digits?: string | null
          dining_date?: string | null
          expense_amount?: number | null
          file_name?: string | null
          file_size?: number | null
          id?: never
          is_printed?: boolean | null
          participants?: string | null
          memo?: string | null
          printed_at?: string | null
          printed_by?: string | null
          printed_by_name?: string | null
          receipt_image_url?: string
          uploaded_at?: string
          uploaded_by?: string | null
          uploaded_by_name?: string | null
        }
        Relationships: []
      }
      purchase_request_items: {
        Row: {
          actual_received_date: string | null
          amount_currency: string
          amount_value: number
          created_at: string | null
          delivery_notes: string | null
          delivery_status: string | null
          id: number
          is_payment_completed: boolean | null
          is_received: boolean | null
          item_name: string
          line_number: number
          link: string | null
          payment_completed_at: string | null
          payment_completed_by_name: string | null
          purchase_order_number: string | null
          purchase_request_id: number
          quantity: number
          received_at: string | null
          received_by: string | null
          received_by_name: string | null
          received_date: string | null
          received_quantity: number | null
          remark: string | null
          requester_name: string | null
          specification: string | null
          unit_price_currency: string
          unit_price_value: number
          updated_at: string | null
          vendor_name: string | null
        }
        Insert: {
          actual_received_date?: string | null
          amount_currency: string
          amount_value: number
          created_at?: string | null
          delivery_notes?: string | null
          delivery_status?: string | null
          id?: never
          is_payment_completed?: boolean | null
          is_received?: boolean | null
          item_name: string
          line_number: number
          link?: string | null
          payment_completed_at?: string | null
          payment_completed_by_name?: string | null
          purchase_order_number?: string | null
          purchase_request_id: number
          quantity: number
          received_at?: string | null
          received_by?: string | null
          received_by_name?: string | null
          received_date?: string | null
          received_quantity?: number | null
          remark?: string | null
          requester_name?: string | null
          specification?: string | null
          unit_price_currency: string
          unit_price_value: number
          updated_at?: string | null
          vendor_name?: string | null
        }
        Update: {
          actual_received_date?: string | null
          amount_currency?: string
          amount_value?: number
          created_at?: string | null
          delivery_notes?: string | null
          delivery_status?: string | null
          id?: never
          is_payment_completed?: boolean | null
          is_received?: boolean | null
          item_name?: string
          line_number?: number
          link?: string | null
          payment_completed_at?: string | null
          payment_completed_by_name?: string | null
          purchase_order_number?: string | null
          purchase_request_id?: number
          quantity?: number
          received_at?: string | null
          received_by?: string | null
          received_by_name?: string | null
          received_date?: string | null
          received_quantity?: number | null
          remark?: string | null
          requester_name?: string | null
          specification?: string | null
          unit_price_currency?: string
          unit_price_value?: number
          updated_at?: string | null
          vendor_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_request_items_purchase_request_id_fkey"
            columns: ["purchase_request_id"]
            isOneToOne: false
            referencedRelation: "purchase_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_request_items_purchase_request_id_fkey"
            columns: ["purchase_request_id"]
            isOneToOne: false
            referencedRelation: "purchase_requests_korean_time"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_request_items_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_request_items_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "v_is_app_admin"
            referencedColumns: ["employee_id"]
          },
        ]
      }
      purchase_requests: {
        Row: {
          contact_id: number | null
          created_at: string | null
          currency: string
          delivery_request_date: string | null
          final_manager_approved_at: string | null
          final_manager_rejected_at: string | null
          final_manager_rejection_reason: string | null
          final_manager_status: string | null
          id: number
          is_payment_completed: boolean | null
          is_po_download: boolean | null
          is_received: boolean | null
          middle_manager_approved_at: string | null
          middle_manager_rejected_at: string | null
          middle_manager_rejection_reason: string | null
          middle_manager_status: string | null
          payment_category: string
          payment_completed_at: string | null
          payment_completed_by_name: string | null
          po_template_type: string
          progress_type: string
          project_item: string | null
          project_vendor: string | null
          purchase_order_number: string
          received_at: string | null
          request_date: string | null
          request_type: string
          requester_address: string | null
          requester_fax: string | null
          requester_id: string | null
          requester_name: string
          requester_phone: string | null
          revised_delivery_request_date: string | null
          sales_order_number: string | null
          total_amount: number | null
          unit_price_currency: string
          updated_at: string | null
          vendor_id: number
          vendor_name: string | null
        }
        Insert: {
          contact_id?: number | null
          created_at?: string | null
          currency: string
          delivery_request_date?: string | null
          final_manager_approved_at?: string | null
          final_manager_rejected_at?: string | null
          final_manager_rejection_reason?: string | null
          final_manager_status?: string | null
          id?: never
          is_payment_completed?: boolean | null
          is_po_download?: boolean | null
          is_received?: boolean | null
          middle_manager_approved_at?: string | null
          middle_manager_rejected_at?: string | null
          middle_manager_rejection_reason?: string | null
          middle_manager_status?: string | null
          payment_category: string
          payment_completed_at?: string | null
          payment_completed_by_name?: string | null
          po_template_type: string
          progress_type: string
          project_item?: string | null
          project_vendor?: string | null
          purchase_order_number: string
          received_at?: string | null
          request_date?: string | null
          request_type?: string
          requester_address?: string | null
          requester_fax?: string | null
          requester_id?: string | null
          requester_name: string
          requester_phone?: string | null
          revised_delivery_request_date?: string | null
          sales_order_number?: string | null
          total_amount?: number | null
          unit_price_currency: string
          updated_at?: string | null
          vendor_id: number
          vendor_name?: string | null
        }
        Update: {
          contact_id?: number | null
          created_at?: string | null
          currency?: string
          delivery_request_date?: string | null
          final_manager_approved_at?: string | null
          final_manager_rejected_at?: string | null
          final_manager_rejection_reason?: string | null
          final_manager_status?: string | null
          id?: never
          is_payment_completed?: boolean | null
          is_po_download?: boolean | null
          is_received?: boolean | null
          middle_manager_approved_at?: string | null
          middle_manager_rejected_at?: string | null
          middle_manager_rejection_reason?: string | null
          middle_manager_status?: string | null
          payment_category?: string
          payment_completed_at?: string | null
          payment_completed_by_name?: string | null
          po_template_type?: string
          progress_type?: string
          project_item?: string | null
          project_vendor?: string | null
          purchase_order_number?: string
          received_at?: string | null
          request_date?: string | null
          request_type?: string
          requester_address?: string | null
          requester_fax?: string | null
          requester_id?: string | null
          requester_name?: string
          requester_phone?: string | null
          revised_delivery_request_date?: string | null
          sales_order_number?: string | null
          total_amount?: number | null
          unit_price_currency?: string
          updated_at?: string | null
          vendor_id?: number
          vendor_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_requests_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "vendor_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_requests_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "vendor_contacts_with_vendor_name"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_requests_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      support_inquires: {
        Row: {
          created_at: string
          handled_by: string | null
          id: number
          inquiry_type: string
          inquiry_payload: Json | null
          message: string
          processed_at: string | null
          purchase_info: string | null
          purchase_order_number: string | null
          purchase_request_id: number | null
          requester_id: string | null
          resolution_note: string | null
          status: string
          subject: string
          updated_at: string
          user_email: string
          user_id: string | null
          user_name: string
        }
        Insert: {
          created_at?: string
          handled_by?: string | null
          id?: number
          inquiry_type: string
          inquiry_payload?: Json | null
          message: string
          processed_at?: string | null
          purchase_info?: string | null
          purchase_order_number?: string | null
          purchase_request_id?: number | null
          requester_id?: string | null
          resolution_note?: string | null
          status?: string
          subject: string
          updated_at?: string
          user_email: string
          user_id?: string | null
          user_name: string
        }
        Update: {
          created_at?: string
          handled_by?: string | null
          id?: number
          inquiry_type?: string
          inquiry_payload?: Json | null
          message?: string
          processed_at?: string | null
          purchase_info?: string | null
          purchase_order_number?: string | null
          purchase_request_id?: number | null
          requester_id?: string | null
          resolution_note?: string | null
          status?: string
          subject?: string
          updated_at?: string
          user_email?: string
          user_id?: string | null
          user_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_inquiries_purchase_request_id_fkey"
            columns: ["purchase_request_id"]
            isOneToOne: false
            referencedRelation: "purchase_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_inquiries_purchase_request_id_fkey"
            columns: ["purchase_request_id"]
            isOneToOne: false
            referencedRelation: "purchase_requests_korean_time"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_inquiries_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_inquiries_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "v_is_app_admin"
            referencedColumns: ["employee_id"]
          },
        ]
      }
      user_preferences: {
        Row: {
          period_end: string | null
          period_start: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          period_end?: string | null
          period_start?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          period_end?: string | null
          period_start?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      vendor_contacts: {
        Row: {
          contact_email: string
          contact_name: string
          contact_phone: string | null
          created_at: string | null
          id: number
          position: string | null
          updated_at: string | null
          vendor_id: number
        }
        Insert: {
          contact_email: string
          contact_name: string
          contact_phone?: string | null
          created_at?: string | null
          id?: never
          position?: string | null
          updated_at?: string | null
          vendor_id: number
        }
        Update: {
          contact_email?: string
          contact_name?: string
          contact_phone?: string | null
          created_at?: string | null
          id?: never
          position?: string | null
          updated_at?: string | null
          vendor_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "vendor_contacts_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      vendors: {
        Row: {
          created_at: string | null
          id: number
          note: string | null
          updated_at: string | null
          vendor_address: string | null
          vendor_fax: string | null
          vendor_name: string
          vendor_payment_schedule: string | null
          vendor_phone: string | null
        }
        Insert: {
          created_at?: string | null
          id?: never
          note?: string | null
          updated_at?: string | null
          vendor_address?: string | null
          vendor_fax?: string | null
          vendor_name: string
          vendor_payment_schedule?: string | null
          vendor_phone?: string | null
        }
        Update: {
          created_at?: string | null
          id?: never
          note?: string | null
          updated_at?: string | null
          vendor_address?: string | null
          vendor_fax?: string | null
          vendor_name?: string
          vendor_payment_schedule?: string | null
          vendor_phone?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      purchase_requests_korean_time: {
        Row: {
          contact_id: number | null
          created_at: string | null
          created_at_korean: string | null
          currency: string | null
          delivery_request_date: string | null
          final_manager_approved_at: string | null
          final_manager_rejected_at: string | null
          final_manager_rejection_reason: string | null
          final_manager_status: string | null
          id: number | null
          is_payment_completed: boolean | null
          is_po_download: boolean | null
          is_received: boolean | null
          middle_manager_approved_at: string | null
          middle_manager_rejected_at: string | null
          middle_manager_rejection_reason: string | null
          middle_manager_status: string | null
          payment_category: string | null
          payment_completed_at: string | null
          po_template_type: string | null
          progress_type: string | null
          project_item: string | null
          project_vendor: string | null
          purchase_order_number: string | null
          received_at: string | null
          request_date: string | null
          request_type: string | null
          requester_address: string | null
          requester_fax: string | null
          requester_id: string | null
          requester_name: string | null
          requester_phone: string | null
          revised_delivery_request_date: string | null
          sales_order_number: string | null
          total_amount: number | null
          unit_price_currency: string | null
          updated_at: string | null
          updated_at_korean: string | null
          vendor_id: number | null
          vendor_name: string | null
        }
        Insert: {
          contact_id?: number | null
          created_at?: string | null
          created_at_korean?: never
          currency?: string | null
          delivery_request_date?: string | null
          final_manager_approved_at?: string | null
          final_manager_rejected_at?: string | null
          final_manager_rejection_reason?: string | null
          final_manager_status?: string | null
          id?: number | null
          is_payment_completed?: boolean | null
          is_po_download?: boolean | null
          is_received?: boolean | null
          middle_manager_approved_at?: string | null
          middle_manager_rejected_at?: string | null
          middle_manager_rejection_reason?: string | null
          middle_manager_status?: string | null
          payment_category?: string | null
          payment_completed_at?: string | null
          po_template_type?: string | null
          progress_type?: string | null
          project_item?: string | null
          project_vendor?: string | null
          purchase_order_number?: string | null
          received_at?: string | null
          request_date?: string | null
          request_type?: string | null
          requester_address?: string | null
          requester_fax?: string | null
          requester_id?: string | null
          requester_name?: string | null
          requester_phone?: string | null
          revised_delivery_request_date?: string | null
          sales_order_number?: string | null
          total_amount?: number | null
          unit_price_currency?: string | null
          updated_at?: string | null
          updated_at_korean?: never
          vendor_id?: number | null
          vendor_name?: string | null
        }
        Update: {
          contact_id?: number | null
          created_at?: string | null
          created_at_korean?: never
          currency?: string | null
          delivery_request_date?: string | null
          final_manager_approved_at?: string | null
          final_manager_rejected_at?: string | null
          final_manager_rejection_reason?: string | null
          final_manager_status?: string | null
          id?: number | null
          is_payment_completed?: boolean | null
          is_po_download?: boolean | null
          is_received?: boolean | null
          middle_manager_approved_at?: string | null
          middle_manager_rejected_at?: string | null
          middle_manager_rejection_reason?: string | null
          middle_manager_status?: string | null
          payment_category?: string | null
          payment_completed_at?: string | null
          po_template_type?: string | null
          progress_type?: string | null
          project_item?: string | null
          project_vendor?: string | null
          purchase_order_number?: string | null
          received_at?: string | null
          request_date?: string | null
          request_type?: string | null
          requester_address?: string | null
          requester_fax?: string | null
          requester_id?: string | null
          requester_name?: string | null
          requester_phone?: string | null
          revised_delivery_request_date?: string | null
          sales_order_number?: string | null
          total_amount?: number | null
          unit_price_currency?: string | null
          updated_at?: string | null
          updated_at_korean?: never
          vendor_id?: number | null
          vendor_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_requests_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "vendor_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_requests_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "vendor_contacts_with_vendor_name"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_requests_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      v_is_app_admin: {
        Row: {
          email: string | null
          employee_id: string | null
          is_app_admin: boolean | null
        }
        Insert: {
          email?: string | null
          employee_id?: string | null
          is_app_admin?: never
        }
        Update: {
          email?: string | null
          employee_id?: string | null
          is_app_admin?: never
        }
        Relationships: []
      }
      vendor_contacts_with_vendor_name: {
        Row: {
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string | null
          id: number | null
          position: string | null
          updated_at: string | null
          vendor_id: number | null
          vendor_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vendor_contacts_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      attendance_absent_today: { Args: never; Returns: Json }
      attendance_late_today: { Args: never; Returns: Json }
      attendance_summary_today: { Args: never; Returns: Json }
      call_edge_generate_po: {
        Args: { purchase_request_id: number }
        Returns: undefined
      }
      check_anniversary: { Args: never; Returns: undefined }
      debug_block_kit_structure: {
        Args: { purchase_id: number }
        Returns: Json
      }
      format_korea_time: { Args: { ts: string }; Returns: string }
      get_all_approved_leaves_for_stats: {
        Args: never
        Returns: {
          end_date: string
          start_date: string
          type: string
          user_email: string
        }[]
      }
      get_block_kit_sample: { Args: never; Returns: Json }
      get_employee_by_email: {
        Args: { email_param: string }
        Returns: {
          adress: string | null
          annual_leave_granted_current_year: number | null
          attendance_role: string[] | null
          bank_account: string | null
          birthday: string | null
          department: string | null
          email: string | null
          employeeID: string | null
          fcm_token: string | null
          id: string
          is_admin: boolean | null
          join_date: string | null
          name: string | null
          phone: string | null
          position: string | null
          purchase_role: string[] | null
          remaining_annual_leave: number | null
          role: string | null
          updated_at: string | null
          used_annual_leave: number | null
        }[]
        SetofOptions: {
          from: "*"
          to: "employees"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      grant_monthly_leave: { Args: never; Returns: undefined }
      korea_now: { Args: never; Returns: string }
      korean_time_now: { Args: never; Returns: string }
      load_app_settings: { Args: never; Returns: undefined }
      mark_item_as_received: {
        Args: { p_item_id: number; p_user_name: string }
        Returns: boolean
      }
      mark_receipt_as_printed: {
        Args: { receipt_id: number; user_email: string; user_name: string }
        Returns: Json
      }
      notify_inquiry_response: {
        Args: { p_inquiry_id: string; p_response: string }
        Returns: undefined
      }
      reset_annual_leave: { Args: never; Returns: undefined }
      run_annual_leave_automation: {
        Args: { task_name?: string }
        Returns: {
          message: string
          status: string
          task: string
        }[]
      }
      run_auto_clock_out_manually: { Args: never; Returns: Json }
      set_korea_timezone: { Args: never; Returns: undefined }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
