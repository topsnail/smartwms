import React, { useCallback, useEffect, useState } from 'react';
import {
  TrendingUp,
  TrendingDown,
  Package,
  AlertTriangle,
  ChevronRight,
  LayoutDashboard,
  RefreshCw,
  DollarSign,
  BarChart3,
  FileText,
  History,
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { motion } from 'motion/react';
import { Link } from 'react-router-dom';
import { Segmented } from 'antd';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { parseUtc } from '../utils/date';
import { useAuth } from '../contexts/AuthContext';
import { getDashboardStats, type DashboardStats } from '../api/dashboard';

type TimeRange = 'today' | 'week' | 'month';

function CardSkeleton() {
  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm animate-pulse">
      <div className="flex items-center justify-between mb-4">
        <div className="w-12 h-12 rounded-xl bg-slate-200" />
        <div className="w-10 h-4 rounded bg-slate-200" />
      </div>
      <div className="h-4 w-20 rounded bg-slate-200 mb-2" />
      <div className="h-8 w-16 rounded bg-slate-200" />
    </div>
  );
}

function StatsSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
      {[1, 2, 3, 4, 5].map((i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
}

function SectionSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm animate-pulse">
      <div className="h-6 w-32 rounded bg-slate-200 mb-6" />
      <div className="space-y-4">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-slate-50">
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-lg bg-slate-200" />
              <div className="space-y-2">
                <div className="h-4 w-24 rounded bg-slate-200" />
                <div className="h-3 w-16 rounded bg-slate-100" />
              </div>
            </div>
            <div className="h-4 w-12 rounded bg-slate-200" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { can } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>('today');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchData = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const data = await getDashboardStats();
      setStats(data);
      setLastUpdated(new Date());
    } catch (err) {
      console.error(err);
      setError('数据加载失败，请刷新页面重试');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const minutesAgo = lastUpdated
    ? Math.max(0, Math.floor((Date.now() - lastUpdated.getTime()) / 60000))
    : null;

  const getInOutByRange = () => {
    if (!stats) return { in: 0, out: 0 };
    if (timeRange === 'today') return { in: stats.todayIn, out: stats.todayOut };
    if (timeRange === 'week') return { in: stats.weekIn, out: stats.weekOut };
    return { in: stats.monthIn, out: stats.monthOut };
  };

  const inOut = getInOutByRange();
  const trendData = timeRange === 'month' ? stats?.trend30 ?? [] : stats?.trend7 ?? [];
  const maxVal = Math.max(
    1,
    ...trendData.flatMap((d) => [d.in_count, d.out_count])
  );

  const shortcutItems: { to: string; label: string; icon: React.ElementType; bg: string; color: string; show: boolean }[] = [
    { to: '/inbound', label: '快速入库', icon: TrendingUp, bg: 'bg-indigo-50', color: 'text-indigo-600', show: can('inbound') },
    { to: '/outbound', label: '快速出库', icon: TrendingDown, bg: 'bg-orange-50', color: 'text-orange-600', show: can('outbound_only') },
    { to: '/materials', label: '物料登记', icon: Package, bg: 'bg-blue-50', color: 'text-blue-600', show: true },
    { to: '/history', label: '查看流水', icon: History, bg: 'bg-slate-50', color: 'text-slate-600', show: true },
    { to: '/reports', label: '报表分析', icon: BarChart3, bg: 'bg-emerald-50', color: 'text-emerald-600', show: can('view_reports') },
    { to: '/logs', label: '操作日志', icon: FileText, bg: 'bg-amber-50', color: 'text-amber-600', show: true },
  ].filter((x) => x.show);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<LayoutDashboard size={22} className="text-blue-500" />}
        title="仪表盘概览"
        subtitle="欢迎回来，这是您的仓库实时数据统计。"
        actions={
          <div className="flex flex-wrap items-center gap-3">
            {lastUpdated && (
              <span className="text-xs text-slate-400">
                数据于 {minutesAgo === 0 ? '刚刚' : `${minutesAgo} 分钟前`} 更新
              </span>
            )}
            <button
              onClick={() => fetchData(true)}
              disabled={refreshing || loading}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors text-sm font-medium"
            >
              <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
              刷新
            </button>
          </div>
        }
      />

      {error && (
        <div className="bg-red-50 border border-red-100 rounded-2xl p-4 flex items-center gap-3">
          <AlertTriangle size={20} className="text-red-600" />
          <span className="text-red-700">{error}</span>
        </div>
      )}

      {loading ? (
        <>
          <StatsSkeleton />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <SectionSkeleton rows={5} />
            <SectionSkeleton rows={4} />
          </div>
        </>
      ) : stats ? (
        <>
          {/* 统计卡片 */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-5">
            {[
              { title: '总物料数', value: stats.totalMaterials, icon: Package, color: 'text-blue-600', bg: 'bg-blue-50' },
              { title: '当前库存总量', value: stats.totalStock, icon: TrendingUp, color: 'text-emerald-600', bg: 'bg-emerald-50' },
              {
                title: '入库次数',
                value: inOut.in,
                sub: timeRange === 'today' ? '今日' : timeRange === 'week' ? '本周' : '本月',
                icon: TrendingUp,
                color: 'text-indigo-600',
                bg: 'bg-indigo-50',
              },
              {
                title: '出库次数',
                value: inOut.out,
                sub: timeRange === 'today' ? '今日' : timeRange === 'week' ? '本周' : '本月',
                icon: TrendingDown,
                color: 'text-orange-600',
                bg: 'bg-orange-50',
              },
              {
                title: '库存总值',
                value: stats.inventoryValue > 0 ? `¥${stats.inventoryValue.toFixed(2)}` : '-',
                icon: DollarSign,
                color: 'text-amber-600',
                bg: 'bg-amber-50',
              },
            ].map((card, index) => (
              <motion.div
                key={card.title}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className={`p-3 rounded-xl ${card.bg} ${card.color}`}>
                    <card.icon size={24} />
                  </div>
                  {'sub' in card && card.sub && (
                    <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">{card.sub}</span>
                  )}
                </div>
                <h3 className="text-slate-500 text-sm font-medium">{card.title}</h3>
                <p className="text-xl lg:text-2xl font-bold text-slate-900 mt-1">{card.value}</p>
              </motion.div>
            ))}
          </div>

          {/* 时间范围切换 */}
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-sm text-slate-600">统计周期：</span>
            <Segmented
              value={timeRange}
              onChange={(v) => setTimeRange(v as TimeRange)}
              options={[
                { label: '今日', value: 'today' },
                { label: '本周', value: 'week' },
                { label: '本月', value: 'month' },
              ]}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* 库存预警（使用 min_stock，显示与安全库存差距） */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-base font-bold text-slate-900">低库存预警</h3>
                <Link
                  to="/inventory"
                  className="text-xs font-bold text-indigo-600 hover:text-indigo-700 flex items-center gap-1 uppercase tracking-wider"
                >
                  查看全部 <ChevronRight size={14} />
                </Link>
              </div>
              <div className="space-y-4">
                {stats.lowStock.length > 0 ? (
                  stats.lowStock.slice(0, 5).map((item, idx) => {
                    const gap = Math.max(0, (item.min_stock || 0) - (item.quantity ?? 0));
                    return (
                      <div
                        key={`${item.material_id}-${item.location_id}-${idx}`}
                        className="flex items-center justify-between p-3 rounded-xl bg-orange-50/50 border border-orange-100"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-orange-100 text-orange-600 flex items-center justify-center">
                            <AlertTriangle size={16} />
                          </div>
                          <div>
                            <p className="text-sm font-bold text-slate-900">{item.name}</p>
                            <p className="text-xs text-slate-500">{item.location_name}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-bold text-orange-600">
                            {item.quantity} {item.unit || ''}
                          </p>
                          {gap > 0 && (
                            <p className="text-[10px] text-orange-500 font-bold uppercase">缺 {gap} 个</p>
                          )}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                    <AlertTriangle size={48} className="mb-4 opacity-20" />
                    <p>暂无库存预警信息</p>
                  </div>
                )}
              </div>
            </div>

            {/* 快捷操作（按权限显示） */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <h3 className="text-base font-bold text-slate-900 mb-5">快捷操作</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {shortcutItems.map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    className="flex flex-col items-center justify-center p-4 rounded-xl border border-slate-100 hover:bg-slate-50 transition-colors group"
                  >
                    <div
                      className={`w-12 h-12 rounded-full ${item.bg} ${item.color} flex items-center justify-center mb-3 group-hover:scale-110 transition-transform`}
                    >
                      <item.icon size={24} />
                    </div>
                    <span className="text-sm font-medium text-slate-700">{item.label}</span>
                  </Link>
                ))}
              </div>
            </div>
          </div>

          {/* 趋势图 + 有库存库位数 + 往来单位 TOP3 */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <h3 className="text-base font-bold text-slate-900 mb-5">
                近 {timeRange === 'month' ? '30' : '7'} 天出入库趋势
              </h3>
              <div className="flex items-end gap-1 h-32">
                {trendData.map((d, i) => (
                  <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full flex gap-0.5 items-end justify-center" style={{ height: 96 }}>
                      <div
                        className="flex-1 bg-indigo-500 rounded-t min-h-[2px] transition-all"
                        style={{ height: `${(d.in_count / maxVal) * 100}%` }}
                        title={`入库 ${d.in_count}`}
                      />
                      <div
                        className="flex-1 bg-orange-500 rounded-t min-h-[2px] transition-all"
                        style={{ height: `${(d.out_count / maxVal) * 100}%` }}
                        title={`出库 ${d.out_count}`}
                      />
                    </div>
                    <span className="text-[10px] text-slate-400 truncate max-w-full">
                      {format(parseUtc(d.date), 'M/d', { locale: zhCN })}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex gap-4 mt-4 justify-center">
                <span className="flex items-center gap-2 text-xs text-slate-500">
                  <span className="w-3 h-3 rounded bg-indigo-500" /> 入库
                </span>
                <span className="flex items-center gap-2 text-xs text-slate-500">
                  <span className="w-3 h-3 rounded bg-orange-500" /> 出库
                </span>
              </div>
            </div>

            <div className="space-y-5">
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                <h3 className="text-base font-bold text-slate-900 mb-3">有库存库位数</h3>
                <p className="text-2xl font-bold text-indigo-600">{stats.locationCount}</p>
              </div>
              {stats.partnerTop.length > 0 && (
                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                  <h3 className="text-base font-bold text-slate-900 mb-3">本月主要往来单位</h3>
                  <ul className="space-y-2">
                    {stats.partnerTop.map((p, i) => (
                      <li key={p.name} className="flex justify-between text-sm">
                        <span className="text-slate-700 truncate">{p.name}</span>
                        <span className="text-slate-500 font-medium">{p.cnt} 次</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>

          {/* 最近流水 */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">最近出入库</h3>
              <Link
                to="/history"
                className="text-xs font-bold text-indigo-600 hover:text-indigo-700 flex items-center gap-1 uppercase tracking-wider"
              >
                查看全部 <ChevronRight size={14} />
              </Link>
            </div>
            <div className="overflow-x-auto">
              <table className="wms-table w-full">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left py-3 px-4 text-slate-500 font-medium text-sm">时间</th>
                    <th className="text-left py-3 px-4 text-slate-500 font-medium text-sm">类型</th>
                    <th className="text-left py-3 px-4 text-slate-500 font-medium text-sm">物料</th>
                    <th className="text-left py-3 px-4 text-slate-500 font-medium text-sm">库位</th>
                    <th className="text-right py-3 px-4 text-slate-500 font-medium text-sm">数量</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.recentTransactions.length > 0 ? (
                    stats.recentTransactions.map((t) => (
                      <tr key={t.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                        <td className="py-3 px-4 text-sm text-slate-600">
                          {format(parseUtc(t.timestamp), 'yyyy-MM-dd HH:mm', { locale: zhCN })}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                              t.type === 'IN' ? 'bg-indigo-50 text-indigo-700' : 'bg-orange-50 text-orange-700'
                            }`}
                          >
                            {t.type === 'IN' ? '入库' : '出库'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-sm text-slate-900">
                          {t.material_name}
                          {t.material_code && (
                            <span className="text-slate-400 text-xs ml-1 font-mono">{t.material_code}</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-sm text-slate-600">{t.location_name}</td>
                        <td className="py-3 px-4 text-sm font-semibold text-slate-900 text-right">
                          {t.type === 'IN' ? '+' : '-'}
                          {t.quantity}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-slate-400">
                        暂无最近流水
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
