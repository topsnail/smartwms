export const PERMISSIONS = {
  // view
  view: "view",
  materials_view: "materials_view",
  inventory_view: "inventory_view",
  transactions_view: "transactions_view",
  logs_view: "logs_view",
  settings_view: "settings_view",
  view_reports: "view_reports",

  // transactions
  inbound: "inbound",
  outbound: "outbound",
  transactions_inbound: "transactions_inbound",
  transactions_outbound: "transactions_outbound",
  transactions_undo: "transactions_undo",

  // materials
  edit_material: "edit_material",
  delete_material: "delete_material",
  materials_edit: "materials_edit",
  materials_delete: "materials_delete",
  materials_import: "materials_import",
  upload_image: "upload_image",

  // inventory
  inventory_alert_edit: "inventory_alert_edit",

  // settings
  edit_settings: "edit_settings",
  delete_settings: "delete_settings",
  settings_edit: "settings_edit",
  settings_delete: "settings_delete",

  // export/backup
  export: "export",
  export_transactions: "export_transactions",
  export_operation_logs: "export_operation_logs",
  export_materials: "export_materials",
  export_inventory: "export_inventory",
  backup: "backup",
  backup_db: "backup_db",

  // accounts/permissions
  manage_accounts: "manage_accounts",
  manage_role_permissions: "manage_role_permissions",
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/**
 * 权限判断（带兼容映射）。前后端保持同一套规则，避免口径漂移。
 */
export function hasPermission(perms: string[] | undefined, required: PermissionKey): boolean {
  if (!perms) return false;
  if (perms.includes("*")) return true;
  if (perms.includes(required)) return true;

  // 聚合权限（export_*）
  if (required === PERMISSIONS.export) return perms.some((p) => p.startsWith("export_"));
  if (required === PERMISSIONS.backup) return perms.includes(PERMISSIONS.backup_db);

  // 兼容：细粒度 -> 聚合
  if (required === PERMISSIONS.edit_material)
    return perms.includes(PERMISSIONS.materials_edit) || perms.includes(PERMISSIONS.materials_import) || perms.includes(PERMISSIONS.upload_image);
  if (required === PERMISSIONS.delete_material) return perms.includes(PERMISSIONS.materials_delete);
  if (required === PERMISSIONS.edit_settings) return perms.includes(PERMISSIONS.settings_edit);
  if (required === PERMISSIONS.delete_settings) return perms.includes(PERMISSIONS.settings_delete);
  if (required === PERMISSIONS.inbound) return perms.includes(PERMISSIONS.transactions_inbound);
  if (required === PERMISSIONS.outbound) return perms.includes(PERMISSIONS.transactions_outbound);

  // 兼容：聚合 -> 细粒度
  if (
    required === PERMISSIONS.export_materials ||
    required === PERMISSIONS.export_inventory ||
    required === PERMISSIONS.export_transactions ||
    required === PERMISSIONS.export_operation_logs
  ) {
    return perms.includes(PERMISSIONS.export);
  }
  if (required === PERMISSIONS.backup_db) return perms.includes(PERMISSIONS.backup);
  if (required === PERMISSIONS.materials_edit || required === PERMISSIONS.materials_import || required === PERMISSIONS.upload_image)
    return perms.includes(PERMISSIONS.edit_material);
  if (required === PERMISSIONS.materials_delete) return perms.includes(PERMISSIONS.delete_material);
  if (required === PERMISSIONS.settings_edit) return perms.includes(PERMISSIONS.edit_settings);
  if (required === PERMISSIONS.settings_delete) return perms.includes(PERMISSIONS.delete_settings);
  if (required === PERMISSIONS.transactions_inbound) return perms.includes(PERMISSIONS.inbound);
  if (required === PERMISSIONS.transactions_outbound) return perms.includes(PERMISSIONS.outbound);

  return false;
}

