import React from "react";
import { Plus, RefreshCw, Shield, Trash2, UserCog } from "lucide-react";
import { Button, Input, Modal, message } from "antd";
import { apiClient } from "../../api/client";
import { notifyError } from "../../utils/notify";
import type { UserRole, UserRow } from "./types";

const ROLE_LABEL: Record<UserRole, string> = {
  admin: "管理员",
  warehouse_keeper: "仓管员",
  reporter: "统计员",
  readonly: "只读",
};

const ROLES: UserRole[] = ["readonly", "reporter", "warehouse_keeper", "admin"];

function normalizeUser(input: any): UserRow {
  return {
    id: Number(input.id),
    username: String(input.username || ""),
    display_name: input.display_name ?? null,
    role: (input.role || "readonly") as UserRole,
    disabled: input.disabled ?? 0,
    created_at: input.created_at,
  };
}

export function AccountsPanel() {
  const [users, setUsers] = React.useState<UserRow[]>([]);
  const [loading, setLoading] = React.useState(false);

  const [isCreateOpen, setIsCreateOpen] = React.useState(false);
  const [newUsername, setNewUsername] = React.useState("");
  const [newDisplayName, setNewDisplayName] = React.useState("");
  const [newRole, setNewRole] = React.useState<UserRole>("readonly");
  const [newPassword, setNewPassword] = React.useState("");

  const fetchUsers = React.useCallback(async () => {
    setLoading(true);
    try {
      const json = await apiClient.get<UserRow[]>("/api/users");
      setUsers(Array.isArray(json) ? json.map(normalizeUser) : []);
    } catch (e: any) {
      notifyError(e?.message || "加载账号列表失败");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiClient.post("/api/users", {
        username: newUsername.trim(),
        password: newPassword,
        display_name: newDisplayName.trim() || null,
        role: newRole,
      });
      message.success("账号创建成功");
      setIsCreateOpen(false);
      setNewUsername("");
      setNewDisplayName("");
      setNewRole("readonly");
      setNewPassword("");
      fetchUsers();
    } catch (e: any) {
      notifyError(e?.message || "创建失败");
    }
  };

  const updateUser = async (id: number, patch: Partial<UserRow>) => {
    try {
      await apiClient.put(`/api/users/${id}`, patch);
      message.success("已更新");
      fetchUsers();
    } catch (e: any) {
      notifyError(e?.message || "更新失败");
    }
  };

  const resetPassword = async (id: number) => {
    try {
      let inputPwd = "";
      await new Promise<void>((resolve, reject) => {
        Modal.confirm({
          title: "重置密码",
          content: (
            <div className="space-y-2">
              <div className="text-sm text-slate-600">可留空：系统将自动生成安全密码。</div>
              <Input.Password placeholder="输入新密码（可留空）" onChange={(e) => (inputPwd = e.target.value)} />
            </div>
          ),
          okText: "确认",
          cancelText: "取消",
          onOk: () => resolve(),
          onCancel: () => reject(new Error("cancel")),
        });
      });
      const json = await apiClient.post<{ password?: string }>(`/api/users/${id}/reset-password`, {
        password: inputPwd || undefined,
      });
      const pwd = json.password || "";
      Modal.info({
        title: "新密码已生成",
        content: (
          <div className="space-y-2">
            <div className="text-sm text-slate-600">请及时告知用户并妥善保管。</div>
            <div className="flex items-center gap-2">
              <Input value={pwd} readOnly />
              <Button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(pwd);
                    message.success("已复制");
                  } catch {
                    message.warning("复制失败，请手动复制");
                  }
                }}
              >
                复制
              </Button>
            </div>
          </div>
        ),
        okText: "关闭",
      });
      message.success("密码已重置");
    } catch (e: any) {
      if (String(e?.message) === "cancel") return;
      notifyError(e?.message || "重置失败");
    }
  };

  const deleteUser = async (u: UserRow) => {
    if (String(u.username || "").toLowerCase() === "admin") {
      message.warning("用户名 admin 的账号禁止删除");
      return;
    }
    try {
      await new Promise<void>((resolve, reject) => {
        Modal.confirm({
          title: "确认删除账号？",
          content: `账号「${u.username}」删除后无法恢复。`,
          okText: "删除",
          okButtonProps: { danger: true },
          cancelText: "取消",
          onOk: () => resolve(),
          onCancel: () => reject(new Error("cancel")),
        });
      });
      await apiClient.delete(`/api/users/${u.id}`);
      message.success("账号已删除");
      fetchUsers();
    } catch (e: any) {
      if (String(e?.message) === "cancel") return;
      notifyError(e?.message || "删除失败");
    }
  };

  return (
    <>
      <div className="flex items-center justify-between mb-4 gap-3">
        <div className="text-sm text-slate-500">
          仅管理员可管理登录账号与权限。
        </div>
        <div className="flex items-center gap-2">
          <Button type="default" size="small" onClick={() => fetchUsers()} disabled={loading} icon={<RefreshCw size={16} />}>
            刷新
          </Button>
          <Button type="primary" size="small" onClick={() => setIsCreateOpen(true)} icon={<Plus size={16} />}>
            新增账号
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto border border-slate-200 rounded-xl">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left p-3">用户名</th>
              <th className="text-left p-3">显示名</th>
              <th className="text-left p-3">角色</th>
              <th className="text-left p-3">状态</th>
              <th className="text-left p-3">操作</th>
            </tr>
          </thead>
          <tbody className="bg-white">
            {users.map((u) => (
              <tr key={u.id} className="border-t border-slate-100">
                <td className="p-3 font-mono text-slate-800">{u.username}</td>
                <td className="p-3">
                  <input
                    className="w-full px-2 py-1 border border-slate-200 rounded-md"
                    value={u.display_name || ""}
                    placeholder="-"
                    onChange={(e) => {
                      const v = e.target.value;
                      setUsers((prev) =>
                        prev.map((x) => (x.id === u.id ? { ...x, display_name: v } : x))
                      );
                    }}
                    onBlur={() => updateUser(u.id, { display_name: (u.display_name || "").trim() || null })}
                  />
                </td>
                <td className="p-3">
                  <select
                    className="px-2 py-1 border border-slate-200 rounded-md"
                    value={u.role}
                    onChange={(e) => updateUser(u.id, { role: e.target.value as any })}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="p-3">
                  <span
                    className={`text-xs inline-flex items-center px-2 py-1 rounded ${
                      u.disabled ? "bg-rose-50 text-rose-600 border border-rose-100" : "bg-emerald-50 text-emerald-700 border border-emerald-100"
                    }`}
                  >
                    {u.disabled ? "已禁用" : "启用中"}
                  </span>
                </td>
                <td className="p-3">
                  <div className="flex items-center gap-2">
                    <Button type="default" size="small" onClick={() => resetPassword(u.id)} title="重置密码" icon={<Shield size={14} />} className="!text-xs">
                      重置密码
                    </Button>
                    <Button type="default" size="small" onClick={() => updateUser(u.id, { disabled: u.disabled ? 0 : 1 })} title={u.disabled ? "启用账号" : "禁用账号"} icon={<UserCog size={14} />} className="!text-xs">
                      {u.disabled ? "启用" : "禁用"}
                    </Button>
                    <Button type="primary" danger size="small" onClick={() => deleteUser(u)} disabled={String(u.username || "").toLowerCase() === "admin"} title="删除账号" icon={<Trash2 size={14} />} className="!text-xs">
                      删除
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {!loading && users.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-slate-400">
                  暂无账号
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {isCreateOpen && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">新增账号</h3>
              <Button type="text" size="small" onClick={() => setIsCreateOpen(false)} className="!text-slate-400 hover:!text-slate-600" icon={<Plus size={24} className="rotate-45" />} />
            </div>
            <form onSubmit={createUser} className="p-6 space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase">用户名</label>
                <input
                  required
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  placeholder="如：admin2"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase">显示名</label>
                <input
                  value={newDisplayName}
                  onChange={(e) => setNewDisplayName(e.target.value)}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  placeholder="如：张三"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase">角色</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as any)}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase">初始密码</label>
                <input
                  required
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  placeholder="至少6位"
                />
              </div>
              <div className="pt-4 flex gap-3">
                <Button type="default" className="flex-1" onClick={() => setIsCreateOpen(false)}>
                  取消
                </Button>
                <Button type="primary" htmlType="submit" className="flex-1">
                  创建
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

