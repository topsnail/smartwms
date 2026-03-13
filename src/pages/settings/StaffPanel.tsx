import React from "react";
import { Edit, Plus, Trash2 } from "lucide-react";
import { Empty, Input, Popconfirm, message } from "antd";
import { useAuth } from "../../contexts/AuthContext";
import { apiClient } from "../../api/client";
import type { StaffRow } from "./types";

const STAFF_ROLES = ["仓管员", "领料人", "财务员"] as const;

export function StaffPanel() {
  const { can } = useAuth();
  const [data, setData] = React.useState<StaffRow[]>([]);
  const [isModalOpen, setIsModalOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<StaffRow | null>(null);
  const [name, setName] = React.useState("");
  const [role, setRole] = React.useState<(typeof STAFF_ROLES)[number]>("仓管员");
  const [keyword, setKeyword] = React.useState("");

  const fetchData = React.useCallback(async () => {
    try {
      const json = await apiClient.get<StaffRow[]>(`/api/settings/staff`);
      setData(Array.isArray(json) ? json : []);
    } catch {
      message.error("加载人员失败，请稍后重试");
    }
  }, []);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  const openCreate = () => {
    setEditing(null);
    setName("");
    setRole("仓管员");
    setIsModalOpen(true);
  };

  const openEdit = (row: StaffRow) => {
    setEditing(row);
    setName(row.name);
    setRole((row.role as any) || "仓管员");
    setIsModalOpen(true);
  };

  const handleDelete = async (id: number) => {
    try {
      await apiClient.delete(`/api/settings/staff/${id}`);
      message.success("删除成功");
      fetchData();
    } catch (err: any) {
      message.error(err?.message || "删除失败，请稍后重试");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editing) {
        await apiClient.put(`/api/settings/staff/${editing.id}`, { name, role });
      } else {
        await apiClient.post(`/api/settings/staff`, { name, role });
      }
      message.success(editing ? "编辑成功" : "新增成功");
      setIsModalOpen(false);
      fetchData();
    } catch (err: any) {
      message.error(err?.message || "操作失败，请稍后重试");
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <Input
          allowClear
          placeholder="搜索人员..."
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          style={{ width: 220 }}
        />
        {can("edit_settings") && (
          <button
            onClick={openCreate}
            className="btn-primary text-white text-sm flex items-center gap-2"
            style={{ color: "#fff" }}
          >
            <Plus size={18} />
            新增
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {data
          .filter((x) => {
            const kw = keyword.trim().toLowerCase();
            if (!kw) return true;
            return x.name.toLowerCase().includes(kw) || String(x.role || "").toLowerCase().includes(kw);
          })
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((item) => (
          <div
            key={item.id}
            className="p-4 rounded-xl border border-slate-100 bg-slate-50/50 flex flex-col"
          >
            <div className="flex justify-between items-start">
              <span className="text-sm font-bold text-slate-900">{item.name}</span>
              <div className="flex gap-2">
                {can("edit_settings") && (
                  <button
                    onClick={() => openEdit(item)}
                    className="p-1.5 text-slate-400 hover:text-indigo-600 rounded-lg hover:bg-slate-100 transition-colors"
                    title="编辑"
                  >
                    <Edit size={16} />
                  </button>
                )}
                {can("delete_settings") && (
                  <Popconfirm
                    title="确定删除该人员？"
                    description="删除后无法恢复。若被出入库记录引用将无法删除。"
                    okText="删除"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => handleDelete(item.id)}
                  >
                    <button
                      className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg transition-colors"
                      title="删除"
                    >
                      <Trash2 size={16} />
                    </button>
                  </Popconfirm>
                )}
              </div>
            </div>
            {item.role && <span className="text-xs text-slate-400 mt-1">{item.role}</span>}
          </div>
        ))}
        {data.length === 0 && (
          <div className="col-span-full py-10">
            <Empty description="暂无数据" />
          </div>
        )}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">
                {editing ? "编辑人员" : "新增人员"}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <Plus size={24} className="rotate-45" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase">名称</label>
                <input
                  required
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  placeholder="请输入姓名..."
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase">角色</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as any)}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                >
                  {STAFF_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <div className="pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="btn-secondary flex-1 text-sm"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="btn-primary text-white flex-1 text-sm"
                >
                  保存
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

