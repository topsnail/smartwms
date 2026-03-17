import React from 'react';
import { Link } from 'react-router-dom';
import { Table, Tag, Input, Button, DatePicker, Space, Tooltip, message, Popconfirm, Skeleton, Empty, Select, Drawer, Checkbox, Popover } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import dayjs from 'dayjs';
import { DownloadOutlined, SearchOutlined, SettingOutlined } from '@ant-design/icons';
import { getOperationLogs, type OperationLog } from '../api/logs';
import { useAuth } from '../contexts/AuthContext';
import { downloadWithAuth } from '../api/download';
import { apiClient } from '../api/client';
import { FileText } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { IpWithGeo } from '../components/IpWithGeo';
import { buildCommonRangePresets } from '../constants/datePresets';
import { parseUtc } from '../utils/date';
import { notifyError } from '../utils/notify';
import { ACTION_LABELS, FIELD_LABELS, PERMISSION_LABELS, ROLE_LABELS } from '../constants/operationLogLabels';

function formatActionLabel(action: string): string {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action];
  const suffix = action.replace(/^(CREATE_|UPDATE_|DELETE_)/, '');
  const suffixZh = suffix
    .split('_')
    .filter(Boolean)
    .join('');
  if (action.startsWith('CREATE_')) return `新增${suffixZh || '记录'}`;
  if (action.startsWith('UPDATE_')) return `编辑${suffixZh || '记录'}`;
  if (action.startsWith('DELETE_')) return `删除${suffixZh || '记录'}`;
  return '其他操作';
}

function tryParseJson(value?: string | null): any | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function valueToText(v: unknown): string {
  if (v === null || v === undefined || v === '') return '空';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function isEmptyValue(v: unknown): boolean {
  return v === null || v === undefined || v === '';
}

function formatPermList(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const keys = list.map(String).map((s) => s.trim()).filter(Boolean);
  const uniq = Array.from(new Set(keys));
  uniq.sort((a, b) => a.localeCompare(b));
  return uniq.map((k) => PERMISSION_LABELS[k] || k);
}

function formatRolePermChanges(oldObj: any, newObj: any): string[] {
  const roles = Array.from(new Set([...Object.keys(oldObj || {}), ...Object.keys(newObj || {})]));
  const lines: string[] = [];
  for (const r of roles) {
    const before = Array.isArray(oldObj?.[r]) ? oldObj[r].map(String) : [];
    const after = Array.isArray(newObj?.[r]) ? newObj[r].map(String) : [];
    const bSet = new Set(before);
    const aSet = new Set(after);
    const added = Array.from(aSet).filter((p) => !bSet.has(p));
    const removed = Array.from(bSet).filter((p) => !aSet.has(p));
    if (!added.length && !removed.length) continue;
    const roleName = ROLE_LABELS[r] || r;
    const parts: string[] = [];
    if (added.length) parts.push(`新增：${formatPermList(added).join('、')}`);
    if (removed.length) parts.push(`移除：${formatPermList(removed).join('、')}`);
    lines.push(`【${roleName}】${parts.join('；')}`);
  }
  return lines;
}

function formatChangeDetails(action: string, oldValue?: string | null, newValue?: string | null): string[] {
  if (!oldValue && !newValue) return [];

  const oldObj = tryParseJson(oldValue);
  const newObj = tryParseJson(newValue);

  // 角色权限：角色 -> 权限数组，输出中文差异
  if (action === 'UPDATE_ROLE_PERMISSIONS' && oldObj && newObj && typeof oldObj === 'object' && typeof newObj === 'object') {
    const lines = formatRolePermChanges(oldObj, newObj);
    return lines.length ? lines : ['角色权限无变化'];
  }

  // 角色权限（仅 newValue）：第一次配置或旧日志无 oldValue
  if (action === 'UPDATE_ROLE_PERMISSIONS' && !oldObj && newObj && typeof newObj === 'object') {
    const roles = Object.keys(newObj);
    const lines: string[] = [];
    for (const r of roles) {
      const roleName = ROLE_LABELS[r] || r;
      const perms = formatPermList((newObj as any)[r]);
      if (!perms.length) continue;
      lines.push(`【${roleName}】设置为：${perms.join('、')}`);
    }
    return lines.length ? lines : ['已保存角色权限'];
  }

  // 对象形式：逐字段对比
  if (oldObj && newObj && typeof oldObj === 'object' && typeof newObj === 'object') {
    const keys = Array.from(new Set([...Object.keys(oldObj), ...Object.keys(newObj)]));
    const lines: string[] = [];
    for (const key of keys) {
      const before = (oldObj as any)[key];
      const after = (newObj as any)[key];
      // 将 null/undefined/'' 视为同一种空值，避免“空 -> 空”噪音
      if (before === after) continue;
      if (isEmptyValue(before) && isEmptyValue(after)) continue;
      const label = FIELD_LABELS[key] || key;
      lines.push(`【${label}】从「${valueToText(before)}」改为「${valueToText(after)}」`);
    }
    return lines.length ? lines : ['字段内容有调整'];
  }

  // 纯文本：直接显示前后变化
  if (oldValue && newValue) {
    return [`从「${oldValue}」改为「${newValue}」`];
  }
  if (!oldValue && newValue) {
    return [`设置为「${newValue}」`];
  }
  if (oldValue && !newValue) {
    return [`从「${oldValue}」清空`];
  }
  return [];
}

export default function OperationLogs() {
  const { can, user } = useAuth();
  const [logs, setLogs] = React.useState<OperationLog[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [actionFilter, setActionFilter] = React.useState<string | null>(null);
  const [actionsFilter, setActionsFilter] = React.useState<string[]>([]);
  const [operatorInput, setOperatorInput] = React.useState('');
  const [operatorFilter, setOperatorFilter] = React.useState('');
  const [keywordInput, setKeywordInput] = React.useState('');
  const [keywordFilter, setKeywordFilter] = React.useState('');
  const [clientIpInput, setClientIpInput] = React.useState('');
  const [clientIpFilter, setClientIpFilter] = React.useState('');
  const [moduleFilter, setModuleFilter] = React.useState<string | null>(null);
  const [dateRange, setDateRange] = React.useState<[dayjs.Dayjs | null, dayjs.Dayjs | null]>([null, null]);
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(20);
  const [total, setTotal] = React.useState(0);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchSeq = React.useRef(0);

  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [activeLog, setActiveLog] = React.useState<OperationLog | null>(null);

  const defaultVisibleKeys = ['created_at', 'action', 'description', 'changes', 'operator', 'client_ip'];
  const [visibleColumnKeys, setVisibleColumnKeys] = React.useState<string[]>(defaultVisibleKeys);

  const showExport = can('export') || can('export_operation_logs');

  const fetchLogs = React.useCallback(() => {
    setLoading(true);
    const seq = ++fetchSeq.current;
    const params: {
      action?: string;
      actions?: string[];
      operator?: string;
      keyword?: string;
      client_ip?: string;
      module?: string;
      start_date?: string;
      end_date?: string;
      page?: number;
      pageSize?: number;
    } = {};
    if (actionFilter) params.action = actionFilter;
    if (actionsFilter.length) params.actions = actionsFilter;
    if (operatorFilter) params.operator = operatorFilter;
    if (keywordFilter) params.keyword = keywordFilter;
    if (clientIpFilter) params.client_ip = clientIpFilter;
    if (moduleFilter) params.module = moduleFilter;
    if (dateRange[0]) params.start_date = dateRange[0].format('YYYY-MM-DD');
    if (dateRange[1]) params.end_date = dateRange[1].format('YYYY-MM-DD');
    params.page = page;
    params.pageSize = pageSize;
    getOperationLogs(params)
      .then((resp) => {
        if (seq !== fetchSeq.current) return;
        if (Array.isArray(resp)) {
          setLogs(resp);
          setTotal(resp.length);
        } else {
          setLogs(resp.data || []);
          setTotal(resp.total || 0);
        }
      })
      .catch((err) => {
        console.error(err);
        notifyError('加载操作日志失败，请稍后重试');
      })
      .finally(() => setLoading(false));
  }, [actionFilter, actionsFilter, operatorFilter, keywordFilter, clientIpFilter, moduleFilter, dateRange, page, pageSize]);

  React.useEffect(() => { fetchLogs(); }, []);

  React.useEffect(() => {
    setPage(1);
  }, [actionFilter, actionsFilter, operatorFilter, keywordFilter, clientIpFilter, moduleFilter, dateRange]);

  // 防抖搜索（操作人/关键字/IP）
  React.useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setOperatorFilter(operatorInput.trim());
      setKeywordFilter(keywordInput.trim());
      setClientIpFilter(clientIpInput.trim());
      setPage(1);
    }, 280);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [operatorInput, keywordInput, clientIpInput]);

  const handleExport = async () => {
    const params = new URLSearchParams();
    if (dateRange[0]) params.set('start_date', dateRange[0].format('YYYY-MM-DD'));
    if (dateRange[1]) params.set('end_date', dateRange[1].format('YYYY-MM-DD'));
    if (actionFilter) params.set('action', actionFilter);
    if (actionsFilter.length) params.set('actions', actionsFilter.join(','));
    if (operatorFilter) params.set('operator', operatorFilter);
    if (keywordFilter) params.set('keyword', keywordFilter);
    if (clientIpFilter) params.set('client_ip', clientIpFilter);
    try {
      await downloadWithAuth(
        `/api/export/operation-logs?${params.toString()}`,
        `操作日志_${format(new Date(), 'yyyyMMdd')}.csv`
      );
      message.success('导出成功');
    } catch (err: any) {
      notifyError(err?.message || '导出失败');
    }
  };

  const colAlign = 'center' as const;
  const allColumns: ColumnsType<OperationLog> = [
    {
      title: '时间',
      dataIndex: 'created_at',
      key: 'created_at',
      align: colAlign,
      fixed: 'left',
      render: (value: string) =>
        format(parseUtc(value), 'yyyy-MM-dd HH:mm:ss', { locale: zhCN }),
      sorter: (a, b) =>
        parseUtc(a.created_at).getTime() - parseUtc(b.created_at).getTime(),
      defaultSortOrder: 'descend',
    },
    {
      title: '操作类型',
      dataIndex: 'action',
      key: 'action',
      align: colAlign,
      render: (value: string) => {
        let color: string = 'default';
        if (value.includes('CREATE') || value === 'INBOUND') color = 'green';
        else if (value.includes('UPDATE')) color = 'blue';
        else if (value.includes('DELETE') || value === 'OUTBOUND') color = 'red';
        const label = formatActionLabel(value);
        return (
          <Tooltip title={value}>
            <Tag color={color}>{label}</Tag>
          </Tooltip>
        );
      },
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      align: colAlign,
      ellipsis: true,
      render: (v: string, record: OperationLog) => (
        <Button type="link" size="small" className="p-0 h-auto" onClick={() => { setActiveLog(record); setDrawerOpen(true); }}>
          {v}
        </Button>
      ),
    },
    {
      title: '变更详情',
      key: 'changes',
      align: colAlign,
      render: (_: unknown, record: OperationLog) => {
        const lines = formatChangeDetails(record.action, record.old_value, record.new_value);
        if (!lines.length) return '-';
        return (
          <Space orientation="vertical" size={0}>
            {lines.map((line, idx) => (
              <span key={idx} className="text-xs text-slate-700">
                {line}
              </span>
            ))}
          </Space>
        );
      },
    },
    {
      title: '操作人',
      dataIndex: 'operator',
      key: 'operator',
      align: colAlign,
      render: (value: string | null | undefined) => value || '系统',
    },
    {
      title: 'IP',
      dataIndex: 'client_ip',
      key: 'client_ip',
      align: colAlign,
      render: (v: string | null | undefined) => v ? <IpWithGeo ip={v} /> : '-',
    },
  ];

  const columns = React.useMemo(
    () => allColumns.filter((c) => c.key && visibleColumnKeys.includes(String(c.key))),
    [allColumns, visibleColumnKeys]
  );

  const columnVisibilityContent = React.useMemo(
    () => (
      <div className="py-1 min-w-[160px]" onClick={(e) => e.stopPropagation()}>
        <div className="text-xs text-slate-500 mb-2 px-1">选择要显示的列</div>
        {allColumns.map((c) => (
          <div key={String(c.key)} className="py-0.5">
            <Checkbox
              checked={visibleColumnKeys.includes(String(c.key))}
              onChange={(e) => {
                const key = String(c.key);
                if (e.target.checked) {
                  setVisibleColumnKeys((prev) => [...new Set([...prev, key])]);
                } else {
                  setVisibleColumnKeys((prev) => prev.filter((k) => k !== key));
                }
              }}
            >
              {c.title as string}
            </Checkbox>
          </div>
        ))}
      </div>
    ),
    [allColumns, visibleColumnKeys]
  );

  const actionOptions = React.useMemo(() => {
    const keys = Object.keys(ACTION_LABELS);
    keys.sort((a, b) => a.localeCompare(b));
    return keys.map((k) => ({ label: ACTION_LABELS[k], value: k }));
  }, []);

  const deriveLinks = React.useCallback((log: OperationLog) => {
    const oldObj = tryParseJson(log.old_value);
    const newObj = tryParseJson(log.new_value);
    const obj = (newObj && typeof newObj === 'object') ? newObj : (oldObj && typeof oldObj === 'object' ? oldObj : null);

    const materialCode =
      (obj && (obj.code || obj.material_code)) ||
      (() => {
        const m = (log.description || '').match(/编码[:：]\s*([A-Za-z0-9_-]+)/);
        return m?.[1];
      })();
    const materialName = (obj && (obj.name || obj.material_name)) || '';
    const keyword = String(materialCode || materialName || '').trim();

    const locationName =
      (obj && (obj.location_name || obj.location)) ||
      (() => {
        const m = (log.description || '').match(/库位[:：]\s*([^\s，。,；;]+)/);
        return m?.[1];
      })();

    const day = dayjs(parseUtc(log.created_at)).format('YYYY-MM-DD');
    const txType = log.action === 'INBOUND' ? 'IN' : log.action === 'OUTBOUND' ? 'OUT' : undefined;

    const links: { key: string; label: string; to: string }[] = [];
    if (keyword) {
      links.push({ key: 'materials', label: '查看物料', to: `/materials?keyword=${encodeURIComponent(keyword)}` });
      links.push({ key: 'history_kw', label: '查看出入记录（相关）', to: `/history?keyword=${encodeURIComponent(keyword)}` });
      links.push({ key: 'inventory_kw', label: '查看实时库存（相关）', to: `/inventory?keyword=${encodeURIComponent(keyword)}` });
    }
    if (locationName) {
      links.push({ key: 'inventory_loc', label: '查看该库位库存', to: `/inventory?location=${encodeURIComponent(String(locationName))}` });
    }
    if (txType) {
      links.push({
        key: 'history_day',
        label: `查看当日${txType === 'IN' ? '入库' : '出库'}明细`,
        to: `/history?type=${txType}&start_date=${day}&end_date=${day}`,
      });
    }
    if (log.action === 'UPDATE_ROLE_PERMISSIONS') {
      links.push({ key: 'settings', label: '打开系统设置', to: '/settings' });
    }
    return Array.from(new Map(links.map((l) => [l.key, l])).values());
  }, []);

  return (
    <div className="space-y-4">
      <PageHeader
        icon={<FileText size={22} className="text-blue-500" />}
        title="操作日志"
        subtitle="查看系统中物料、出入库、基础设置等关键操作的完整记录。"
        actions={
          showExport && (
            <Button type="primary" icon={<DownloadOutlined />} onClick={handleExport}>
              导出 CSV
            </Button>
          )
        }
      />

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-4">
        <div className="flex flex-wrap items-center gap-3 sticky top-0 bg-white z-10 pb-2">
          <Select
            allowClear
            placeholder="模块"
            value={moduleFilter ?? undefined}
            onChange={(v) => setModuleFilter(v ?? null)}
            style={{ width: 140 }}
            options={[
              { label: '物料', value: 'materials' },
              { label: '出入库', value: 'transactions' },
              { label: '基础设置', value: 'settings' },
              { label: '账号与权限', value: 'accounts' },
              { label: '导出', value: 'export' },
            ]}
          />
          <Select
            allowClear
            placeholder="操作类型（模糊）"
            value={actionFilter ?? undefined}
            onChange={(v) => setActionFilter(v ?? null)}
            style={{ width: 160 }}
            showSearch
            options={actionOptions}
          />
          <Select
            mode="multiple"
            placeholder="操作类型（多选精确）"
            value={actionsFilter}
            onChange={setActionsFilter}
            style={{ width: 220 }}
            options={actionOptions}
          />
          <Input
            allowClear
            prefix={<SearchOutlined className="text-slate-400" />}
            placeholder="关键字（描述/旧值/新值）"
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
            style={{ width: 220 }}
          />
          <Input
            allowClear
            placeholder="操作人"
            value={operatorInput}
            onChange={(e) => setOperatorInput(e.target.value)}
            style={{ width: 120 }}
          />
          <Input
            allowClear
            placeholder="IP"
            value={clientIpInput}
            onChange={(e) => setClientIpInput(e.target.value)}
            style={{ width: 120 }}
          />
          <DatePicker.RangePicker
            value={dateRange}
            onChange={(d) => setDateRange(d as any)}
            allowClear
            presets={buildCommonRangePresets()}
          />
          <Button onClick={fetchLogs}>查询</Button>
          <Button onClick={() => { setActionFilter(null); setActionsFilter([]); setOperatorInput(''); setKeywordInput(''); setClientIpInput(''); setModuleFilter(null); setDateRange([null, null]); }}>重置</Button>
          <Popover content={columnVisibilityContent} trigger="click" placement="bottomRight" title={null}>
            <Button icon={<SettingOutlined />}>列显隐</Button>
          </Popover>
          {user?.role === 'admin' && (
            <Popconfirm
              title="确认清空所有操作日志？"
              description="该操作不可恢复，请确认已经完成备份。"
              okText="清空"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={async () => {
                try {
                  await apiClient.delete('/api/operation-logs');
                  message.success('操作日志已清空');
                  setPage(1);
                  fetchLogs();
                } catch (err: any) {
                  notifyError(err?.message || '清空失败');
                }
              }}
            >
              <Button danger>清空日志</Button>
            </Popconfirm>
          )}
        </div>
        {loading ? (
          <div className="py-6 space-y-3">
            <Skeleton active paragraph={{ rows: 1 }} />
            <Skeleton active paragraph={{ rows: 8 }} />
          </div>
        ) : (
          <Table
            rowKey="id"
            columns={columns}
            dataSource={logs}
            size="middle"
            className="wms-table"
            scroll={{ x: 1100 }}
            pagination={{
              current: page,
              pageSize,
              total,
              showSizeChanger: true,
              pageSizeOptions: [10, 20, 50, 100],
              onChange: (p, ps) => {
                setPage(p);
                setPageSize(ps);
              },
              showTotal: (t) => `共 ${t} 条`,
            }}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={
                    actionFilter || actionsFilter.length || operatorFilter || keywordFilter || clientIpFilter || moduleFilter || dateRange[0] || dateRange[1]
                      ? '未找到匹配的操作日志'
                      : '暂无操作日志记录。'
                  }
                />
              ),
            }}
          />
        )}
      </div>

      <Drawer
        title="日志详情"
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setActiveLog(null); }}
        size="large"
      >
        {activeLog ? (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap gap-2">
              {deriveLinks(activeLog).map((l) => (
                <Link key={l.key} to={l.to}>
                  <Button size="small">{l.label}</Button>
                </Link>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><span className="text-slate-500">时间：</span>{format(parseUtc(activeLog.created_at), 'yyyy-MM-dd HH:mm:ss', { locale: zhCN })}</div>
              <div><span className="text-slate-500">操作人：</span>{activeLog.operator || '系统'}</div>
              <div><span className="text-slate-500">类型：</span>{formatActionLabel(activeLog.action)} <span className="text-xs text-slate-400">({activeLog.action})</span></div>
              <div><span className="text-slate-500">IP：</span><IpWithGeo ip={activeLog.client_ip} /></div>
            </div>
            <div>
              <div className="text-slate-500 mb-1">描述</div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">{activeLog.description || '-'}</div>
            </div>
            <div>
              <div className="text-slate-500 mb-1">变更详情</div>
              <div className="p-3 bg-white border border-slate-200 rounded-lg space-y-1">
                {formatChangeDetails(activeLog.action, activeLog.old_value, activeLog.new_value).map((line, idx) => (
                  <div key={idx} className="text-slate-700">{line}</div>
                ))}
                {!formatChangeDetails(activeLog.action, activeLog.old_value, activeLog.new_value).length && (
                  <div className="text-slate-400">无</div>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <div className="text-slate-500 mb-1">旧值</div>
                <pre className="text-xs p-3 bg-slate-50 border border-slate-200 rounded-lg overflow-auto max-h-64">
{tryParseJson(activeLog.old_value) ? JSON.stringify(tryParseJson(activeLog.old_value), null, 2) : (activeLog.old_value || '')}
                </pre>
              </div>
              <div>
                <div className="text-slate-500 mb-1">新值</div>
                <pre className="text-xs p-3 bg-slate-50 border border-slate-200 rounded-lg overflow-auto max-h-64">
{tryParseJson(activeLog.new_value) ? JSON.stringify(tryParseJson(activeLog.new_value), null, 2) : (activeLog.new_value || '')}
                </pre>
              </div>
            </div>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}

