import { apiClient } from "./client";

export interface Material {
  id: number;
  code?: string | null;
  name: string;
  spec?: string | null;
  unit?: string | null;
  category?: string | null;
  category_id?: number | null;
  category_name?: string | null;
  image_url?: string | null;
  source?: string | null;
  purchase_price?: number | null;
  sale_price?: number | null;
  created_at?: string;
}

export interface SaveMaterialInput {
  code?: string;
  name: string;
  spec?: string;
  unit?: string;
  category?: string;
  category_id?: number;
  source?: string;
  purchase_price?: number;
  sale_price?: number;
  image_url?: string;
}

export function getMaterials() {
  return apiClient.get<Material[]>("/api/materials");
}

export function createMaterial(input: SaveMaterialInput) {
  return apiClient.post<{ id: number }>("/api/materials", input);
}

export function updateMaterial(id: number, input: SaveMaterialInput) {
  return apiClient.put<{ success: boolean }>(`/api/materials/${id}`, input);
}

export function deleteMaterial(id: number) {
  return apiClient.delete<{ success: boolean }>(`/api/materials/${id}`);
}

export function batchDeleteMaterials(ids: number[]) {
  return apiClient.post<{
    success: boolean;
    deletedCount: number;
    skippedCount?: number;
    deletedMaterials: { id: number; name: string; code: string }[];
  }>('/api/materials/batch-delete', { ids });
}

export function checkMaterialCode(code: string, excludeId?: number) {
  const params = new URLSearchParams();
  params.set('code', code);
  if (excludeId != null) params.set('exclude_id', String(excludeId));
  return apiClient.get<{ available: boolean; error?: string }>(`/api/materials/check-code?${params}`);
}

export function checkMaterialName(name: string, excludeId?: number) {
  const params = new URLSearchParams();
  params.set('name', name);
  if (excludeId != null) params.set('exclude_id', String(excludeId));
  return apiClient.get<{ available: boolean; error?: string }>(`/api/materials/check-name?${params}`);
}

export function canDeleteMaterial(id: number) {
  return apiClient.get<{ canDelete: boolean; stockTotal: number; transactionCount: number; reason?: string }>(`/api/materials/${id}/can-delete`);
}

export function batchCanDeleteMaterials(ids: number[]) {
  return apiClient.get<{
    results: { id: number; canDelete: boolean; stockTotal: number; reason?: string }[];
  }>(`/api/materials/batch-can-delete?ids=${ids.join(',')}`);
}

export function batchUpdateMaterials(ids: number[], updates: { category_id?: number | null; unit?: string; source?: string }) {
  return apiClient.post<{ success: boolean; updatedCount: number }>('/api/materials/batch-update', { ids, updates });
}

export async function exportMaterials(): Promise<Blob> {
  return apiClient.getBlob('/api/export/materials', { timeoutMs: 180_000 });
}

export function batchImportMaterials(materials: SaveMaterialInput[]) {
  return apiClient.post<{
    success: boolean;
    successCount: number;
    failedCount: number;
    failedItems: { item: SaveMaterialInput; error: string }[];
    skippedCount?: number;
  }>('/api/materials/batch-import', { materials });
}

