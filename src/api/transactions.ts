import { apiClient } from "./client";

export type TransactionType = "IN" | "OUT";

export interface Transaction {
  id: number;
  type: TransactionType;
  material_id: number;
  location_id: number;
  quantity: number;
  operator_id: number | null;
  department_id: number | null;
  recipient_id: number | null;
  partner_id?: number | null;
  timestamp: string;
  note: string | null;
  material_name: string;
  material_code: string;
  image_url?: string | null;
  location_name: string;
  operator_name: string | null;
  department_name: string | null;
  recipient_name: string | null;
  partner_name?: string | null;
  reverted?: number;
}

export interface TransactionQuery {
  type?: "IN" | "OUT";
  material_id?: number;
  location_id?: number;
  start_date?: string;
  end_date?: string;
  keyword?: string;
  limit?: number;
  page?: number;
  pageSize?: number;
}

export function getTransactions(params?: TransactionQuery) {
  const sp = new URLSearchParams();
  if (params?.type) sp.set("type", params.type);
  if (params?.material_id) sp.set("material_id", String(params.material_id));
  if (params?.location_id) sp.set("location_id", String(params.location_id));
  if (params?.start_date) sp.set("start_date", params.start_date);
  if (params?.end_date) sp.set("end_date", params.end_date);
  if (params?.keyword) sp.set("keyword", params.keyword);
  if (params?.limit) sp.set("limit", String(params.limit));
  if (params?.page) sp.set("page", String(params.page));
  if (params?.pageSize) sp.set("pageSize", String(params.pageSize));
  const q = sp.toString();
  return apiClient.get<Transaction[] | { data: Transaction[]; total: number; page: number; pageSize: number }>(
    `/api/transactions${q ? "?" + q : ""}`
  );
}

export function createTransaction(item: {
  type: TransactionType;
  material_id: number;
  location_id: number;
  quantity: number;
  operator_id?: number | null;
  department_id?: number | null;
  recipient_id?: number | null;
  partner_id?: number | null;
  note?: string | null;
}) {
  return apiClient.post<{ success: boolean; ids: number | number[] }>("/api/transactions", item);
}

export function createTransactionBatch(items: Parameters<typeof createTransaction>[0][]) {
  return apiClient.post<{ success: boolean; ids: number[] }>("/api/transactions", { items });
}

export function undoTransaction(id: number) {
  return apiClient.post<{ success: boolean }>(`/api/transactions/${id}/undo`, {});
}

