import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { DatePicker, Select, Button, Table, Tag, Space, message, Empty, Input, Tooltip, Skeleton, Segmented } from 'antd';
import AntdCard from 'antd/es/card';
import { DownloadOutlined, BarChartOutlined, LineChartOutlined, PieChartOutlined, DollarOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useAuth } from '../contexts/AuthContext';
import { apiClient } from '../api/client';
import { downloadWithAuth } from '../api/download';
import { BarChart3 } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { buildCommonRangePresets } from '../constants/datePresets';
import { notifyError } from '../utils/notify';

const { RangePicker } = DatePicker;
const { Option } = Select;
const Card = AntdCard as any;

interface ReportData {
  [key: string]: any;
}

function toNumberOrNull(v: any): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function formatPercent01(v: any): string {
  const n = toNumberOrNull(v);
  if (n == null) return "-";
  return `${(n * 100).toFixed(2)}%`;
}

function formatMoney(v: any): string {
  const n = toNumberOrNull(v);
  if (n == null) return "-";
  return `¥${n.toFixed(2)}`;
}

export default function Reports() {
  const { can } = useAuth();
  const [reportType, setReportType] = useState('inventory-turnover');
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null]>(() => {
    const end = dayjs();
    const start = dayjs().subtract(30, 'day');
    return [start, end];
  });
  const [loading, setLoading] = useState(false);
  const [reportData, setReportData] = useState<ReportData[]>([]);
  const [summary, setSummary] = useState<{ [key: string]: any }>({});
  const [materialKeyword, setMaterialKeyword] = useState('');
  const [partnerFilter, setPartnerFilter] = useState<string | null>(null);
  const [topN, setTopN] = useState<number>(20);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const reportTypes = [
    { value: 'inventory-turnover', label: '库存周转率', icon: <LineChartOutlined /> },
    { value: 'inout-stats', label: '出入库统计', icon: <BarChartOutlined /> },
    { value: 'partner-inout-stats', label: '往来单位出入库汇总', icon: <BarChartOutlined /> },
    { value: 'material-analysis', label: '物料使用分析', icon: <PieChartOutlined /> },
    { value: 'inventory-value', label: '库存价值', icon: <DollarOutlined /> },
  ];
  const reportTypeLabel = reportTypes.find((t) => t.value === reportType)?.label || reportType;
  const reportTypeDesc: Record<string, string> = {
    'inventory-turnover': '统计周期内各物料的期初/期末库存、出库量与周转率，用于衡量库存周转效率。',
    'inout-stats': '按日汇总入库、出库与净变化，适合看趋势与对账。',
    'partner-inout-stats': '按往来单位汇总周期内入库/出库与净变化，便于供应商/客户维度分析。',
    'material-analysis': '按物料出库使用量统计并计算占比，适合做 TopN 消耗分析。',
    'inventory-value': '按物料库存数量与单价估算库存价值（若无单价则可能为 0 或 -）。',
  };

  const hasDateRange = !!dateRange?.[0] && !!dateRange?.[1];
  const startDate = hasDateRange ? dateRange[0]!.format('YYYY-MM-DD') : '';
  const endDate = hasDateRange ? dateRange[1]!.format('YYYY-MM-DD') : '';

  const fetchReportData = async (overrideRange?: [dayjs.Dayjs, dayjs.Dayjs]) => {
    const start = overrideRange?.[0] ?? dateRange?.[0];
    const end = overrideRange?.[1] ?? dateRange?.[1];
    if (!start || !end) {
      notifyError('请选择日期范围');
      return;
    }
    const s = start.format('YYYY-MM-DD');
    const e = end.format('YYYY-MM-DD');

    setLoading(true);
    try {
      const data = await apiClient.get<{ data: ReportData[]; summary?: Record<string, any> }>(
        `/api/reports/${reportType}?start_date=${s}&end_date=${e}`
      );
      setReportData(data.data || []);
      setSummary(data.summary || {});
      setPage(1);
    } catch (error) {
      notifyError('加载报表数据失败');
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    if (!hasDateRange) {
      notifyError('请选择日期范围');
      return;
    }

    try {
      await downloadWithAuth(
        `/api/export/report/${reportType}?start_date=${startDate}&end_date=${endDate}`,
        `${reportTypeLabel}_${startDate}_${endDate}.csv`
      );
      message.success('报表导出成功');
    } catch (error: unknown) {
      notifyError(error instanceof Error ? error.message : '导出报表失败');
    }
  };

  const quickSetRange = (days: 0 | 6 | 29) => {
    const end = dayjs().endOf('day');
    const start = dayjs().subtract(days, 'day').startOf('day');
    setDateRange([start, end]);
    // 自动生成：直接用新范围请求，避免 setState 异步导致需要点两次
    void fetchReportData([start, end]);
  };

  const filteredReportData = useMemo(() => {
    let data = reportData;
    const kw = materialKeyword.trim().toLowerCase();
    if (kw && (reportType === 'material-analysis' || reportType === 'inventory-value' || reportType === 'inventory-turnover')) {
      data = data.filter((r) => {
        const code = String(r.code ?? '').toLowerCase();
        const name = String(r.name ?? '').toLowerCase();
        return code.includes(kw) || name.includes(kw);
      });
    }
    if (partnerFilter && reportType === 'partner-inout-stats') {
      data = data.filter((r) => String(r.partner_name ?? '') === partnerFilter);
    }
    if (reportType === 'material-analysis') {
      // 默认按 usage 降序，截取 TopN
      const sorted = [...data].sort((a, b) => (Number(b.usage) || 0) - (Number(a.usage) || 0));
      data = sorted.slice(0, Math.max(1, topN));
    }
    return data;
  }, [reportData, reportType, materialKeyword, partnerFilter, topN]);

  const partnerOptions = useMemo(() => {
    if (reportType !== 'partner-inout-stats') return [];
    const names = Array.from(new Set(reportData.map((r) => String(r.partner_name ?? '')).filter(Boolean))).sort();
    return names;
  }, [reportData, reportType]);

  const formattedSummary = useMemo(() => {
    if (!summary || Object.keys(summary).length === 0) return [];
    const s = summary as any;
    switch (reportType) {
      case 'inout-stats':
        return [
          { label: '总入库量', value: s.total_inbound ?? '-' },
          { label: '总出库量', value: s.total_outbound ?? '-' },
          { label: '净变化', value: s.total_net_change ?? '-' },
        ];
      case 'inventory-value':
        return [
          { label: '库存总价值', value: formatMoney(s.total_value ?? s.total ?? s.value) },
          { label: '物料数', value: s.material_count ?? s.count ?? '-' },
        ];
      case 'material-analysis':
        return [
          { label: '使用总量', value: s.total_usage ?? s.total ?? '-' },
          { label: 'TopN', value: topN },
        ];
      default:
        return Object.entries(summary).map(([k, v]) => ({ label: k, value: v }));
    }
  }, [summary, reportType, topN]);

  const getColumns = () => {
    switch (reportType) {
      case 'inventory-turnover':
        return [
          {
            title: '物料编码',
            dataIndex: 'code',
            key: 'code',
            render: (v: any, r: any) =>
              v ? (
                <Link to={`/history?keyword=${encodeURIComponent(String(v))}&start_date=${startDate}&end_date=${endDate}`}>
                  <span className="font-mono">{String(v)}</span>
                </Link>
              ) : (
                '-'
              ),
          },
          { title: '物料名称', dataIndex: 'name', key: 'name', ellipsis: true },
          { title: '期初库存', dataIndex: 'beginning_stock', key: 'beginning_stock' },
          { title: '期末库存', dataIndex: 'ending_stock', key: 'ending_stock' },
          { title: '本期出库', dataIndex: 'outbound', key: 'outbound' },
          { title: '周转率', dataIndex: 'turnover_rate', key: 'turnover_rate', render: formatPercent01 },
        ];
      case 'inout-stats':
        return [
          {
            title: '日期',
            dataIndex: 'date',
            key: 'date',
            render: (v: any) =>
              v ? (
                <Link to={`/history?start_date=${encodeURIComponent(String(v))}&end_date=${encodeURIComponent(String(v))}`}>
                  {String(v)}
                </Link>
              ) : (
                '-'
              ),
          },
          { title: '入库数量', dataIndex: 'inbound', key: 'inbound' },
          { title: '出库数量', dataIndex: 'outbound', key: 'outbound' },
          { title: '净变化', dataIndex: 'net_change', key: 'net_change', render: (change: number) => (
            <Tag color={change >= 0 ? 'green' : 'red'}>{change}</Tag>
          ) },
        ];
      case 'partner-inout-stats':
        return [
          {
            title: '往来单位',
            dataIndex: 'partner_name',
            key: 'partner_name',
            ellipsis: true,
            render: (v: any) =>
              v ? (
                <Link to={`/history?keyword=${encodeURIComponent(String(v))}&start_date=${startDate}&end_date=${endDate}`}>
                  {String(v)}
                </Link>
              ) : (
                '-'
              ),
          },
          { title: '入库数量', dataIndex: 'inbound', key: 'inbound' },
          { title: '出库数量', dataIndex: 'outbound', key: 'outbound' },
          { title: '净变化', dataIndex: 'net_change', key: 'net_change', render: (change: number) => (
            <Tag color={change >= 0 ? 'green' : 'red'}>{change}</Tag>
          ) },
        ];
      case 'material-analysis':
        return [
          {
            title: '物料编码',
            dataIndex: 'code',
            key: 'code',
            render: (v: any) =>
              v ? (
                <Link to={`/history?keyword=${encodeURIComponent(String(v))}&type=OUT&start_date=${startDate}&end_date=${endDate}`}>
                  <span className="font-mono">{String(v)}</span>
                </Link>
              ) : (
                '-'
              ),
          },
          { title: '物料名称', dataIndex: 'name', key: 'name', ellipsis: true },
          { title: '使用数量', dataIndex: 'usage', key: 'usage' },
          { title: '占比', dataIndex: 'percentage', key: 'percentage', render: formatPercent01 },
        ];
      case 'inventory-value':
        return [
          {
            title: '物料编码',
            dataIndex: 'code',
            key: 'code',
            render: (v: any) =>
              v ? (
                <Link to={`/materials?keyword=${encodeURIComponent(String(v))}`}>
                  <span className="font-mono">{String(v)}</span>
                </Link>
              ) : (
                '-'
              ),
          },
          { title: '物料名称', dataIndex: 'name', key: 'name', ellipsis: true },
          { title: '库存数量', dataIndex: 'quantity', key: 'quantity' },
          { title: '单价', dataIndex: 'unit_price', key: 'unit_price', render: formatMoney },
          { title: '库存价值', dataIndex: 'value', key: 'value', render: formatMoney },
        ];
      default:
        return [];
    }
  };

  const renderSimpleBars = () => {
    if (filteredReportData.length === 0) return null;
    if (reportType === 'inout-stats') {
      const max = Math.max(
        1,
        ...filteredReportData.map((r: any) => Math.max(Number(r.inbound) || 0, Number(r.outbound) || 0))
      );
      return (
        <div className="mb-4">
          <div className="text-sm font-medium text-slate-700 mb-2">趋势预览</div>
          <div className="space-y-2">
            {filteredReportData.slice(-10).map((r: any, idx: number) => (
              <div key={idx} className="flex items-center gap-3">
                <div className="w-24 text-xs text-slate-500">{String(r.date)}</div>
                <div className="flex-1 flex gap-2 items-center">
                  <div className="h-2 rounded bg-indigo-200" style={{ width: `${((Number(r.inbound) || 0) / max) * 100}%` }} />
                  <div className="h-2 rounded bg-orange-200" style={{ width: `${((Number(r.outbound) || 0) / max) * 100}%` }} />
                </div>
                <div className="w-20 text-xs text-slate-500 text-right">
                  {Number(r.inbound) || 0}/{Number(r.outbound) || 0}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 text-xs text-slate-400">仅展示最近 10 天（蓝：入库，橙：出库）</div>
        </div>
      );
    }
    if (reportType === 'material-analysis') {
      const max = Math.max(1, ...filteredReportData.map((r: any) => Number(r.usage) || 0));
      return (
        <div className="mb-4">
          <div className="text-sm font-medium text-slate-700 mb-2">Top {topN} 使用量</div>
          <div className="space-y-2">
            {filteredReportData.slice(0, Math.min(10, filteredReportData.length)).map((r: any, idx: number) => (
              <div key={idx} className="flex items-center gap-3">
                <div className="w-52 text-xs text-slate-600 truncate">{`${r.code || ''} ${r.name || ''}`.trim()}</div>
                <div className="flex-1 h-2 rounded bg-slate-100 overflow-hidden">
                  <div className="h-2 bg-indigo-400" style={{ width: `${((Number(r.usage) || 0) / max) * 100}%` }} />
                </div>
                <div className="w-16 text-xs text-slate-500 text-right">{Number(r.usage) || 0}</div>
              </div>
            ))}
          </div>
          <div className="mt-2 text-xs text-slate-400">仅展示前 10 条（完整数据见下表）</div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<BarChart3 size={22} className="text-blue-500" />}
        title="报表分析"
        subtitle="查看仓库的各项统计报表和分析数据。"
      />

      <Card className="bg-white rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <Select
            value={reportType}
            onChange={(v) => {
              setReportType(v);
              setMaterialKeyword('');
              setPartnerFilter(null);
              setTopN(20);
              setReportData([]);
              setSummary({});
              setPage(1);
            }}
            style={{ width: 200 }}
            options={reportTypes.map(type => ({
              label: (
                <Space>
                  {type.icon}
                  <span>{type.label}</span>
                </Space>
              ),
              value: type.value
            }))}
          />
          <RangePicker
            value={dateRange}
            onChange={(dates) => setDateRange(dates || [null, null])}
            style={{ width: 300 }}
            presets={buildCommonRangePresets()}
          />
          <Space wrap>
            <Tooltip title={hasDateRange ? '' : '请先选择日期范围'}>
              <Button type="primary" onClick={fetchReportData} loading={loading} disabled={!hasDateRange}>
                生成报表
              </Button>
            </Tooltip>
            <Button onClick={() => quickSetRange(0)}>今天</Button>
            <Button onClick={() => quickSetRange(6)}>近7天</Button>
            <Button onClick={() => quickSetRange(29)}>近30天</Button>
            {can('export') && (
              <Tooltip title={hasDateRange ? '' : '请先选择日期范围'}>
                <Button icon={<DownloadOutlined />} onClick={handleExport} disabled={!hasDateRange || loading}>
                  导出 CSV
                </Button>
              </Tooltip>
            )}
          </Space>
        </div>

        <div className="mb-4 text-sm text-slate-600">
          <span className="font-medium text-slate-800">{reportTypeLabel}</span>
          <span className="ml-2 text-slate-500">{reportTypeDesc[reportType] || ''}</span>
        </div>

        <div className="flex flex-wrap gap-3 items-center mb-4">
          {(reportType === 'material-analysis' || reportType === 'inventory-value' || reportType === 'inventory-turnover') && (
            <Input
              allowClear
              placeholder="按物料编码/名称筛选"
              value={materialKeyword}
              onChange={(e) => setMaterialKeyword(e.target.value)}
              style={{ width: 220 }}
            />
          )}
          {reportType === 'partner-inout-stats' && (
            <Select
              allowClear
              placeholder="按往来单位筛选"
              value={partnerFilter ?? undefined}
              onChange={(v) => setPartnerFilter(v ?? null)}
              options={partnerOptions.map((n) => ({ label: n, value: n }))}
              style={{ width: 240 }}
            />
          )}
          {reportType === 'material-analysis' && (
            <Space>
              <span className="text-sm text-slate-600">Top：</span>
              <Segmented
                size="small"
                value={topN}
                onChange={(v) => setTopN(Number(v))}
                options={[
                  { label: '10', value: 10 },
                  { label: '20', value: 20 },
                  { label: '50', value: 50 },
                ]}
              />
            </Space>
          )}
        </div>

        {formattedSummary.length > 0 && (
          <div className="mb-6 p-4 bg-slate-50 rounded-lg border border-slate-200">
            <h3 className="font-bold mb-2 text-slate-800">报表摘要</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {formattedSummary.map((it) => (
                <div key={it.label} className="text-center p-3 bg-white rounded-lg shadow-sm">
                  <div className="text-sm text-slate-500">{it.label}</div>
                  <div className="text-lg font-bold text-indigo-600">{it.value}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {loading ? (
          <div className="py-6 space-y-3">
            <Skeleton active paragraph={{ rows: 1 }} />
            <Skeleton active paragraph={{ rows: 8 }} />
          </div>
        ) : filteredReportData.length > 0 ? (
          <>
            {renderSimpleBars()}
            <Table
              columns={getColumns()}
              dataSource={filteredReportData}
              rowKey={(r: any, idx) => String(r.id ?? r.code ?? r.date ?? idx)}
              pagination={{
                current: page,
                pageSize,
                total: filteredReportData.length,
                showSizeChanger: true,
                pageSizeOptions: [10, 20, 50],
                onChange: (p, ps) => {
                  setPage(p);
                  setPageSize(ps);
                },
              }}
              scroll={{ x: 960 }}
              className="wms-table border border-slate-200 rounded-lg"
            />
          </>
        ) : (
          <div className="py-12">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="暂无数据，请尝试调整日期范围或筛选条件"
            />
          </div>
        )}
      </Card>
    </div>
  );
}
