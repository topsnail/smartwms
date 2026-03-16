import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Table, Input, Switch, Space, Tooltip, message, InputNumber, Modal, Form, Button, Tag, Skeleton, Empty, Select } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { EnvironmentOutlined, AlertOutlined, EditOutlined, WarningOutlined, SearchOutlined, ReloadOutlined, DownloadOutlined, SettingOutlined } from '@ant-design/icons';
import { Database as DatabaseIcon } from 'lucide-react';
import { getInventory, getInventoryAlerts, updateInventoryAlert, type InventoryItem } from '../api/inventory';
import { useAuth } from '../contexts/AuthContext';
import { PageHeader } from '../components/PageHeader';
import { downloadWithAuth } from '../api/download';
import { format } from 'date-fns';
import { DEFAULT_DEBOUNCE_MS, DEFAULT_PAGE_SIZE, DEFAULT_PAGE_SIZE_OPTIONS } from '../constants/table';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useColumnVisibility } from '../hooks/useColumnVisibility';
import { ColumnVisibilityPopover } from '../components/ColumnVisibilityPopover';
import { PreviewImage } from '../components/PreviewImage';

const DEFAULT_LOW_STOCK_THRESHOLD = 10;

function isAlertItem(item: InventoryItem): boolean {
  const hasMin = item.min_stock > 0 && item.quantity <= item.min_stock;
  const hasMax = item.max_stock > 0 && item.quantity >= item.max_stock;
  return hasMin || hasMax;
}

export default function Inventory() {
  const { can } = useAuth();
  const [searchParams] = useSearchParams();
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [alertInventory, setAlertInventory] = useState<InventoryItem[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const debouncedKeyword = useDebouncedValue(searchInput, DEFAULT_DEBOUNCE_MS);
  const [filterLocation, setFilterLocation] = useState<string | null>(null);
  const [showLowStockOnly, setShowLowStockOnly] = useState(false);
  const [showAlertOnly, setShowAlertOnly] = useState(false);
  const [lowStockThreshold, setLowStockThreshold] = useState(DEFAULT_LOW_STOCK_THRESHOLD);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isAlertModalOpen, setIsAlertModalOpen] = useState(false);
  const [editingAlert, setEditingAlert] = useState<InventoryItem | null>(null);
  const [alertForm] = Form.useForm();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const defaultVisibleKeys = ['image_url', 'location_name', 'code', 'name', 'spec', 'quantity', 'alert_threshold'];
  const { visibleKeys: visibleColumnKeys, toggle: toggleColumn, reset: resetColumns } = useColumnVisibility({
    defaultKeys: defaultVisibleKeys,
    storageKey: 'inventory.visibleColumns',
  });

  // 支持从 URL 读取筛选参数：keyword、location
  useEffect(() => {
    const keyword = searchParams.get('keyword') || '';
    const location = searchParams.get('location');
    if (keyword) {
      setSearchInput(keyword);
    }
    if (location) {
      setFilterLocation(location);
    }
  }, []);

  // 从本地存储加载低库存阈值
  useEffect(() => {
    const savedThreshold = localStorage.getItem('lowStockThreshold');
    if (savedThreshold) {
      setLowStockThreshold(Number(savedThreshold));
    }
  }, []);

  // 保存低库存阈值到本地存储
  useEffect(() => {
    localStorage.setItem('lowStockThreshold', lowStockThreshold.toString());
  }, [lowStockThreshold]);

  const fetchInventory = useCallback(() => {
    setLoading(true);
    setError(null);
    getInventory()
      .then(setInventory)
      .catch((err) => {
        console.error(err);
        setError('加载库存数据失败，请稍后重试');
        message.error('加载库存数据失败，请稍后重试');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchInventory();
  }, [fetchInventory]);

  useEffect(() => {
    setPage(1);
  }, [debouncedKeyword]);

  useEffect(() => {
    setPage(1);
  }, [filterLocation, showLowStockOnly, showAlertOnly, debouncedKeyword]);

  const fetchAlertInventory = useCallback(() => {
    getInventoryAlerts()
      .then(setAlertInventory)
      .catch((err) => {
        console.error(err);
      });
  }, []);

  useEffect(() => {
    fetchAlertInventory();
  }, [fetchAlertInventory, inventory]);

  const handleUpdateAlert = useCallback(async () => {
    if (!editingAlert) return;
    try {
      const values = await alertForm.validateFields();
      await updateInventoryAlert(editingAlert.material_id, editingAlert.location_id, values.min_stock, values.max_stock);
      message.success('库存预警阈值更新成功');
      setIsAlertModalOpen(false);
      setEditingAlert(null);
      fetchAlertInventory();
      fetchInventory();
    } catch (error: any) {
      message.error(error?.message || '更新库存预警阈值失败');
    }
  }, [editingAlert, alertForm, fetchAlertInventory, fetchInventory]);

  const openAlertModal = useCallback((item: InventoryItem) => {
    setEditingAlert(item);
    alertForm.setFieldsValue({
      min_stock: item.min_stock || 0,
      max_stock: item.max_stock || 0,
    });
    setIsAlertModalOpen(true);
  }, [alertForm]);

  const locationOptions = useMemo(() => {
    const names = Array.from(new Set(inventory.map((i) => i.location_name).filter(Boolean))) as string[];
    names.sort();
    return names;
  }, [inventory]);

  const filteredInventory = useMemo(() => {
    const term = String(debouncedKeyword || '').toLowerCase().trim();
    return inventory.filter((item) => {
      const matchesSearch = !term || (
        item.name.toLowerCase().includes(term) ||
        item.code.toLowerCase().includes(term) ||
        item.location_name.toLowerCase().includes(term) ||
        (item.spec && item.spec.toLowerCase().includes(term)) ||
        (item.unit && item.unit.toLowerCase().includes(term))
      );
      const threshold = Math.max(0, Number(lowStockThreshold) || 0);
      const matchesLowStock = showLowStockOnly ? item.quantity < threshold : true;
      const matchesLocation = filterLocation == null || filterLocation === '' || item.location_name === filterLocation;
      const matchesAlert = showAlertOnly ? isAlertItem(item) : true;
      return matchesSearch && matchesLowStock && matchesLocation && matchesAlert;
    });
  }, [inventory, debouncedKeyword, lowStockThreshold, showLowStockOnly, filterLocation, showAlertOnly]);

  const quantityTotal = useMemo(
    () => filteredInventory.reduce((sum, i) => sum + (i.quantity ?? 0), 0),
    [filteredInventory]
  );

  const handleSettingsSubmit = () => {
    form.validateFields().then((values) => {
      setLowStockThreshold(values.threshold);
      setIsSettingsModalOpen(false);
      message.success('低库存阈值已更新');
    });
  };

  const openSettingsModal = () => {
    form.setFieldsValue({ threshold: lowStockThreshold });
    setIsSettingsModalOpen(true);
  };

  const handleExport = useCallback(async () => {
    try {
      await downloadWithAuth(
        '/api/export/inventory',
        `库存_${format(new Date(), 'yyyyMMdd')}.csv`
      );
      message.success('导出成功');
    } catch (e: any) {
      message.error(e?.message || '导出失败');
    }
  }, []);

  const colAlign = 'center' as const;
  const allColumns: ColumnsType<InventoryItem> = useMemo(() => [
    {
      title: '图片',
      dataIndex: 'image_url',
      key: 'image_url',
      align: colAlign,
      width: 56,
      render: (url: string | null | undefined, record: InventoryItem) => (
        <PreviewImage url={url} name={record.name} />
      ),
    },
    {
      title: '库位',
      dataIndex: 'location_name',
      key: 'location_name',
      align: colAlign,
      fixed: 'left',
      render: (text: string) => (
        <Space>
          <EnvironmentOutlined style={{ color: '#1677ff' }} />
          <span>{text}</span>
        </Space>
      ),
    },
    {
      title: '物料编码',
      dataIndex: 'code',
      key: 'code',
      align: colAlign,
      fixed: 'left',
      render: (text: string) => (
        <span
          style={{
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
          }}
        >
          {text}
        </span>
      ),
    },
    {
      title: '物料名称',
      dataIndex: 'name',
      key: 'name',
      align: colAlign,
      ellipsis: true,
    },
    {
      title: '规格型号',
      dataIndex: 'spec',
      key: 'spec',
      align: colAlign,
      ellipsis: true,
      render: (text: string | null) => text ? text : '-',
    },
    {
      title: '数量',
      dataIndex: 'quantity',
      key: 'quantity',
      align: colAlign,
      sorter: (a, b) => a.quantity - b.quantity,
      render: (_: number, record: InventoryItem) => {
        const threshold = Math.max(0, Number(lowStockThreshold) || 0);
        const lowStock = record.quantity < threshold;
        const hasMinAlert = record.min_stock > 0 && record.quantity <= record.min_stock;
        const hasMaxAlert = record.max_stock > 0 && record.quantity >= record.max_stock;
        const alertType = hasMinAlert ? 'low' : hasMaxAlert ? 'high' : null;
        return (
          <Space>
            {alertType && (
              <Tooltip title={alertType === 'low' ? '低于最小库存预警' : '高于最大库存预警'}>
                <WarningOutlined style={{ color: alertType === 'low' ? '#fa541c' : '#faad14' }} />
              </Tooltip>
            )}
            {lowStock && !alertType && (
              <Tooltip title="低库存预警">
                <AlertOutlined style={{ color: '#faad14' }} />
              </Tooltip>
            )}
            <span
              style={{
                fontWeight: 600,
                color: alertType ? (alertType === 'low' ? '#fa541c' : '#faad14') : (lowStock ? '#fa541c' : '#1677ff'),
              }}
            >
              {record.quantity}
            </span>
            <span style={{ fontSize: 12, color: '#94a3b8' }}>
              {record.unit}
            </span>
          </Space>
        );
      },
    },
    {
      title: '预警阈值',
      key: 'alert_threshold',
      align: colAlign,
      render: (_: unknown, record: InventoryItem) => (
        <Space orientation="vertical" size="small">
          <div>
            <Tag color={record.min_stock > 0 ? 'orange' : 'default'}>最小: {record.min_stock || 0}</Tag>
            <Tag color={record.max_stock > 0 ? 'blue' : 'default'}>最大: {record.max_stock || 0}</Tag>
          </div>
          {can('inventory_alert_edit') && (
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => openAlertModal(record)}
            >
              设置
            </Button>
          )}
        </Space>
      ),
    },
  ], [colAlign, lowStockThreshold, can, openAlertModal]);

  const columns = useMemo(
    () => allColumns.filter((c) => c.key && visibleColumnKeys.includes(String(c.key))),
    [allColumns, visibleColumnKeys]
  );

  const columnKeysForPopover = useMemo(
    () =>
      allColumns
        .filter((c) => c.key)
        .map((c) => ({ key: String(c.key), label: c.title as any })),
    [allColumns]
  );

  const rowClassName = useCallback((record: InventoryItem) => (isAlertItem(record) ? 'bg-orange-50/60' : ''), []);

  return (
    <div className="space-y-4">
      <PageHeader
        icon={<DatabaseIcon size={22} className="text-blue-500" />}
        title="实时库存"
        subtitle="查看当前仓库中所有物料的实时库存分布情况。"
        actions={
          <>
            <Button icon={<ReloadOutlined />} onClick={fetchInventory} loading={loading}>
              刷新
            </Button>
            {can('export') && (
              <Button icon={<DownloadOutlined />} onClick={handleExport}>
                导出
              </Button>
            )}
          </>
        }
      />

      {alertInventory.length > 0 && (
        <div
          className="bg-orange-50 border border-orange-100 rounded-xl p-4 flex items-center gap-3 cursor-pointer hover:bg-orange-100/50 transition-colors"
          onClick={() => setShowAlertOnly((v) => !v)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && setShowAlertOnly((v) => !v)}
        >
          <WarningOutlined style={{ color: '#fa541c' }} />
          <span className="text-orange-700">
            当前有 <strong>{alertInventory.length}</strong> 条触发了库存预警，点击{showAlertOnly ? '取消筛选' : '仅看预警'}。
          </span>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-100 rounded-xl p-4 flex items-center gap-3">
          <AlertOutlined style={{ color: '#fa541c' }} />
          <span className="text-red-700">{error}</span>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 overflow-x-auto">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <Input
            allowClear
            prefix={<SearchOutlined className="text-slate-400" />}
            placeholder="搜索物料名称、编码、库位、规格或单位..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            style={{ maxWidth: 320, width: '100%' }}
          />
          <Select
            placeholder="库位"
            style={{ width: 160 }}
            value={filterLocation == null ? '__ALL__' : filterLocation}
            onChange={(v) => setFilterLocation(v === '__ALL__' ? null : String(v))}
            options={[
              { label: '全部库位', value: '__ALL__' },
              ...locationOptions.map((name) => ({ label: name, value: name })),
            ]}
          />
          <Space wrap align="center">
            <Switch checked={showAlertOnly} onChange={setShowAlertOnly} />
            <span className="text-sm text-slate-600">仅看预警</span>
          </Space>
          <Space wrap align="center">
            <span className="text-sm text-slate-600">仅看低库存（&lt;</span>
            <InputNumber
              min={0}
              max={99999}
              value={lowStockThreshold}
              onChange={(v) => setLowStockThreshold(v ?? DEFAULT_LOW_STOCK_THRESHOLD)}
              style={{ width: 72 }}
            />
            <span className="text-sm text-slate-600">）</span>
            <Switch checked={showLowStockOnly} onChange={setShowLowStockOnly} />
            <Tooltip title="设置低库存阈值（仅用于本页筛选与图标，与每行预警阈值无关）">
              <SettingOutlined
                style={{ cursor: 'pointer', color: '#1677ff' }}
                onClick={openSettingsModal}
              />
            </Tooltip>
          </Space>
          <ColumnVisibilityPopover
            allKeys={columnKeysForPopover}
            visibleKeys={visibleColumnKeys}
            onToggle={toggleColumn}
            onReset={resetColumns}
          />
        </div>

        {loading ? (
          <div className="py-6 space-y-3">
            <Skeleton active paragraph={{ rows: 1 }} />
            <Skeleton active paragraph={{ rows: 8 }} />
          </div>
        ) : (
          <>
            <Table
              rowKey={(record) => `${record.material_id}-${record.location_id}`}
              columns={columns}
              dataSource={filteredInventory}
              pagination={{
                current: page,
                pageSize,
                total: filteredInventory.length,
                showSizeChanger: true,
                pageSizeOptions: DEFAULT_PAGE_SIZE_OPTIONS,
                showTotal: (t) => `共 ${t} 条，数量合计 ${quantityTotal}`,
                onChange: (p, ps) => {
                  setPage(p);
                  setPageSize(ps);
                },
              }}
              size="middle"
              className="wms-table"
              scroll={{ x: 800 }}
              rowClassName={rowClassName}
              locale={{
                emptyText: (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={
                      searchInput || filterLocation != null || showLowStockOnly || showAlertOnly
                        ? '未找到匹配的库存记录'
                        : '当前仓库为空，暂无库存记录。'
                    }
                  />
                ),
              }}
            />
          </>
        )}

        {/* 设置低库存阈值模态框 */}
        <Modal
          title="设置低库存阈值"
          open={isSettingsModalOpen}
          onCancel={() => setIsSettingsModalOpen(false)}
          onOk={handleSettingsSubmit}
          okText="保存"
          cancelText="取消"
        >
          <Form form={form} layout="vertical">
            <Form.Item
              label="低库存阈值"
              name="threshold"
              rules={[
                { required: true, message: '请输入低库存阈值' },
                { type: 'number', min: 0, message: '阈值必须大于等于0' }
              ]}
            >
              <InputNumber
                min={0}
                max={99999}
                style={{ width: '100%' }}
                placeholder="请输入低库存阈值"
              />
            </Form.Item>
            <p className="text-sm text-slate-500">
              用于本页「仅看低库存」筛选及数量列旁的低库存图标；与每行「预警阈值」的最小/最大设置无关。
            </p>
          </Form>
        </Modal>

        {/* 设置库存预警阈值模态框 */}
        <Modal
          title="设置库存预警阈值"
          open={isAlertModalOpen}
          onCancel={() => {
            setIsAlertModalOpen(false);
            setEditingAlert(null);
          }}
          onOk={handleUpdateAlert}
          okText="保存"
          cancelText="取消"
        >
          <Form form={alertForm} layout="vertical">
            <Form.Item
              label="最小库存阈值"
              name="min_stock"
              rules={[
                { type: 'number', min: 0, message: '阈值必须大于等于0' }
              ]}
            >
              <InputNumber
                min={0}
                max={99999}
                style={{ width: '100%' }}
                placeholder="当库存低于此值时触发预警（0表示不启用）"
              />
            </Form.Item>
            <Form.Item
              label="最大库存阈值"
              name="max_stock"
              rules={[
                { type: 'number', min: 0, message: '阈值必须大于等于0' }
              ]}
            >
              <InputNumber
                min={0}
                max={99999}
                style={{ width: '100%' }}
                placeholder="当库存高于此值时触发预警（0表示不启用）"
              />
            </Form.Item>
            <p className="text-sm text-slate-500">
              设置最小和最大库存阈值，当库存低于最小值或高于最大值时，系统会显示预警提示。
            </p>
          </Form>
        </Modal>
      </div>
    </div>
  );
}

