import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { Table, Input, Segmented, Space, Tag, Tooltip, message, Button, DatePicker, Skeleton, Empty } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ArrowDownOutlined, ArrowUpOutlined, InfoCircleOutlined, DownloadOutlined, SearchOutlined } from '@ant-design/icons';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { parseUtc } from '../utils/date';
import dayjs from 'dayjs';
import { getTransactions, type Transaction, type TransactionType } from '../api/transactions';
import { useAuth } from '../contexts/AuthContext';
import { downloadWithAuth } from '../api/download';
import { History as HistoryIcon } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { buildCommonRangePresets } from '../constants/datePresets';
import { DEFAULT_DEBOUNCE_MS, DEFAULT_PAGE_SIZE, DEFAULT_PAGE_SIZE_OPTIONS } from '../constants/table';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useColumnVisibility } from '../hooks/useColumnVisibility';
import { ColumnVisibilityPopover } from '../components/ColumnVisibilityPopover';
import { PreviewImage } from '../components/PreviewImage';

type FilterType = 'ALL' | TransactionType;

export default function History() {
  const { can } = useAuth();
  const [searchParams] = useSearchParams();
  const typeFromUrl = searchParams.get('type');
  const initialType: FilterType = typeFromUrl === 'IN' || typeFromUrl === 'OUT' ? typeFromUrl : 'ALL';
  const keywordFromUrl = searchParams.get('keyword') || '';
  const startDateFromUrl = searchParams.get('start_date');
  const endDateFromUrl = searchParams.get('end_date');
  const [transactions, setTransactions] = React.useState<Transaction[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [searchInput, setSearchInput] = React.useState('');
  const debouncedKeyword = useDebouncedValue(searchInput, DEFAULT_DEBOUNCE_MS);
  const [filterType, setFilterType] = React.useState<FilterType>(initialType);
  const [dateRange, setDateRange] = React.useState<[dayjs.Dayjs | null, dayjs.Dayjs | null]>([null, null]);
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(DEFAULT_PAGE_SIZE);
  const [total, setTotal] = React.useState(0);
  const { visibleKeys: visibleColumnKeys, toggle: toggleColumn, reset: resetColumns } = useColumnVisibility({
    defaultKeys: [
    'image_url',
    'timestamp',
    'type',
    'material',
    'location_name',
    'partner_name',
    'quantity',
    'people',
    'note',
    ],
    storageKey: 'history.visibleColumns',
  });

  const fetchData = React.useCallback((overrideType?: FilterType) => {
    setLoading(true);
    const params: { type?: TransactionType; start_date?: string; end_date?: string; keyword?: string; page?: number; pageSize?: number } = {};
    const effectiveType = overrideType ?? filterType;
    if (effectiveType !== 'ALL') params.type = effectiveType;
    if (dateRange[0]) params.start_date = dateRange[0].format('YYYY-MM-DD');
    if (dateRange[1]) params.end_date = dateRange[1].format('YYYY-MM-DD');
    if (debouncedKeyword) params.keyword = debouncedKeyword;
    params.page = page;
    params.pageSize = pageSize;
    getTransactions(params)
      .then((resp) => {
        if (Array.isArray(resp)) {
          setTransactions(resp);
          setTotal(resp.length);
        } else {
          setTransactions(resp.data || []);
          setTotal(resp.total || 0);
        }
      })
      .catch((err) => {
        console.error(err);
        message.error('加载出入记录失败，请稍后重试');
      })
      .finally(() => setLoading(false));
  }, [filterType, dateRange, debouncedKeyword, page, pageSize]);

  React.useEffect(() => {
    if (keywordFromUrl) {
      setSearchInput(keywordFromUrl);
    }
    if (startDateFromUrl || endDateFromUrl) {
      const s = startDateFromUrl ? dayjs(startDateFromUrl) : null;
      const e = endDateFromUrl ? dayjs(endDateFromUrl) : null;
      setDateRange([s && s.isValid() ? s : null, e && e.isValid() ? e : null]);
    }
    fetchData(initialType);
  }, []);

  // 筛选条件变化时回到第一页
  React.useEffect(() => {
    setPage(1);
  }, [filterType, dateRange, debouncedKeyword]);

  // 重新加载数据的函数
  const handleRefresh = () => {
    fetchData();
  };

  const handleExport = async () => {
    const params = new URLSearchParams();
    if (filterType !== 'ALL') params.set('type', filterType);
    if (dateRange[0]) params.set('start_date', dateRange[0].format('YYYY-MM-DD'));
    if (dateRange[1]) params.set('end_date', dateRange[1].format('YYYY-MM-DD'));
    try {
      await downloadWithAuth(
        `/api/export/transactions?${params.toString()}`,
        `出入库记录_${format(new Date(), 'yyyyMMdd')}.csv`
      );
      message.success('导出成功');
    } catch (err: any) {
      message.error(err?.message || '导出失败');
    }
  };

  const filteredTransactions = transactions;

  const quantityTotal = React.useMemo(
    () => filteredTransactions.reduce((sum, t) => sum + (t.quantity ?? 0), 0),
    [filteredTransactions]
  );

  const colAlign = 'center' as const;
  const allColumns: ColumnsType<Transaction> = React.useMemo(
    () => [
      {
        title: '图片',
        dataIndex: 'image_url',
        key: 'image_url',
        align: colAlign,
        render: (url: string | null | undefined, record: Transaction) => (
          <PreviewImage url={url} name={record.material_name} />
        ),
      },
      {
        title: '时间',
        dataIndex: 'timestamp',
        key: 'timestamp',
        align: colAlign,
        render: (value: string) =>
          format(parseUtc(value), 'yyyy-MM-dd HH:mm', { locale: zhCN }),
        sorter: (a, b) =>
          parseUtc(a.timestamp).getTime() - parseUtc(b.timestamp).getTime(),
        defaultSortOrder: 'descend',
      },
      {
        title: '类型',
        dataIndex: 'type',
        key: 'type',
        align: colAlign,
        render: (value: TransactionType) => (
          <Tag
            color={value === 'IN' ? 'blue' : 'orange'}
            icon={value === 'IN' ? <ArrowDownOutlined /> : <ArrowUpOutlined />}
          >
            {value === 'IN' ? '入库' : '出库'}
          </Tag>
        ),
        filters: [
          { text: '入库', value: 'IN' },
          { text: '出库', value: 'OUT' },
        ],
        onFilter: (value, record) => record.type === value,
      },
      {
        title: '物料信息',
        key: 'material',
        align: colAlign,
        render: (_: unknown, record: Transaction) => (
          <div>
            <div className="text-sm font-medium text-slate-900">
              {record.material_name}
            </div>
            <div className="text-xs text-slate-400 font-mono">
              {record.material_code}
            </div>
          </div>
        ),
      },
      {
        title: '库位',
        dataIndex: 'location_name',
        key: 'location_name',
        align: colAlign,
      },
      {
        title: '往来单位',
        dataIndex: 'partner_name',
        key: 'partner_name',
        align: colAlign,
        ellipsis: true,
        render: (value: string | null | undefined) => value || '-',
      },
      {
        title: '数量',
        dataIndex: 'quantity',
        key: 'quantity',
        align: colAlign,
        sorter: (a, b) => a.quantity - b.quantity,
        render: (value: number) => (
          <span style={{ fontWeight: 600 }}>{value}</span>
        ),
      },
      {
        title: '经办 / 领用',
        key: 'people',
        align: colAlign,
        render: (_: unknown, record: Transaction) => (
          <div>
            <div className="text-sm text-slate-600">
              {record.operator_name || '系统'}
            </div>
            {record.type === 'OUT' && (
              <div className="text-xs text-slate-400">
                领用：{record.recipient_name || '-'}{' '}
                {record.department_name ? `(${record.department_name})` : ''}
              </div>
            )}
          </div>
        ),
      },
      {
        title: '备注',
        dataIndex: 'note',
        key: 'note',
        align: colAlign,
        ellipsis: true,
        render: (value: string | null) =>
          value ? (
            <Tooltip title={value}>
              <span>{value}</span>
            </Tooltip>
          ) : (
            <span style={{ color: '#cbd5f5' }}>
              <InfoCircleOutlined /> 无
            </span>
          ),
      },
    ],
    [colAlign]
  );

  const columns: ColumnsType<Transaction> = React.useMemo(
    () => allColumns.filter((c) => c.key && visibleColumnKeys.includes(String(c.key))),
    [allColumns, visibleColumnKeys]
  );

  const columnKeysForPopover = React.useMemo(
    () =>
      allColumns
        .filter((c) => c.key)
        .map((c) => ({ key: String(c.key), label: c.title as any })),
    [allColumns]
  );

  return (
    <div className="space-y-4">
      <PageHeader
        icon={<HistoryIcon size={22} className="text-blue-500" />}
        title="出入记录"
        subtitle="查看仓库的所有出入库历史流水记录。"
      />

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-4 overflow-x-auto">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Input
              allowClear
              prefix={<SearchOutlined className="text-slate-400" />}
              placeholder="搜索物料、库位、经办人、部门、领用人或备注..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onPressEnter={() => fetchData()}
              style={{ maxWidth: 280 }}
            />
            <Button onClick={fetchData}>查询</Button>
            <Button onClick={handleRefresh} loading={loading}>刷新</Button>
            <DatePicker.RangePicker
              value={dateRange}
              onChange={(dates) => setDateRange(dates as [dayjs.Dayjs | null, dayjs.Dayjs | null])}
              allowClear
              presets={buildCommonRangePresets()}
            />
            <Space>
              <span className="text-sm text-slate-600">类型：</span>
              <Segmented
                size="small"
                value={filterType}
                onChange={(val) => {
                  const next = val as FilterType;
                  setFilterType(next);
                  // 切换“全部 / 入库 / 出库”时自动刷新列表
                  fetchData(next);
                }}
                options={[
                  { label: '全部', value: 'ALL' },
                  { label: '入库', value: 'IN' },
                  { label: '出库', value: 'OUT' },
                ]}
              />
            </Space>
            {can('export') && (
              <Button type="primary" icon={<DownloadOutlined />} onClick={handleExport}>
                导出 CSV
              </Button>
            )}
            <ColumnVisibilityPopover
              allKeys={columnKeysForPopover}
              visibleKeys={visibleColumnKeys}
              onToggle={toggleColumn}
              onReset={resetColumns}
            />
          </div>
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
            dataSource={filteredTransactions}
            size="middle"
            className="wms-table"
            scroll={{ x: 960 }}
            pagination={{
              current: page,
              pageSize,
              total,
              showSizeChanger: true,
              pageSizeOptions: DEFAULT_PAGE_SIZE_OPTIONS,
              showTotal: (t) => `共 ${t} 条，数量合计 ${quantityTotal}`,
              onChange: (p, ps) => {
                setPage(p);
                setPageSize(ps);
              },
            }}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={
                    debouncedKeyword || filterType !== 'ALL'
                      ? '未找到匹配的记录'
                      : '暂无出入记录。'
                  }
                />
              ),
            }}
          />
        )}
      </div>
    </div>
  );
}
