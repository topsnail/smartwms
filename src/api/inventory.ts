import { apiClient } from "./client";

export interface InventoryItem {
  material_id: number;
  location_id: number;
  code: string;
  name: string;
  spec?: string | null;
  unit?: string | null;
  image_url?: string | null;
  location_name: string;
  quantity: number;
  min_stock: number;
  max_stock: number;
}

export function getInventory() {
  return apiClient.get<InventoryItem[]>("/api/inventory");
}

export function getStock(materialId: number, locationId: number) {
  return apiClient.get<{ quantity: number }>(`/api/inventory/stock?material_id=${materialId}&location_id=${locationId}`);
}

export function getInventoryAlerts() {
  return apiClient.get<InventoryItem[]>('/api/inventory/alert');
}

export function updateInventoryAlert(materialId: number, locationId: number, minStock: number, maxStock: number) {
  return apiClient.put<{ success: boolean }>(`/api/inventory/${materialId}/${locationId}`, { min_stock: minStock, max_stock: maxStock });
}

