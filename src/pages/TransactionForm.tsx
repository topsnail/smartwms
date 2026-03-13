import React, { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownLeft, ArrowUpRight, CheckCircle2, AlertCircle, RotateCcw } from 'lucide-react';
import { motion } from 'motion/react';
import { Button, Form, InputNumber, message, Modal, Empty, Select } from 'antd';
import { getStock } from '../api/inventory';
import { createTransaction, undoTransaction } from '../api/transactions';
import { createMaterial } from '../api/materials';
import { apiClient } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { PageHeader } from '../components/PageHeader';

export default function TransactionForm({ type }: { type: 'IN' | 'OUT' }) {
  const { can } = useAuth();
  const canInbound = can('inbound') || can('transactions_inbound');
  const canOutbound = can('outbound') || can('outbound_only') || can('transactions_outbound');
  const canUndo = can('transactions_undo');
  const hasPermission = type === 'IN' ? canInbound : canOutbound;
  const [materials, setMaterials] = React.useState<any[]>([]);
  const [locations, setLocations] = React.useState<any[]>([]);
  const [staff, setStaff] = React.useState<any[]>([]);
  const [departments, setDepartments] = React.useState<any[]>([]);
  const [reasons, setReasons] = React.useState<any[]>([]);
  const [partners, setPartners] = React.useState<any[]>([]);
  const [status, setStatus] = React.useState<{ type: 'success' | 'error', message: string } | null>(null);
  const [lastTxId, setLastTxId] = React.useState<number | null>(null);
  const [currentStock, setCurrentStock] = React.useState<number | null>(null);

  const [formData, setFormData] = React.useState({
    material_id: '',
    location_id: '',
    quantity: '',
    operator_id: '',
    department_id: '',
    recipient_id: '',
    partner_id: '',
    usage_unit: '',
    note: ''
  });

  const [combinedData, setCombinedData] = React.useState({
    material: '',
    location: '',
    operator: '',
    department: '',
    recipient: '',
    partner: ''
  });

  const [selectedIds, setSelectedIds] = React.useState({
    material: '',
    location: '',
    operator: '',
    department: '',
    recipient: '',
    partner: ''
  });

  const [suggestions, setSuggestions] = React.useState({
    material: [],
    location: [],
    operator: [],
    department: [],
    recipient: [],
    partner: []
  });

  const [showSuggestions, setShowSuggestions] = React.useState({
    material: false,
    location: false,
    operator: false,
    department: false,
    recipient: false,
    partner: false
  });

  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [previewPayload, setPreviewPayload] = React.useState<{
    payload: Parameters<typeof createTransaction>[0];
    summary: string[];
  } | null>(null);

  React.useEffect(() => {
    const fetchData = async () => {
      const [m, l, s, d, r, p] = await Promise.all([
        apiClient.get<any[]>('/api/materials'),
        apiClient.get<any[]>('/api/settings/locations'),
        apiClient.get<any[]>('/api/settings/staff'),
        apiClient.get<any[]>('/api/settings/departments'),
        apiClient.get<any[]>('/api/settings/reasons'),
        apiClient.get<any[]>('/api/settings/partners')
      ]);
      setMaterials(m);
      setLocations(l);
      setStaff(s);
      setDepartments(d);
      setReasons(r);
      setPartners(p);
    };
    fetchData();
  }, []);

  // 出库时根据物料+库位获取当前库存
  React.useEffect(() => {
    if (type !== 'OUT' || !selectedIds.material || !selectedIds.location) {
      setCurrentStock(null);
      return;
    }
    getStock(Number(selectedIds.material), Number(selectedIds.location))
      .then((r) => setCurrentStock(r.quantity))
      .catch(() => setCurrentStock(null));
  }, [type, selectedIds.material, selectedIds.location]);

  // 处理输入变化，更新建议
  const handleInputChange = (field: string, value: string) => {
    setCombinedData({...combinedData, [field]: value});
    setSelectedIds({...selectedIds, [field]: ''});
    
    let filteredSuggestions = [];
    
    switch (field) {
      case 'material':
        filteredSuggestions = materials
          .filter(m => m.name.toLowerCase().includes(value.toLowerCase()) || m.code.toLowerCase().includes(value.toLowerCase()))
          .map(m => ({ id: m.id, name: `${m.code} - ${m.name} (${m.spec || ''})` }))
          .slice(0, 5);
        break;
      case 'location':
        filteredSuggestions = locations
          .filter(l => l.name.toLowerCase().includes(value.toLowerCase()))
          .map(l => ({ id: l.id, name: l.name }))
          .slice(0, 5);
        break;
      case 'operator':
        filteredSuggestions = staff
          .filter(s => s.role === '仓管员' && s.name.toLowerCase().includes(value.toLowerCase()))
          .map(s => ({ id: s.id, name: s.name }))
          .slice(0, 5);
        break;
      case 'department':
        filteredSuggestions = departments
          .filter(d => d.name.toLowerCase().includes(value.toLowerCase()))
          .map(d => ({ id: d.id, name: d.name }))
          .slice(0, 5);
        break;
      case 'recipient':
        filteredSuggestions = staff
          .filter(s => s.role === '领料人' && s.name.toLowerCase().includes(value.toLowerCase()))
          .map(s => ({ id: s.id, name: s.name }))
          .slice(0, 5);
        break;
      case 'partner':
        filteredSuggestions = partners
          .filter(p => p.name.toLowerCase().includes(value.toLowerCase()))
          .map(p => ({ id: p.id, name: p.name }))
          .slice(0, 5);
        break;
    }
    
    setSuggestions({...suggestions, [field]: filteredSuggestions});
    setShowSuggestions({...showSuggestions, [field]: filteredSuggestions.length > 0});
  };

  // 处理输入框获得焦点，显示所有建议
  const handleFocus = (field: string) => {
    let allSuggestions = [];
    
    switch (field) {
      case 'material':
        allSuggestions = materials
          .map(m => ({ id: m.id, name: `${m.code} - ${m.name} (${m.spec || ''})` }))
          .slice(0, 5);
        break;
      case 'location':
        allSuggestions = locations
          .map(l => ({ id: l.id, name: l.name }))
          .slice(0, 5);
        break;
      case 'operator':
        allSuggestions = staff
          .filter(s => s.role === '仓管员')
          .map(s => ({ id: s.id, name: s.name }))
          .slice(0, 5);
        break;
      case 'department':
        allSuggestions = departments
          .map(d => ({ id: d.id, name: d.name }))
          .slice(0, 5);
        break;
      case 'recipient':
        allSuggestions = staff
          .filter(s => s.role === '领料人')
          .map(s => ({ id: s.id, name: s.name }))
          .slice(0, 5);
        break;
      case 'partner':
        allSuggestions = partners
          .map(p => ({ id: p.id, name: p.name }))
          .slice(0, 5);
        break;
    }
    
    setSuggestions({...suggestions, [field]: allSuggestions});
    setShowSuggestions({...showSuggestions, [field]: allSuggestions.length > 0});
  };

  // 选择建议
  const selectSuggestion = (field: string, item: { id: string | number, name: string }) => {
    setCombinedData({...combinedData, [field]: item.name});
    setSelectedIds({...selectedIds, [field]: item.id.toString()});
    setSuggestions({...suggestions, [field]: []});
    setShowSuggestions({...showSuggestions, [field]: false});
  };

  const [loading, setLoading] = React.useState(false);

  const clearForm = useCallback(() => {
    setFormData({
      material_id: '', location_id: '', quantity: '', operator_id: '',
      department_id: '', recipient_id: '', partner_id: '', usage_unit: '', note: ''
    });
    setCombinedData({
      material: '', location: '', operator: '', department: '', recipient: '', partner: ''
    });
    setSelectedIds({
      material: '', location: '', operator: '', department: '', recipient: '', partner: ''
    });
  }, []);

  const buildSubmitPayload = useCallback(async () => {
    let processedFormData = {
      ...formData,
      material_id: selectedIds.material,
      location_id: selectedIds.location,
      operator_id: selectedIds.operator,
      department_id: selectedIds.department,
      recipient_id: selectedIds.recipient,
      partner_id: selectedIds.partner
    };

    if (!processedFormData.material_id && combinedData.material) {
      const materialData = await createMaterial({
        code: `NEW-${Date.now()}`,
        name: combinedData.material,
        spec: '',
        unit: '个',
        category: ''
      });
      processedFormData.material_id = String(materialData.id);
      message.success(`已添加物料：${combinedData.material}`);
    }
    if (!processedFormData.location_id && combinedData.location) {
      const locationData = await apiClient.post<{ id: number }>('/api/settings/locations', { name: combinedData.location });
      processedFormData.location_id = String(locationData.id);
      message.success(`已添加存放位置：${combinedData.location}`);
    }
    if (!processedFormData.operator_id && combinedData.operator) {
      const operatorData = await apiClient.post<{ id: number }>('/api/settings/staff', { name: combinedData.operator, role: '仓管员' });
      processedFormData.operator_id = String(operatorData.id);
      message.success(`已添加经办人：${combinedData.operator}`);
    }
    if (type === 'OUT' && !processedFormData.department_id && combinedData.department) {
      const departmentData = await apiClient.post<{ id: number }>('/api/settings/departments', { name: combinedData.department });
      processedFormData.department_id = String(departmentData.id);
      message.success(`已添加领用部门：${combinedData.department}`);
    }
    if (type === 'OUT' && !processedFormData.recipient_id && combinedData.recipient) {
      const recipientData = await apiClient.post<{ id: number }>('/api/settings/staff', { name: combinedData.recipient, role: '领料人' });
      processedFormData.recipient_id = String(recipientData.id);
      message.success(`已添加领用人：${combinedData.recipient}`);
    }
    if (!processedFormData.partner_id && combinedData.partner) {
      const partnerData = await apiClient.post<{ id: number }>('/api/settings/partners', { name: combinedData.partner });
      processedFormData.partner_id = String(partnerData.id);
      message.success(`已添加往来单位：${combinedData.partner}`);
    }

    if (!processedFormData.material_id) throw new Error('请选择或输入物料');
    if (!processedFormData.location_id) throw new Error('请选择或输入存放位置');
    const qty = Number(processedFormData.quantity);
    if (!processedFormData.quantity || !Number.isInteger(qty) || qty <= 0) {
      throw new Error('请输入有效的正整数数量');
    }
    if (!processedFormData.operator_id) throw new Error('请选择或输入经办人');
    if (type === 'OUT') {
      if (!processedFormData.department_id) throw new Error('请选择或输入领用部门');
      if (!processedFormData.recipient_id) throw new Error('请选择或输入领用人');
      if (!processedFormData.partner_id) throw new Error('请选择或输入往来单位');
      if (!processedFormData.usage_unit || !String(processedFormData.usage_unit).trim()) {
        throw new Error('请输入使用单位');
      }
      if (currentStock !== null && qty > currentStock) {
        throw new Error(`库存不足：当前可用 ${currentStock}，需要 ${processedFormData.quantity}`);
      }
    }

    const finalNote =
      type === 'OUT' && processedFormData.usage_unit
        ? `使用单位：${processedFormData.usage_unit}${processedFormData.note ? `；${processedFormData.note}` : ''}`
        : processedFormData.note;

    const payload = {
      material_id: Number(processedFormData.material_id),
      location_id: Number(processedFormData.location_id),
      quantity: qty,
      operator_id: Number(processedFormData.operator_id),
      department_id: processedFormData.department_id ? Number(processedFormData.department_id) : null,
      recipient_id: processedFormData.recipient_id ? Number(processedFormData.recipient_id) : null,
      partner_id: processedFormData.partner_id ? Number(processedFormData.partner_id) : null,
      note: finalNote,
      type
    };

    const materialName = materials.find((m: any) => String(m.id) === processedFormData.material_id)?.name || combinedData.material;
    const locationName = locations.find((l: any) => String(l.id) === processedFormData.location_id)?.name || combinedData.location;
    const operatorName = staff.find((s: any) => String(s.id) === processedFormData.operator_id)?.name || combinedData.operator;
    const summary = [
      `类型：${type === 'IN' ? '入库' : '出库'}`,
      `物料：${materialName || '-'}`,
      `库位：${locationName || '-'}`,
      `数量：${payload.quantity}`,
      `经办人：${operatorName || '-'}`
    ];
    if (type === 'OUT') {
      const deptName = departments.find((d: any) => String(d.id) === processedFormData.department_id)?.name || combinedData.department;
      const recName = staff.find((s: any) => String(s.id) === processedFormData.recipient_id)?.name || combinedData.recipient;
      summary.push(`领用部门：${deptName || '-'}`, `领用人：${recName || '-'}`);
    }
    if (finalNote) summary.push(`备注：${finalNote}`);

    return { payload, summary };
  }, [formData, selectedIds, combinedData, type, currentStock, materials, locations, staff, departments]);

  const doConfirmSubmit = useCallback(async () => {
    if (!previewPayload) return;
    setLoading(true);
    try {
      const data = await createTransaction(previewPayload.payload);
      const txId = Array.isArray(data.ids) ? data.ids[0] : data.ids;
      setLastTxId(txId);
      setStatus({ type: 'success', message: `${type === 'IN' ? '入库' : '出库'}成功！5 分钟内可撤销。` });
      message.success(type === 'IN' ? '入库成功' : '出库成功');
      clearForm();
      setPreviewOpen(false);
      setPreviewPayload(null);
    } catch (err: any) {
      message.error(err?.message || '提交失败');
      setStatus({ type: 'error', message: err?.message || '网络错误' });
    } finally {
      setLoading(false);
    }
  }, [previewPayload, type, clearForm]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus(null);
    setLoading(true);
    try {
      const result = await buildSubmitPayload();
      setPreviewPayload(result);
      setPreviewOpen(true);
    } catch (err: any) {
      const msg = err?.message || '网络错误';
      message.error(msg);
      setStatus({ type: 'error', message: msg });
    } finally {
      setLoading(false);
    }
  };

  if (!hasPermission) {
    return (
      <div className="max-w-2xl mx-auto">
        <PageHeader
          icon={type === 'IN' ? <ArrowDownLeft size={22} className="text-indigo-500" /> : <ArrowUpRight size={22} className="text-orange-500" />}
          title={type === 'IN' ? '物料入库' : '物料出库'}
          subtitle={type === 'IN' ? '无入库操作权限' : '无出库操作权限'}
        />
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
          <Empty description="您没有该页面的操作权限，请联系管理员。" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <PageHeader
        icon={
          type === 'IN' ? (
            <ArrowDownLeft size={22} className="text-indigo-500" />
          ) : (
            <ArrowUpRight size={22} className="text-orange-500" />
          )
        }
        title={type === 'IN' ? '物料入库' : '物料出库'}
        subtitle={`请填写以下信息完成${type === 'IN' ? '入库' : '出库'}登记。`}
        actions={
          <Link to={type === 'IN' ? '/history?type=IN' : '/history?type=OUT'}>
            <Button type="link">查看最近{type === 'IN' ? '入库' : '出库'}</Button>
          </Link>
        }
      />

      {status && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className={`p-4 rounded-xl flex items-center justify-between gap-3 ${status.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-red-50 text-red-700 border border-red-100'}`}
        >
          <div className="flex items-center gap-3">
            {status.type === 'success' ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
            <span className="text-sm font-medium">{status.message}</span>
          </div>
          {status.type === 'success' && lastTxId && canUndo && (
            <Button
              type="link"
              size="small"
              icon={<RotateCcw size={14} />}
              onClick={async () => {
                try {
                  await undoTransaction(lastTxId);
                  setStatus({ type: 'success', message: '已撤销该操作。' });
                  setLastTxId(null);
                  message.success('已撤销');
                } catch (e: any) {
                  message.error(e?.message || '撤销失败');
                  setStatus({ type: 'error', message: e?.message || '撤销失败' });
                }
              }}
            >
              撤销
            </Button>
          )}
        </motion.div>
      )}

      <form onSubmit={handleSubmit} className="bg-white p-6 sm:p-8 rounded-2xl border border-slate-200 shadow-sm space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500 uppercase">选择物料</label>
            <div className="relative">
              <input 
                type="text" 
                value={combinedData.material}
                onChange={e => handleInputChange('material', e.target.value)}
                onFocus={() => handleFocus('material')}
                onBlur={(e) => {
                  // 检查点击目标是否在建议列表内
                  const target = e.relatedTarget;
                  if (!target || !target.closest('.relative')) {
                    setTimeout(() => setShowSuggestions({...showSuggestions, material: false}), 300);
                  }
                }}
                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                placeholder="输入或选择物料..."
              />
              {showSuggestions.material && suggestions.material.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-10 max-h-40 overflow-y-auto">
                  {suggestions.material.map((item, index) => (
                    <div 
                      key={index}
                      onClick={() => selectSuggestion('material', item)}
                      className="px-4 py-2 hover:bg-slate-50 cursor-pointer text-sm"
                    >
                      {item.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-1">提示：输入物料名称或编码，系统会自动显示匹配的选项</p>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500 uppercase">存放位置</label>
            <div className="relative">
              <input 
                type="text" 
                value={combinedData.location}
                onChange={e => handleInputChange('location', e.target.value)}
                onFocus={() => handleFocus('location')}
                onBlur={(e) => {
                  // 检查点击目标是否在建议列表内
                  const target = e.relatedTarget;
                  if (!target || !target.closest('.relative')) {
                    setTimeout(() => setShowSuggestions({...showSuggestions, location: false}), 300);
                  }
                }}
                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                placeholder="输入或选择存放位置..."
              />
              {showSuggestions.location && suggestions.location.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-10 max-h-40 overflow-y-auto">
                  {suggestions.location.map((item, index) => (
                    <div 
                      key={index}
                      onClick={() => selectSuggestion('location', item)}
                      className="px-4 py-2 hover:bg-slate-50 cursor-pointer text-sm"
                    >
                      {item.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-1">提示：输入存放位置名称，系统会自动显示匹配的选项</p>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500 uppercase">数量</label>
            <InputNumber
              required
              min={1}
              max={type === 'OUT' && currentStock != null ? currentStock : undefined}
              precision={0}
              value={formData.quantity ? Number(formData.quantity) : undefined}
              onChange={(v) => setFormData({ ...formData, quantity: v != null ? String(v) : '' })}
              className="w-full"
              placeholder="0"
            />
            {type === 'OUT' && currentStock !== null && (
              <p className="text-xs text-orange-600 mt-1">
                当前库存：<strong>{currentStock}</strong>，最多可出：{currentStock}
              </p>
            )}
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500 uppercase">经办人</label>
            <div className="relative">
              <input 
                type="text" 
                value={combinedData.operator}
                onChange={e => handleInputChange('operator', e.target.value)}
                onFocus={() => handleFocus('operator')}
                onBlur={(e) => {
                  // 检查点击目标是否在建议列表内
                  const target = e.relatedTarget;
                  if (!target || !target.closest('.relative')) {
                    setTimeout(() => setShowSuggestions({...showSuggestions, operator: false}), 300);
                  }
                }}
                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                placeholder="输入或选择经办人..."
              />
              {showSuggestions.operator && suggestions.operator.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-10 max-h-40 overflow-y-auto">
                  {suggestions.operator.map((item, index) => (
                    <div 
                      key={index}
                      onClick={() => selectSuggestion('operator', item)}
                      className="px-4 py-2 hover:bg-slate-50 cursor-pointer text-sm"
                    >
                      {item.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-1">提示：输入经办人姓名，系统会自动显示匹配的选项</p>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500 uppercase">往来单位</label>
            <div className="relative">
              <input
                type="text"
                value={combinedData.partner}
                onChange={e => handleInputChange('partner', e.target.value)}
                onFocus={() => handleFocus('partner')}
                onBlur={(e) => {
                  const target = e.relatedTarget;
                  if (!target || !target.closest('.relative')) {
                    setTimeout(() => setShowSuggestions({ ...showSuggestions, partner: false }), 300);
                  }
                }}
                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                placeholder="输入或选择往来单位..."
              />
              {showSuggestions.partner && suggestions.partner.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-10 max-h-40 overflow-y-auto">
                  {suggestions.partner.map((item, index) => (
                    <div
                      key={index}
                      onClick={() => selectSuggestion('partner', item)}
                      className="px-4 py-2 hover:bg-slate-50 cursor-pointer text-sm"
                    >
                      {item.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-1">提示：可从往来单位中选择；也可直接输入名称，系统会自动新增</p>
          </div>
        </div>

        {type === 'OUT' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-slate-100">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 uppercase">出库事由</label>
              <Select
                allowClear
                placeholder="请选择出库事由"
                value={formData.usage_unit || undefined}
                onChange={(v) => setFormData({ ...formData, usage_unit: v ?? '' })}
                options={reasons.map((r: any) => ({ label: r.name, value: r.name }))}
                className="w-full"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 uppercase">领用部门</label>
              <div className="relative">
                <input 
                  type="text" 
                  value={combinedData.department}
                  onChange={e => handleInputChange('department', e.target.value)}
                  onFocus={() => handleFocus('department')}
                  onBlur={(e) => {
                    // 检查点击目标是否在建议列表内
                    const target = e.relatedTarget;
                    if (!target || !target.closest('.relative')) {
                      setTimeout(() => setShowSuggestions({...showSuggestions, department: false}), 300);
                    }
                  }}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  placeholder="输入或选择领用部门..."
                />
                {showSuggestions.department && suggestions.department.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-10 max-h-40 overflow-y-auto">
                    {suggestions.department.map((item, index) => (
                      <div 
                        key={index}
                        onClick={() => selectSuggestion('department', item)}
                        className="px-4 py-2 hover:bg-slate-50 cursor-pointer text-sm"
                      >
                        {item.name}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-1">提示：输入领用部门名称，系统会自动显示匹配的选项</p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 uppercase">领用人</label>
              <div className="relative">
                <input 
                  type="text" 
                  value={combinedData.recipient}
                  onChange={e => handleInputChange('recipient', e.target.value)}
                  onFocus={() => handleFocus('recipient')}
                  onBlur={(e) => {
                    // 检查点击目标是否在建议列表内
                    const target = e.relatedTarget;
                    if (!target || !target.closest('.relative')) {
                      setTimeout(() => setShowSuggestions({...showSuggestions, recipient: false}), 300);
                    }
                  }}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  placeholder="输入或选择领用人..."
                />
                {showSuggestions.recipient && suggestions.recipient.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-10 max-h-40 overflow-y-auto">
                    {suggestions.recipient.map((item, index) => (
                      <div 
                        key={index}
                        onClick={() => selectSuggestion('recipient', item)}
                        className="px-4 py-2 hover:bg-slate-50 cursor-pointer text-sm"
                      >
                        {item.name}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-1">提示：输入领用人姓名，系统会自动显示匹配的选项</p>
            </div>
          </div>
        )}

        <div className="space-y-1">
          <label className="text-xs font-bold text-slate-500 uppercase">备注</label>
          <textarea 
            rows={3}
            value={formData.note}
            onChange={e => setFormData({...formData, note: e.target.value})}
            className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            placeholder="添加备注信息..."
          />
        </div>

        <Button
          type="submit"
          htmlType="submit"
          size="large"
          block
          loading={loading}
          className={`!py-3 rounded-xl font-bold !text-white h-auto ${type === 'IN' ? '!bg-indigo-600 hover:!bg-indigo-700' : '!bg-orange-600 hover:!bg-orange-700'}`}
        >
          {loading ? '处理中...' : `确认提交${type === 'IN' ? '入库' : '出库'}`}
        </Button>
      </form>

      <Modal
        title="确认提交"
        open={previewOpen}
        onCancel={() => { setPreviewOpen(false); setPreviewPayload(null); }}
        onOk={doConfirmSubmit}
        okText="确认提交"
        cancelText="取消"
        confirmLoading={loading}
        destroyOnHidden
      >
        {previewPayload && (
          <div className="py-2 space-y-1 text-sm">
            <p className="text-slate-500 mb-2">请确认以下信息无误后提交：</p>
            {previewPayload.summary.map((line, i) => (
              <div key={i} className="text-slate-700">{line}</div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}
