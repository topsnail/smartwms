import { apiClient } from "./client";

export interface OperationLog {
  id: number;
  action: string;
  description: string;
  operator?: string | null;
  old_value?: string | null;
  new_value?: string | null;
  client_ip?: string | null;
  created_at: string;
}

export interface OperationLogQuery {
  action?: string;
  actions?: string[];
  operator?: string;
  keyword?: string;
  client_ip?: string;
  module?: string;
  start_date?: string;
  end_date?: string;
  limit?: number;
  page?: number;
  pageSize?: number;
}

export function getOperationLogs(params?: OperationLogQuery) {
  const sp = new URLSearchParams();
  if (params?.action) sp.set("action", params.action);
  if (params?.actions?.length) sp.set("actions", params.actions.join(","));
  if (params?.operator) sp.set("operator", params.operator);
  if (params?.keyword) sp.set("keyword", params.keyword);
  if (params?.client_ip) sp.set("client_ip", params.client_ip);
  if (params?.module) sp.set("module", params.module);
  if (params?.start_date) sp.set("start_date", params.start_date);
  if (params?.end_date) sp.set("end_date", params.end_date);
  if (params?.limit) sp.set("limit", String(params.limit));
  if (params?.page) sp.set("page", String(params.page));
  if (params?.pageSize) sp.set("pageSize", String(params.pageSize));
  const q = sp.toString();
  return apiClient.get<OperationLog[] | { data: OperationLog[]; total: number; page: number; pageSize: number }>(
    `/api/operation-logs${q ? "?" + q : ""}`
  );
}

