import React from "react";
import { Edit, Plus, Trash2 } from "lucide-react";
import { Button, Empty, Input, Popconfirm, message } from "antd";
import { notifyError } from "../../utils/notify";
import { useAuth } from "../../contexts/AuthContext";
import { apiClient } from "../../api/client";
import type { PartnerRow } from "./types";

function normalizePartner(input: Partial<PartnerRow>): PartnerRow {
  return {
    id: Number(input.id),
    name: String(input.name || ""),
    invoice_info: input.invoice_info ?? null,
    contact: input.contact ?? null,
    mailing_address: input.mailing_address ?? null,
  };
}

export function PartnersPanel() {
  const { can } = useAuth();
  const [data, setData] = React.useState<PartnerRow[]>([]);
  const [isModalOpen, setIsModalOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<PartnerRow | null>(null);
  const [keyword, setKeyword] = React.useState("");

  const [name, setName] = React.useState("");
  const [invoiceInfo, setInvoiceInfo] = React.useState("");
  const [contact, setContact] = React.useState("");
  const [mailingAddress, setMailingAddress] = React.useState("");

  const fetchData = React.useCallback(async () => {
    try {
      const json = await apiClient.get<PartnerRow[]>(`/api/settings/partners`);
      setData(Array.isArray(json) ? json.map(normalizePartner) : []);
    } catch {
      notifyError("加载往来单位失败，请稍后重试");
    }
  }, []);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  const openCreate = () => {
    setEditing(null);
    setName("");
    setInvoiceInfo("");
    setContact("");
    setMailingAddress("");
    setIsModalOpen(true);
  };

  const openEdit = (row: PartnerRow) => {
    setEditing(row);
    setName(row.name || "");
    setInvoiceInfo(row.invoice_info || "");
    setContact(row.contact || "");
    setMailingAddress(row.mailing_address || "");
    setIsModalOpen(true);
  };

  const handleDelete = async (id: number) => {
    try {
      await apiClient.delete(`/api/settings/partners/${id}`);
      message.success("删除成功");
      fetchData();
    } catch (err: any) {
      notifyError(err?.message || "删除失败，请稍后重试");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      notifyError("请输入公司名称");
      return;
    }
    try {
      const payload = {
        name: name.trim(),
        invoice_info: invoiceInfo.trim() || null,
        contact: contact.trim() || null,
        mailing_address: mailingAddress.trim() || null,
      };
      if (editing) {
        await apiClient.put(`/api/settings/partners/${editing.id}`, payload);
      } else {
        await apiClient.post(`/api/settings/partners`, payload);
      }
      message.success(editing ? "编辑成功" : "新增成功");
      setIsModalOpen(false);
      fetchData();
    } catch (err: any) {
      notifyError(err?.message || "操作失败，请稍后重试");
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <Input
          allowClear
          placeholder="搜索往来单位..."
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          style={{ width: 240 }}
        />
        {can("edit_settings") && (
          <Button type="primary" size="small" onClick={openCreate} icon={<Plus size={18} />}>
            新增
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {data
          .filter((x) => !keyword.trim() || x.name.toLowerCase().includes(keyword.trim().toLowerCase()))
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
                  <Button type="text" size="small" onClick={() => openEdit(item)} className="!p-1.5 text-slate-400 hover:!text-indigo-600" title="编辑" icon={<Edit size={16} />} />
                )}
                {can("delete_settings") && (
                  <Popconfirm
                    title="确定删除该往来单位？"
                    description="删除后无法恢复。若被出入库记录引用将无法删除。"
                    okText="删除"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => handleDelete(item.id)}
                  >
                    <Button type="text" size="small" className="!p-1.5 text-slate-400 hover:!text-red-600" title="删除" icon={<Trash2 size={16} />} />
                  </Popconfirm>
                )}
              </div>
            </div>

            {(item.invoice_info || item.contact || item.mailing_address) && (
              <div className="mt-2 space-y-1 text-xs text-slate-500">
                {item.invoice_info && <div>开票：{item.invoice_info}</div>}
                {item.contact && <div>联系：{item.contact}</div>}
                {item.mailing_address && <div>邮寄：{item.mailing_address}</div>}
              </div>
            )}
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
                {editing ? "编辑往来单位" : "新增往来单位"}
              </h3>
              <Button type="text" size="small" onClick={() => setIsModalOpen(false)} className="!text-slate-400 hover:!text-slate-600" icon={<Plus size={24} className="rotate-45" />} />
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase">公司名称</label>
                <input
                  required
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  placeholder="请输入公司名称..."
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase">开票信息</label>
                <textarea
                  value={invoiceInfo}
                  onChange={(e) => setInvoiceInfo(e.target.value)}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  placeholder="税号、开户行、账号、地址等"
                  rows={3}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase">联系方式</label>
                <input
                  type="text"
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  placeholder="电话、邮箱、联系人等"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase">邮寄地址</label>
                <input
                  type="text"
                  value={mailingAddress}
                  onChange={(e) => setMailingAddress(e.target.value)}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  placeholder="收件地址"
                />
              </div>
              <div className="pt-4 flex gap-3">
                <Button type="default" className="flex-1" onClick={() => setIsModalOpen(false)}>
                  取消
                </Button>
                <Button type="primary" htmlType="submit" className="flex-1">
                  保存
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

