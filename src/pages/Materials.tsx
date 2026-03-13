import React, { useMemo, useCallback, useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PlusOutlined, EditOutlined, DeleteOutlined, UploadOutlined, DownloadOutlined, InboxOutlined, SearchOutlined, SettingOutlined } from '@ant-design/icons';
import { useAuth } from '../contexts/AuthContext';
import { Button, Input, Table, Tag, Modal, Form, Select, Space, message, Popover, Upload, Typography, InputNumber, Tooltip, Alert, Popconfirm, Skeleton, Empty, Checkbox } from 'antd';
import type { UploadProps } from 'antd';
import { apiClient } from '../api/client';
import { Package as PackageIcon } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { DEFAULT_DEBOUNCE_MS, DEFAULT_PAGE_SIZE_OPTIONS } from '../constants/table';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useColumnVisibility } from '../hooks/useColumnVisibility';
import { ColumnVisibilityPopover } from '../components/ColumnVisibilityPopover';
import { PreviewImage } from '../components/PreviewImage';
import { 
  getMaterials, 
  createMaterial, 
  updateMaterial, 
  deleteMaterial, 
  batchDeleteMaterials, 
  exportMaterials, 
  batchImportMaterials,
  canDeleteMaterial,
  checkMaterialCode,
  batchUpdateMaterials,
  type Material, 
  type SaveMaterialInput 
} from '../api/materials';
import { getInventory, type InventoryItem } from '../api/inventory';

const MaterialImage = React.memo(({ url, name, onClick }: { url: string | null; name: string; onClick?: () => void }) => {
  return <PreviewImage url={url} name={name} popoverPreview onClick={onClick} />;
});

const MaterialActionButtons = React.memo(({ record, onEdit, onDelete, canEdit, canDelete }: {
  record: Material;
  onEdit: (record: Material) => void;
  onDelete: (id: number) => Promise<void> | void;
  canEdit: boolean;
  canDelete: boolean;
}) => (
  <Space>
    {canEdit && (
      <Tooltip title="编辑">
        <Button
          type="link"
          size="small"
          className="wms-icon-btn"
          icon={<EditOutlined />}
          onClick={() => onEdit(record)}
        />
      </Tooltip>
    )}
    {canDelete && (
      <Popconfirm
        title="确定删除该物料？"
        description="须先将各仓位库存清零（出库等）后才可删除；未清零时系统将拒绝删除。"
        okText="确定"
        cancelText="取消"
        onConfirm={() => onDelete(record.id)}
      >
        <Tooltip title="删除">
          <Button
            type="link"
            size="small"
            danger
            className="wms-icon-btn"
            icon={<DeleteOutlined />}
          />
        </Tooltip>
      </Popconfirm>
    )}
  </Space>
));

const DEBOUNCE_MS = DEFAULT_DEBOUNCE_MS;
const PAGE_SIZE_OPTIONS = DEFAULT_PAGE_SIZE_OPTIONS.map((s) => Number(s));

export default function Materials() {
  const { can } = useAuth();
  const [searchParams] = useSearchParams();
  const [materials, setMaterials] = React.useState<Material[]>([]);
  const [isModalOpen, setIsModalOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [form] = Form.useForm<SaveMaterialInput>();
  const [searchInput, setSearchInput] = React.useState('');
  const searchTerm = useDebouncedValue(searchInput, DEBOUNCE_MS);
  const [sources, setSources] = React.useState<{ id: number; name: string }[]>([]);
  const [categories, setCategories] = React.useState<{ id: number; name: string }[]>([]);
  const [units, setUnits] = React.useState<{ id: number; name: string }[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<{ success: boolean; successCount: number; failedCount: number; failedItems: { item: SaveMaterialInput; error: string }[] } | null>(null);
  const [importPreviewRows, setImportPreviewRows] = useState<SaveMaterialInput[] | null>(null);
  const [inventoryList, setInventoryList] = useState<InventoryItem[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  /** 高级筛选：null/'' 表示“全部”，与下拉首项一致 */
  const [filterCategoryId, setFilterCategoryId] = useState<number | null>(null);
  const [filterSource, setFilterSource] = useState<string | null>(null);
  const [priceMin, setPriceMin] = useState<number | undefined>(undefined);
  const [priceMax, setPriceMax] = useState<number | undefined>(undefined);
  const [previewMaterial, setPreviewMaterial] = useState<Material | null>(null);
  const [batchEditOpen, setBatchEditOpen] = useState(false);
  const [batchForm] = Form.useForm<{ category_id?: number; unit?: string; source?: string }>();
  const defaultVisibleKeys = ['image_url', 'code', 'name', 'spec', 'unit', 'category_name', 'source', 'stock_total', 'purchase_price', 'sale_price', 'actions'];
  const { visibleKeys: visibleColumnKeys, toggle: toggleColumn, reset: resetColumns } = useColumnVisibility({
    defaultKeys: defaultVisibleKeys,
    storageKey: 'materials.visibleColumns',
  });

  // 支持从 URL 读取 keyword，便于从日志/报表联动跳转
  useEffect(() => {
    const keyword = searchParams.get('keyword') || '';
    if (keyword) {
      setSearchInput(keyword);
      setPage(1);
    }
  }, []);

  const fetchMaterials = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getMaterials();
      setMaterials(data);
    } catch (error) {
      console.error(error);
      message.error('加载物料列表失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, []);

  // 搜索关键字变化时回到第一页
  useEffect(() => {
    setPage(1);
  }, [searchTerm]);

  // 挂载时加载分类、来源、单位；并行拉取库存用于汇总
  useEffect(() => {
    const load = async () => {
      try {
        const [s, c, u] = await Promise.all([
          apiClient.get<{ id: number; name: string }[]>('/api/settings/sources'),
          apiClient.get<{ id: number; name: string }[]>('/api/settings/categories'),
          apiClient.get<{ id: number; name: string }[]>('/api/settings/units'),
        ]);
        setSources(Array.isArray(s) ? s : []);
        setCategories(Array.isArray(c) ? c : []);
        setUnits(Array.isArray(u) ? u : []);
      } catch {
        // ignore
      }
    };
    load();
  }, []);

  useEffect(() => {
    getInventory()
      .then((list) => setInventoryList(Array.isArray(list) ? list : []))
      .catch(() => setInventoryList([]));
  }, [materials.length]);

  const stockByMaterialId = useMemo(() => {
    const map = new Map<number, number>();
    for (const row of inventoryList) {
      const id = row.material_id;
      map.set(id, (map.get(id) ?? 0) + (row.quantity || 0));
    }
    return map;
  }, [inventoryList]);

  const filteredMaterials = useMemo(() => {
    const term = searchTerm.toLowerCase().trim();
    return materials.filter((m) => {
      if (term) {
        const match =
          m.name.toLowerCase().includes(term) ||
          (m.code && m.code.toLowerCase().includes(term)) ||
          (m.category && m.category.toLowerCase().includes(term)) ||
          (m.spec && m.spec.toLowerCase().includes(term)) ||
          (m.unit && m.unit.toLowerCase().includes(term)) ||
          (m.source && m.source.toLowerCase().includes(term));
        if (!match) return false;
      }
      if (filterCategoryId != null) {
        if (m.category_id !== filterCategoryId) return false;
      }
      if (filterSource != null && filterSource !== '') {
        if ((m.source || '') !== filterSource) return false;
      }
      const p = m.purchase_price ?? null;
      const s = m.sale_price ?? null;
      if (priceMin != null && priceMin !== undefined) {
        const v = p ?? s ?? 0;
        if (v < priceMin) return false;
      }
      if (priceMax != null && priceMax !== undefined) {
        const v = p ?? s ?? 0;
        if (v > priceMax) return false;
      }
      return true;
    });
  }, [materials, searchTerm, filterCategoryId, filterSource, priceMin, priceMax]);

  React.useEffect(() => {
    fetchMaterials();
  }, [fetchMaterials]);

  const handleSubmit = useCallback(async () => {
    const values = await form.validateFields();
    try {
      const payload: SaveMaterialInput = values;
      if (editingId) {
        await updateMaterial(editingId, payload);
        message.success('物料编辑成功');
      } else {
        await createMaterial(payload);
        message.success('物料创建成功');
      }
      setIsModalOpen(false);
      form.resetFields();
      setEditingId(null);
      fetchMaterials();
    } catch (error: any) {
      message.error(error?.message || '保存物料失败');
    }
  }, [editingId, form, fetchMaterials]);

  const handleEdit = useCallback((item: Material) => {
    setEditingId(item.id);
    setIsModalOpen(true);
  }, []);

  const handleDelete = useCallback(async (id: number) => {
    try {
      const check = await canDeleteMaterial(id);
      if (!check.canDelete) {
        message.warning(
          check.reason ||
            `无法删除：当前库存合计 ${check.stockTotal}，请先通过出库等方式清零后再删。`
        );
        return;
      }
      await deleteMaterial(id);
      message.success('物料删除成功');
      fetchMaterials();
    } catch (error: any) {
      message.error(error?.message || '删除物料失败');
    }
  }, [fetchMaterials]);

  const handleBatchDelete = useCallback(async () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请选择要删除的物料');
      return;
    }
    try {
      const res = await batchDeleteMaterials(selectedRowKeys.map((key) => Number(key)));
      message.success(`成功删除 ${res.deletedCount} 条物料`);
      setSelectedRowKeys([]);
      fetchMaterials();
    } catch (error: any) {
      message.error(error?.message || '批量删除物料失败');
    }
  }, [selectedRowKeys, fetchMaterials]);

  const handleExport = useCallback(async () => {
    try {
      const blob = await exportMaterials();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `物料信息_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      message.success('物料导出成功');
    } catch (error: any) {
      message.error(error?.message || '导出物料失败');
    }
  }, []);

  const parseCsvToMaterials = useCallback((text: string): SaveMaterialInput[] => {
    const lines = text.split('\n').filter((line) => line.trim());
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map((h) => h.replace(/"/g, '').trim());
    const materials: SaveMaterialInput[] = [];
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map((v) => v.replace(/"/g, '').trim());
      const material: SaveMaterialInput = {} as SaveMaterialInput;
      headers.forEach((header, index) => {
        const value = values[index];
        switch (header) {
          case '物料编码':
            material.code = value || undefined;
            break;
          case '物料名称':
            material.name = value;
            break;
          case '规格型号':
            material.spec = value || undefined;
            break;
          case '单位':
            material.unit = value || undefined;
            break;
          case '分类':
            material.category = value || undefined;
            break;
          case '来源':
            material.source = value || undefined;
            break;
          case '购价':
            material.purchase_price = value ? Number(value) : undefined;
            break;
          case '售价':
            material.sale_price = value ? Number(value) : undefined;
            break;
          case '图片URL':
            material.image_url = value || undefined;
            break;
        }
      });
      if (material.name) materials.push(material);
    }
    return materials;
  }, []);

  const handleImport = useCallback(async () => {
    if (!importFile && (!importPreviewRows || importPreviewRows.length === 0)) {
      message.warning('请选择要导入的文件');
      return;
    }
    try {
      let materials: SaveMaterialInput[] = importPreviewRows || [];
      if (materials.length === 0 && importFile) {
        const text = await importFile.text();
        materials = parseCsvToMaterials(text);
      }
      if (materials.length === 0) {
        message.error('文件中没有有效的物料数据');
        return;
      }
      const res = await batchImportMaterials(materials);
      setImportResult(res);
      message.success(`导入完成：成功 ${res.successCount} 个，失败 ${res.failedCount} 个`);
      fetchMaterials();
    } catch (error: any) {
      message.error(error?.message || '导入物料失败');
    }
  }, [importFile, importPreviewRows, parseCsvToMaterials, fetchMaterials]);

  const handleDownloadTemplate = useCallback(() => {
    const header =
      '物料编码,物料名称,规格型号,单位,分类,来源,购价,售价,图片URL';
    const example = 'M-001,示例物料,规格A,个,分类名,自购,10.5,12.5,';
    const blob = new Blob(['\uFEFF' + header + '\n' + example], {
      type: 'text/csv;charset=utf-8',
    });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '物料导入模板.csv';
    a.click();
    window.URL.revokeObjectURL(url);
    message.success('模板已下载');
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        const file = e.target.files[0];
        setImportFile(file);
        setImportResult(null);
        const reader = new FileReader();
        reader.onload = () => {
          const text = reader.result as string;
          const parsed = parseCsvToMaterials(text);
          setImportPreviewRows(parsed.length > 0 ? parsed : null);
        };
        reader.readAsText(file, 'UTF-8');
      }
    },
    [parseCsvToMaterials]
  );

  const handleImportCancel = useCallback(() => {
    setIsImportModalOpen(false);
    setImportFile(null);
    setImportResult(null);
    setImportPreviewRows(null);
  }, []);

  const handleImageUpload: UploadProps['customRequest'] = useCallback(async (options) => {
    const { file, onError, onSuccess } = options;
    try {
      const f = file as File;
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64 = reader.result as string;
          const data = await apiClient.post<{ url?: string }>('/api/upload-image', {
            filename: f.name,
            data: base64,
          });
          if (data.url) {
            form.setFieldsValue({ image_url: data.url } as any);
          }
          message.success('图片上传成功');
          onSuccess && onSuccess(data as any);
        } catch (err: any) {
          console.error(err);
          message.error(err?.message || '图片上传失败');
          onError && onError(err);
        }
      };
      reader.readAsDataURL(f);
    } catch (err: any) {
      onError && onError(err);
    }
  }, [form]);

  React.useEffect(() => {
    if (!isModalOpen || !editingId) return;
    const current = materials.find((m) => m.id === editingId);
    if (!current) return;
    form.setFieldsValue({
      code: current.code || '',
      name: current.name,
      spec: current.spec || '',
      unit: current.unit || '个',
      category_id: current.category_id || undefined,
      source: current.source || undefined,
      purchase_price: current.purchase_price ?? undefined,
      sale_price: current.sale_price ?? undefined,
      image_url: current.image_url || '',
    } as SaveMaterialInput);
  }, [isModalOpen, editingId, materials, form]);

  React.useEffect(() => {
    if (isModalOpen && editingId === null) {
      form.resetFields();
      form.setFieldsValue({ unit: '个' });
    }
  }, [isModalOpen, editingId, form]);

  const canEdit = useMemo(() => can('edit_material'), [can]);
  const canDelete = useMemo(() => can('delete_material'), [can]);
  const colAlign = 'center' as const;

  const openPreview = useCallback((record: Material) => setPreviewMaterial(record), []);

  const allColumns = useMemo(
    () => [
      {
        title: '图片',
        dataIndex: 'image_url',
        key: 'image_url',
        align: colAlign,
        width: 56,
        render: (url: string | null, record: Material) => (
          <MaterialImage url={url} name={record.name} />
        ),
      },
      {
        title: '物料编码',
        dataIndex: 'code',
        key: 'code',
        align: colAlign,
        sorter: (a: Material, b: Material) => (a.code || '').localeCompare(b.code || ''),
        render: (text: string | null) => (
          <span
            style={{
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            }}
          >
            {text || '-'}
          </span>
        ),
      },
      {
        title: '物料名称',
        dataIndex: 'name',
        key: 'name',
        align: colAlign,
        sorter: (a: Material, b: Material) => a.name.localeCompare(b.name),
        ellipsis: true,
        render: (text: string, record: Material) => (
          <Button type="link" size="small" className="p-0 h-auto" onClick={() => openPreview(record)}>
            {text}
          </Button>
        ),
      },
      {
        title: '规格型号',
        dataIndex: 'spec',
        key: 'spec',
        align: colAlign,
        sorter: (a: Material, b: Material) => (a.spec || '').localeCompare(b.spec || ''),
        ellipsis: true,
        responsive: ['md'],
        render: (text: string | null) => text || '-',
      },
      {
        title: '单位',
        dataIndex: 'unit',
        key: 'unit',
        align: colAlign,
        width: 72,
        sorter: (a: Material, b: Material) => (a.unit || '').localeCompare(b.unit || ''),
      },
      {
        title: '分类',
        dataIndex: 'category_name',
        key: 'category_name',
        align: colAlign,
        sorter: (a: Material, b: Material) => (a.category_name || '').localeCompare(b.category_name || ''),
        render: (text: string | null) => (
          <Tag color={text ? 'blue' : 'default'}>{text || '未分类'}</Tag>
        ),
      },
      {
        title: '来源',
        dataIndex: 'source',
        key: 'source',
        align: colAlign,
        sorter: (a: Material, b: Material) => (a.source || '').localeCompare(b.source || ''),
        ellipsis: true,
        render: (text: string | null) => text || '-',
      },
      {
        title: '当前库存',
        key: 'stock_total',
        align: colAlign,
        width: 88,
        sorter: (a: Material, b: Material) =>
          (stockByMaterialId.get(a.id) ?? 0) - (stockByMaterialId.get(b.id) ?? 0),
        render: (_: unknown, record: Material) => {
          const q = stockByMaterialId.get(record.id) ?? 0;
          return <span className="font-mono">{q}</span>;
        },
      },
      {
        title: '购价',
        dataIndex: 'purchase_price',
        key: 'purchase_price',
        align: colAlign,
        sorter: (a: Material, b: Material) => (a.purchase_price ?? 0) - (b.purchase_price ?? 0),
        render: (val: number | null | undefined) =>
          val != null ? (
            <span style={{ fontFamily: 'ui-monospace' }}>{Number(val).toFixed(2)}</span>
          ) : (
            '-'
          ),
      },
      {
        title: '售价',
        dataIndex: 'sale_price',
        key: 'sale_price',
        align: colAlign,
        sorter: (a: Material, b: Material) => (a.sale_price ?? 0) - (b.sale_price ?? 0),
        render: (val: number | null | undefined) =>
          val != null ? (
            <span style={{ fontFamily: 'ui-monospace' }}>{Number(val).toFixed(2)}</span>
          ) : (
            '-'
          ),
      },
      {
        title: '操作',
        key: 'actions',
        align: colAlign,
        width: 100,
        fixed: 'right' as const,
        render: (_: unknown, record: Material) => (
          <MaterialActionButtons
            record={record}
            onEdit={handleEdit}
            onDelete={handleDelete}
            canEdit={canEdit}
            canDelete={canDelete}
          />
        ),
      },
    ],
    [colAlign, handleEdit, handleDelete, canEdit, canDelete, stockByMaterialId, openPreview]
  );

  const columns = useMemo(
    () => allColumns.filter((c) => visibleColumnKeys.includes(String(c.key))),
    [allColumns, visibleColumnKeys]
  );

  const columnKeysForPopover = useMemo(
    () =>
      allColumns
        .filter((c) => c.key && c.key !== 'actions')
        .map((c) => ({ key: String(c.key), label: c.title as any })),
    [allColumns]
  );

  useEffect(() => {
    setPage(1);
  }, [filterCategoryId, filterSource, priceMin, priceMax, searchTerm]);

  const handleBatchEditSubmit = useCallback(async () => {
    const values = await batchForm.validateFields();
    const ids = selectedRowKeys.map((k) => Number(k));
    if (ids.length === 0) return;
    const updates: { category_id?: number | null; unit?: string; source?: string } = {};
    if (values.category_id !== undefined) updates.category_id = values.category_id;
    if (values.unit) updates.unit = values.unit;
    if (values.source !== undefined) updates.source = values.source || undefined;
    if (Object.keys(updates).length === 0) {
      message.warning('请至少选择一项要修改的字段');
      return;
    }
    try {
      const res = await batchUpdateMaterials(ids, updates);
      message.success(`已更新 ${res.updatedCount} 条物料`);
      setBatchEditOpen(false);
      batchForm.resetFields();
      setSelectedRowKeys([]);
      fetchMaterials();
    } catch (e: any) {
      message.error(e?.message || '批量更新失败');
    }
  }, [batchForm, selectedRowKeys, fetchMaterials]);

  return (
    <div className="space-y-4">
      <PageHeader
        icon={<PackageIcon size={22} className="text-blue-500" />}
        title="物料管理"
        subtitle="管理仓库中的所有物料基础信息。"
        actions={
          <>
            {can('export') && (
              <Button icon={<DownloadOutlined />} onClick={handleExport}>
                导出
              </Button>
            )}
            {can('edit_material') && (
              <Button icon={<InboxOutlined />} onClick={() => setIsImportModalOpen(true)}>
                导入
              </Button>
            )}
            {can('edit_material') && selectedRowKeys.length > 0 && (
              <Button icon={<EditOutlined />} onClick={() => setBatchEditOpen(true)}>
                批量编辑 ({selectedRowKeys.length})
              </Button>
            )}
            {can('delete_material') && selectedRowKeys.length > 0 && (
              <Popconfirm
                title={`确定删除选中的 ${selectedRowKeys.length} 条物料？`}
                description="所选物料均须已无库存；任一未清零则整批不删除，请先出库清零后再试。"
                okText="确定"
                cancelText="取消"
                onConfirm={handleBatchDelete}
              >
                <Button danger icon={<DeleteOutlined />}>
                  批量删除 ({selectedRowKeys.length})
                </Button>
              </Popconfirm>
            )}
            {can('edit_material') && (
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => {
                  setEditingId(null);
                  setIsModalOpen(true);
                }}
              >
              新增物料
            </Button>
            )}
          </>
        }
      />

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 overflow-x-auto">
        <Space
          wrap
          style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}
          className="w-full"
        >
          <Space wrap>
            <Input
              allowClear
              placeholder="搜索名称、编码、规格、单位、来源..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              prefix={<SearchOutlined className="text-slate-400" />}
              className="w-full sm:max-w-[320px]"
            />
            <Select
              placeholder="分类"
              style={{ width: 160 }}
              value={filterCategoryId == null ? '__ALL__' : filterCategoryId}
              onChange={(v) => setFilterCategoryId(v === '__ALL__' ? null : Number(v))}
              options={[
                { label: '全部分类', value: '__ALL__' },
                ...categories.map((c) => ({ label: c.name, value: c.id })),
              ]}
            />
            <Select
              placeholder="来源"
              style={{ width: 160 }}
              value={filterSource == null ? '__ALL__' : filterSource}
              onChange={(v) => setFilterSource(v === '__ALL__' ? null : String(v))}
              options={[
                { label: '全部来源', value: '__ALL__' },
                ...sources.map((s) => ({ label: s.name, value: s.name })),
              ]}
            />
            <InputNumber
              placeholder="购/售价≥"
              min={0}
              style={{ width: 110 }}
              value={priceMin}
              onChange={(v) => setPriceMin(v ?? undefined)}
            />
            <InputNumber
              placeholder="购/售价≤"
              min={0}
              style={{ width: 110 }}
              value={priceMax}
              onChange={(v) => setPriceMax(v ?? undefined)}
            />
            <Button onClick={() => fetchMaterials()} loading={loading}>
              刷新
            </Button>
          </Space>
          <ColumnVisibilityPopover
            allKeys={columnKeysForPopover}
            visibleKeys={visibleColumnKeys}
            onToggle={toggleColumn}
            onReset={resetColumns}
          />
        </Space>
        {loading ? (
          <div className="py-6 space-y-3">
            <Skeleton active paragraph={{ rows: 1 }} />
            <Skeleton active paragraph={{ rows: 8 }} />
          </div>
        ) : (
          <Table
            rowKey="id"
            columns={columns}
            dataSource={filteredMaterials}
            pagination={{
              current: page,
              pageSize,
              total: filteredMaterials.length,
              showSizeChanger: true,
              pageSizeOptions: PAGE_SIZE_OPTIONS,
              showTotal: (t) => `共 ${t} 条`,
              onChange: (p, ps) => {
                setPage(p);
                setPageSize(ps);
              },
            }}
            size="middle"
            loading={false}
            scroll={{ x: 960 }}
            className="wms-table"
            rowSelection={{
              selectedRowKeys,
              onChange: setSelectedRowKeys,
              selections: [Table.SELECTION_ALL, Table.SELECTION_INVERT, Table.SELECTION_NONE],
            }}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={
                    searchInput || filterCategoryId != null || (filterSource != null && filterSource !== '') ? (
                      '未找到匹配的物料'
                    ) : (
                      <span>暂无物料，点击「新增物料」添加第一个物料</span>
                    )
                  }
                />
              ),
            }}
          />
        )}
      </div>

      <Modal
        title={editingId ? '编辑物料' : '新增物料'}
        open={isModalOpen}
        onCancel={() => {
          setIsModalOpen(false);
          setEditingId(null);
        }}
        onOk={handleSubmit}
        okText="保存"
        cancelText="取消"
        destroyOnHidden
        style={{ top: 'clamp(16px, 3vh, 40px)' }}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ unit: '个' }}
        >
          <Form.Item
            label="物料编码"
            name="code"
            rules={[
              { max: 64, message: '编码最长 64 个字符' },
              {
                pattern: /^[A-Za-z0-9_\-\u4e00-\u9fa5]*$/,
                message: '编码仅允许字母、数字、下划线、连字符与中文',
              },
              {
                validator: async (_, value) => {
                  const v = (value || '').trim();
                  if (!v) return Promise.resolve();
                  const res = await checkMaterialCode(v, editingId ?? undefined);
                  if (!res.available) {
                    return Promise.reject(new Error(res.error || '该编码已存在'));
                  }
                  return Promise.resolve();
                },
              },
            ]}
          >
            <Input placeholder="可留空，系统自动生成；如需自定义：M-001" />
          </Form.Item>
          <Form.Item
            label="物料名称"
            name="name"
            rules={[
              { required: true, message: '请输入物料名称' },
              { max: 120, message: '名称最长 120 个字符' },
            ]}
          >
            <Input placeholder="如：螺栓" />
          </Form.Item>
          <Form.Item label="规格型号" name="spec">
            <Input placeholder="如：M8*20" />
          </Form.Item>
          <Form.Item label="来源" name="source">
            <Select
              allowClear
              placeholder="请选择物料来源"
              options={sources.map((s) => ({ label: s.name, value: s.name }))}
            />
          </Form.Item>
          <Form.Item label="购价" name="purchase_price">
            <InputNumber
              style={{ width: '100%' }}
              min={0}
              precision={2}
              placeholder="最近采购单价"
            />
          </Form.Item>
          <Form.Item label="售价" name="sale_price">
            <InputNumber
              style={{ width: '100%' }}
              min={0}
              precision={2}
              placeholder="对外销售单价"
            />
          </Form.Item>
          <Form.Item label="单位" name="unit">
            <Select
              showSearch
              placeholder="请选择单位"
              options={
                units.length > 0
                  ? units.map((u) => ({ label: u.name, value: u.name }))
                  : [
                      { label: '个', value: '个' },
                      { label: '套', value: '套' },
                      { label: '米', value: '米' },
                      { label: '千克', value: '千克' },
                    ]
              }
            />
          </Form.Item>
          <Form.Item label="物料分类" name="category_id">
            <Select
              allowClear
              placeholder="请选择物料分类"
              options={categories.map((c) => ({ label: c.name, value: c.id }))}
            />
          </Form.Item>
          <Form.Item label="物料图片">
            <Space align="start">
              <Form.Item name="image_url" noStyle>
                <Input style={{ width: 260 }} placeholder="图片 URL，或使用右侧本地上传" />
              </Form.Item>
              <Upload
                accept="image/*"
                showUploadList={false}
                customRequest={handleImageUpload}
              >
                <Button icon={<UploadOutlined />}>本地上传</Button>
              </Upload>
            </Space>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              开发阶段：图片会保存到本地服务器的 /uploads 目录，字段中自动写入访问地址。
            </Typography.Text>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="导入物料"
        open={isImportModalOpen}
        onCancel={handleImportCancel}
        onOk={handleImport}
        okText={importPreviewRows && importPreviewRows.length > 0 ? '确认导入' : '导入'}
        cancelText="取消"
        destroyOnHidden
        width={720}
        style={{ top: 'clamp(16px, 3vh, 40px)' }}
      >
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 items-center">
            <Button type="link" icon={<DownloadOutlined />} onClick={handleDownloadTemplate}>
              下载 CSV 模板
            </Button>
            <Typography.Text type="secondary" className="text-xs">
              列顺序：物料编码, 物料名称, 规格型号, 单位, 分类, 来源, 购价, 售价, 图片URL
            </Typography.Text>
          </div>
          <div>
            <input
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="w-full p-2 border border-slate-200 rounded-md"
            />
            {importFile && (
              <p className="mt-2 text-sm text-slate-600">已选择文件：{importFile.name}</p>
            )}
          </div>
          {importPreviewRows && importPreviewRows.length > 0 && !importResult && (
            <div>
              <p className="text-sm font-medium mb-2">解析预览（共 {importPreviewRows.length} 条，确认后提交）</p>
              <div className="max-h-48 overflow-auto border border-slate-200 rounded-md">
                <Table
                  size="small"
                  pagination={false}
                  rowKey={(_, i) => String(i)}
                  dataSource={importPreviewRows.slice(0, 50)}
                  columns={[
                    { title: '名称', dataIndex: 'name', ellipsis: true },
                    { title: '编码', dataIndex: 'code', width: 100, ellipsis: true },
                    { title: '单位', dataIndex: 'unit', width: 60 },
                    { title: '来源', dataIndex: 'source', width: 80, ellipsis: true },
                  ]}
                />
              </div>
              {importPreviewRows.length > 50 && (
                <p className="text-xs text-slate-500 mt-1">仅显示前 50 条，导入时将全部提交。</p>
              )}
            </div>
          )}
          {importResult && (
            <div className="mt-4">
              <Alert
                message={`导入结果：成功 ${importResult.successCount} 个，失败 ${importResult.failedCount} 个`}
                type={importResult.failedCount > 0 ? 'warning' : 'success'}
                showIcon
              />
              {importResult.failedCount > 0 && (
                <div className="mt-2">
                  <p className="text-sm text-slate-600">失败项：</p>
                  <div className="mt-1 p-2 bg-slate-50 border border-slate-200 rounded-md max-h-40 overflow-y-auto">
                    {importResult.failedItems.map((item, index) => (
                      <div key={index} className="text-xs text-slate-700 mb-1">
                        <span className="font-medium">{item.item.name || '未命名'}</span>: {item.error}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>

      <Modal
        title="物料详情"
        open={!!previewMaterial}
        onCancel={() => setPreviewMaterial(null)}
        footer={[
          <Button key="close" onClick={() => setPreviewMaterial(null)}>
            关闭
          </Button>,
          canEdit && previewMaterial && (
            <Button
              key="edit"
              type="primary"
              onClick={() => {
                if (previewMaterial) handleEdit(previewMaterial);
                setPreviewMaterial(null);
              }}
            >
              编辑
            </Button>
          ),
        ]}
        destroyOnHidden
        width={640}
      >
        {previewMaterial && (
          <div className="space-y-4">
            <div className="flex gap-4">
              {previewMaterial.image_url && (
                <PreviewImage url={previewMaterial.image_url} name={previewMaterial.name} thumbSize={120} />
              )}
              <div className="flex-1 space-y-1 text-sm">
                <div><span className="text-slate-500">名称：</span>{previewMaterial.name}</div>
                <div><span className="text-slate-500">编码：</span>{previewMaterial.code || '-'}</div>
                <div><span className="text-slate-500">规格：</span>{previewMaterial.spec || '-'}</div>
                <div><span className="text-slate-500">分类：</span>{previewMaterial.category_name || '未分类'}</div>
                <div><span className="text-slate-500">来源：</span>{previewMaterial.source || '-'}</div>
                <div>
                  <span className="text-slate-500">购价/售价：</span>
                  {previewMaterial.purchase_price != null ? Number(previewMaterial.purchase_price).toFixed(2) : '-'}
                  {' / '}
                  {previewMaterial.sale_price != null ? Number(previewMaterial.sale_price).toFixed(2) : '-'}
                </div>
                <div>
                  <span className="text-slate-500">当前库存合计：</span>
                  <span className="font-mono font-medium">
                    {stockByMaterialId.get(previewMaterial.id) ?? 0}
                  </span>
                </div>
              </div>
            </div>
            <div>
              <p className="text-sm font-medium mb-2">库存分布</p>
              <Table
                size="small"
                pagination={false}
                dataSource={inventoryList.filter((r) => r.material_id === previewMaterial.id)}
                rowKey={(r) => `${r.material_id}-${r.location_id}`}
                columns={[
                  { title: '仓位', dataIndex: 'location_name' },
                  { title: '数量', dataIndex: 'quantity', align: 'right' as const },
                ]}
                locale={{ emptyText: '暂无库存记录' }}
              />
            </div>
          </div>
        )}
      </Modal>

      <Modal
        title={`批量编辑（${selectedRowKeys.length} 条）`}
        open={batchEditOpen}
        onCancel={() => setBatchEditOpen(false)}
        onOk={handleBatchEditSubmit}
        okText="保存"
        cancelText="取消"
        destroyOnHidden
      >
        <Form form={batchForm} layout="vertical">
          <Form.Item label="物料分类" name="category_id">
            <Select
              allowClear
              placeholder="不修改则留空"
              options={categories.map((c) => ({ label: c.name, value: c.id }))}
            />
          </Form.Item>
          <Form.Item label="单位" name="unit">
            <Select
              allowClear
              placeholder="不修改则留空"
              options={
                units.length > 0
                  ? units.map((u) => ({ label: u.name, value: u.name }))
                  : [{ label: '个', value: '个' }]
              }
            />
          </Form.Item>
          <Form.Item label="来源" name="source">
            <Select
              allowClear
              placeholder="不修改则留空"
              options={sources.map((s) => ({ label: s.name, value: s.name }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
