export const ACTION_LABELS: Record<string, string> = {
  INBOUND: "入库记录",
  OUTBOUND: "出库记录",
  REVERT_TRANSACTION: "撤销出入库",

  CREATE_MATERIAL: "新增物料",
  UPDATE_MATERIAL: "编辑物料",
  DELETE_MATERIAL: "删除物料",

  CREATE_LOCATION: "新增存放位置",
  UPDATE_LOCATION: "编辑存放位置",
  DELETE_LOCATION: "删除存放位置",

  CREATE_UNIT: "新增计量单位",
  UPDATE_UNIT: "编辑计量单位",
  DELETE_UNIT: "删除计量单位",

  CREATE_STAFF: "新增人员",
  UPDATE_STAFF: "编辑人员",
  DELETE_STAFF: "删除人员",

  CREATE_DEPARTMENT: "新增领料部门",
  UPDATE_DEPARTMENT: "编辑领料部门",
  DELETE_DEPARTMENT: "删除领料部门",

  CREATE_REASON: "新增领用事由",
  UPDATE_REASON: "编辑领用事由",
  DELETE_REASON: "删除领用事由",

  CREATE_SOURCE: "新增物料来源",
  UPDATE_SOURCE: "编辑物料来源",
  DELETE_SOURCE: "删除物料来源",

  CREATE_CATEGORY: "新增物料分类",
  UPDATE_CATEGORY: "编辑物料分类",
  DELETE_CATEGORY: "删除物料分类",

  CREATE_PARTNER: "新增往来单位",
  UPDATE_PARTNER: "编辑往来单位",
  DELETE_PARTNER: "删除往来单位",

  CREATE_USER: "新增账号",
  UPDATE_USER: "编辑账号",
  DELETE_USER: "删除账号",
  RESET_USER_PASSWORD: "重置账号密码",

  UPDATE_ROLE_PERMISSIONS: "更新角色权限",
};

export const FIELD_LABELS: Record<string, string> = {
  code: "编码",
  name: "名称",
  spec: "规格",
  unit: "单位",
  category: "分类",
  role: "角色",
  category_id: "分类",
  parent_id: "父分类",
  description: "描述",
  source: "来源",
  purchase_price: "购价",
  sale_price: "售价",
  image_url: "图片",
  invoice_info: "开票信息",
  contact: "联系方式",
  mailing_address: "邮寄地址",
  partner_id: "往来单位",
};

export const ROLE_LABELS: Record<string, string> = {
  admin: "管理员",
  warehouse_keeper: "仓管员",
  reporter: "统计员",
  readonly: "只读",
};

export const PERMISSION_LABELS: Record<string, string> = {
  "*": "全部权限(*)",
  view: "基础浏览",
  view_reports: "查看报表",

  export: "导出（总开关）",
  export_transactions: "导出出入库记录",
  export_operation_logs: "导出操作日志",
  export_materials: "导出物料信息",
  export_inventory: "导出库存数据",

  backup: "备份（总开关）",
  backup_db: "备份数据库",

  inbound: "入库操作（兼容）",
  outbound: "出库操作（兼容）",
  transactions_inbound: "入库操作",
  transactions_outbound: "出库操作",
  transactions_undo: "撤销出入库（5 分钟内）",

  edit_material: "新增/编辑物料（兼容）",
  delete_material: "删除物料（兼容）",
  materials_view: "查看物料",
  materials_edit: "新增/编辑物料",
  materials_delete: "删除物料",
  materials_import: "导入物料",
  upload_image: "上传物料图片",

  inventory_view: "查看库存",
  inventory_alert_edit: "设置库存预警",

  edit_settings: "新增/编辑基础资料（兼容）",
  delete_settings: "删除基础资料（兼容）",
  settings_view: "查看系统设置",
  settings_edit: "新增/编辑基础资料",
  settings_delete: "删除基础资料",

  logs_view: "查看操作日志",
  manage_accounts: "账号与权限管理",
  manage_role_permissions: "配置角色权限",
};

