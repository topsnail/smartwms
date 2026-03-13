import { apiClient } from "./client";

export interface DashboardStats {
  totalMaterials: number;
  totalStock: number;
  todayIn: number;
  todayOut: number;
  weekIn: number;
  weekOut: number;
  monthIn: number;
  monthOut: number;
  lowStock: {
    material_id: number;
    location_id: number;
    code: string;
    name: string;
    spec?: string;
    unit?: string;
    location_name: string;
    quantity: number;
    min_stock: number;
    max_stock: number;
  }[];
  locationCount: number;
  partnerTop: { name: string; cnt: number }[];
  inventoryValue: number;
  recentTransactions: {
    id: number;
    type: "IN" | "OUT";
    quantity: number;
    timestamp: string;
    note?: string | null;
    material_name: string;
    material_code: string;
    location_name: string;
  }[];
  trend7: { date: string; in_count: number; out_count: number }[];
  trend30: { date: string; in_count: number; out_count: number }[];
}

export function getDashboardStats(): Promise<DashboardStats> {
  return apiClient.get<DashboardStats>("/api/dashboard/stats");
}
