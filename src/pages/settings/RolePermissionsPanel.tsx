import React from "react";
import { message } from "antd";
import { apiClient } from "../../api/client";

type PermissionItem = { key: string; label: string; desc?: string; group: string };
const PERMISSIONS: PermissionItem[] = [
  { key: "view", label: "基础浏览", desc: "可进入系统并查看基础页面内容。", group: "通用" },
  { key: "view_reports", label: "查看报表", desc: "可访问“报表分析”。", group: "通用" },

  { key: "export", label: "导出（总开关）", desc: "兼容旧权限：开启后允许各类 CSV 导出。", group: "通用" },
  { key: "export_transactions", label: "导出出入库记录", group: "导出" },
  { key: "export_operation_logs", label: "导出操作日志", group: "导出" },
  { key: "export_materials", label: "导出物料信息", group: "导出" },
  { key: "export_inventory", label: "导出库存数据", group: "导出" },

  { key: "backup", label: "备份（总开关）", desc: "兼容旧权限：允许下载数据库备份。", group: "通用" },
  { key: "backup_db", label: "备份数据库", group: "数据" },

  { key: "inbound", label: "入库操作（兼容）", group: "出入库" },
  { key: "outbound", label: "出库操作（兼容）", group: "出入库" },
  { key: "transactions_inbound", label: "入库操作", group: "出入库" },
  { key: "transactions_outbound", label: "出库操作", group: "出入库" },
  { key: "transactions_undo", label: "撤销出入库（5 分钟内）", group: "出入库" },

  { key: "edit_material", label: "新增/编辑物料（兼容）", group: "物料" },
  { key: "delete_material", label: "删除物料（兼容）", group: "物料" },
  { key: "materials_view", label: "查看物料", group: "物料" },
  { key: "materials_edit", label: "新增/编辑物料", group: "物料" },
  { key: "materials_delete", label: "删除物料", group: "物料" },
  { key: "materials_import", label: "导入物料", group: "物料" },
  { key: "upload_image", label: "上传物料图片", group: "物料" },

  { key: "inventory_view", label: "查看库存", group: "库存" },
  { key: "inventory_alert_edit", label: "设置库存预警", group: "库存" },

  { key: "edit_settings", label: "新增/编辑基础资料（兼容）", group: "设置" },
  { key: "delete_settings", label: "删除基础资料（兼容）", group: "设置" },
  { key: "settings_view", label: "查看系统设置", group: "设置" },
  { key: "settings_edit", label: "新增/编辑基础资料", group: "设置" },
  { key: "settings_delete", label: "删除基础资料", group: "设置" },

  { key: "logs_view", label: "查看操作日志", group: "日志" },

  { key: "manage_accounts", label: "账号与权限管理", group: "安全" },
  { key: "manage_role_permissions", label: "配置角色权限", group: "安全" },
];

const ROLE_LABELS: Record<string, string> = {
  admin: "管理员",
  warehouse_keeper: "仓管员",
  reporter: "统计员",
  readonly: "只读",
};

export function RolePermissionsPanel() {
  const [roles, setRoles] = React.useState<string[]>([]);
  const [permissionsByRole, setPermissionsByRole] = React.useState<Record<string, string[]>>({});
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const fetchData = React.useCallback(async () => {
    setLoading(true);
    try {
      const json = await apiClient.get<{ roles: string[]; permissionsByRole: Record<string, string[]> }>("/api/role-permissions");
      setRoles(json.roles || []);
      setPermissionsByRole(json.permissionsByRole || {});
    } catch (e: any) {
      message.error(e?.message || "加载角色权限失败");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  const toggle = (role: string, perm: string) => {
    setPermissionsByRole((prev) => {
      const cur = new Set(prev[role] || []);
      if (cur.has("*")) cur.delete("*"); // 避免与全权限冲突
      if (cur.has(perm)) cur.delete(perm);
      else cur.add(perm);
      return { ...prev, [role]: Array.from(cur) };
    });
  };

  const toggleAll = (role: string) => {
    setPermissionsByRole((prev) => {
      const cur = new Set(prev[role] || []);
      if (cur.has("*")) cur.delete("*");
      else {
        cur.clear();
        cur.add("*");
      }
      return { ...prev, [role]: Array.from(cur) };
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      await apiClient.put("/api/role-permissions", { permissionsByRole });
      message.success("角色权限已保存");
      fetchData();
    } catch (e: any) {
      message.error(e?.message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const grouped = PERMISSIONS.reduce<Record<string, typeof PERMISSIONS>>((acc, p) => {
    acc[p.group] = acc[p.group] || [];
    acc[p.group].push(p);
    return acc;
  }, {});

  if (loading) return <div className="text-slate-500">加载中...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-slate-500">
          说明：勾选后会同时影响前端按钮显示与后端接口鉴权。
        </div>
        <button
          onClick={save}
          disabled={saving}
          className={`btn-primary text-white text-sm ${saving ? "opacity-70 cursor-not-allowed" : ""}`}
          style={{ color: "#fff" }}
        >
          {saving ? "保存中..." : "保存配置"}
        </button>
      </div>

      <div className="overflow-x-auto border border-slate-200 rounded-xl">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left p-3">权限</th>
              {roles.map((r) => (
                <th key={r} className="text-center p-3 whitespace-nowrap">
                  {ROLE_LABELS[r] || r}
                  <div className="mt-2">
                    <button
                      onClick={() => toggleAll(r)}
                      className="text-xs px-2 py-1 rounded border border-slate-200 hover:bg-white"
                      title="切换该角色全权限(*)"
                    >
                      {permissionsByRole[r]?.includes("*") ? "取消全权限" : "全权限"}
                    </button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white">
            {Object.entries(grouped).map(([group, perms]) => (
              <React.Fragment key={group}>
                <tr className="border-t border-slate-100">
                  <td className="p-3 font-medium text-slate-700" colSpan={1 + roles.length}>
                    {group}
                  </td>
                </tr>
                {perms.map((p) => (
                  <tr key={p.key} className="border-t border-slate-100">
                    <td className="p-3 text-slate-800">
                      <div className="font-medium">{p.label}</div>
                      {p.desc ? <div className="text-xs text-slate-500 mt-0.5">{p.desc}</div> : null}
                    </td>
                    {roles.map((r) => {
                      const list = permissionsByRole[r] || [];
                      const checked = list.includes("*") || list.includes(p.key);
                      const disabled = list.includes("*");
                      return (
                        <td key={r} className="p-3 text-center">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={disabled}
                            onChange={() => toggle(r, p.key)}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

