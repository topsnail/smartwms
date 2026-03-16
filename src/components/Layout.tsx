import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Package,
  Database,
  ArrowDownLeft,
  ArrowUpRight,
  History,
  Settings,
  FileText,
  Menu,
  X,
  LogOut,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { Breadcrumb, Tooltip } from 'antd';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const navItems = [
  { name: '仪表盘', path: '/', icon: LayoutDashboard },
  { name: '物料管理', path: '/materials', icon: Package },
  { name: '实时库存', path: '/inventory', icon: Database },
  { name: '物料入库', path: '/inbound', icon: ArrowDownLeft },
  { name: '物料出库', path: '/outbound', icon: ArrowUpRight },
  { name: '出入记录', path: '/history', icon: History },
  { name: '报表分析', path: '/reports', icon: FileText },
  { name: '操作日志', path: '/logs', icon: FileText },
  { name: '系统设置', path: '/settings', icon: Settings },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout, can } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState<boolean>(() => {
    const saved = localStorage.getItem('wms.sidebarCollapsed');
    return saved === '1';
  });

  React.useEffect(() => {
    localStorage.setItem('wms.sidebarCollapsed', collapsed ? '1' : '0');
  }, [collapsed]);

  const visibleNavItems = React.useMemo(
    () =>
      navItems.filter((item) => {
        if (item.path === '/inbound' && !can('inbound')) return false;
        if (item.path === '/outbound' && !can('outbound_only')) return false;
        return true;
      }),
    [can]
  );

  const activeNavItem = React.useMemo(() => {
    const p = location.pathname || '/';
    const exact = visibleNavItems.find((n) => n.path === p);
    if (exact) return exact;
    // fallback：按前缀匹配（避免子路由/未来扩展时无标题）
    const prefix = visibleNavItems
      .filter((n) => n.path !== '/' && p.startsWith(n.path))
      .sort((a, b) => b.path.length - a.path.length)[0];
    return prefix || visibleNavItems.find((n) => n.path === '/') || null;
  }, [location.pathname, visibleNavItems]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar - Desktop */}
      <aside
        className={cn(
          "hidden md:flex flex-col bg-white border-r border-slate-200 sticky top-0 h-screen transition-[width] duration-200",
          collapsed ? "w-16" : "w-60"
        )}
      >
        <div className={cn("border-b border-slate-100", collapsed ? "p-3" : "p-5")}>
          <div className="flex items-center justify-between gap-2">
            <div className={cn("flex items-center gap-2 min-w-0", collapsed ? "justify-center w-full" : "")}>
              <div className="w-9 h-9 bg-blue-500 rounded-lg flex items-center justify-center text-white shrink-0">
                <Package size={20} />
              </div>
              {!collapsed ? (
                <div className="min-w-0">
                  <div className="text-base font-bold text-slate-900 leading-tight truncate">SmartWMS</div>
                  <div className="text-xs text-slate-500 leading-tight truncate">轻量级仓储管理</div>
                </div>
              ) : null}
            </div>

            {!collapsed ? (
              <Tooltip title="收起侧边栏">
                <button
                  onClick={() => setCollapsed(true)}
                  className="p-1.5 text-slate-500 hover:text-blue-600 rounded-lg hover:bg-slate-50"
                  aria-label="收起侧边栏"
                >
                  <ChevronLeft size={18} />
                </button>
              </Tooltip>
            ) : null}
          </div>

          {collapsed ? (
            <div className="mt-2 flex justify-center">
              <Tooltip title="展开侧边栏">
                <button
                  onClick={() => setCollapsed(false)}
                  className="p-1.5 text-slate-500 hover:text-blue-600 rounded-lg hover:bg-slate-50"
                  aria-label="展开侧边栏"
                >
                  <ChevronRight size={18} />
                </button>
              </Tooltip>
            </div>
          ) : null}
        </div>
        
        <nav className={cn("flex-1 py-3 space-y-1", collapsed ? "px-2" : "px-3")}>
          {visibleNavItems.map((item) => {
            const isActive = location.pathname === item.path;
            const link = (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  "flex items-center rounded-lg text-sm font-medium transition-colors select-none",
                  collapsed ? "justify-center px-2 py-2" : "gap-3 px-3 py-2",
                  isActive
                    ? "bg-blue-50 text-blue-700"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                )}
              >
                <item.icon size={18} />
                {!collapsed ? <span className="truncate">{item.name}</span> : null}
              </Link>
            );

            if (!collapsed) return link;
            return (
              <Tooltip key={item.path} title={item.name} placement="right">
                {link}
              </Tooltip>
            );
          })}
        </nav>

        <div className={cn("border-t border-slate-100", collapsed ? "p-2" : "p-3")}>
          <div className={cn("flex items-center rounded-lg", collapsed ? "justify-center px-2 py-2" : "gap-3 px-3 py-2")}>
            <div className="w-9 h-9 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center text-xs font-bold shrink-0">
              {(user?.displayName || user?.username || "U").slice(0, 1)}
            </div>
            {!collapsed ? (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-900 truncate">{user?.displayName || user?.username}</p>
                <p className="text-xs text-slate-500 truncate">
                  {user?.role === 'admin'
                    ? '管理员'
                    : user?.role === 'warehouse_keeper'
                      ? '仓管员'
                      : user?.role === 'reporter'
                        ? '统计员'
                        : '只读'}
                </p>
              </div>
            ) : null}
            {!collapsed ? (
              <Tooltip title="退出登录">
                <button
                  onClick={handleLogout}
                  className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg hover:bg-slate-50"
                  aria-label="退出登录"
                >
                  <LogOut size={18} />
                </button>
              </Tooltip>
            ) : (
              <Tooltip title="退出登录" placement="right">
                <button
                  onClick={handleLogout}
                  className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg hover:bg-slate-50"
                  aria-label="退出登录"
                >
                  <LogOut size={18} />
                </button>
              </Tooltip>
            )}
          </div>
        </div>
      </aside>

      {/* Mobile Header */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 z-50">
        <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
          <Package size={20} className="text-indigo-600" />
          SmartWMS
        </h1>
        <button 
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="p-2 text-slate-600"
        >
          {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Mobile Menu Overlay */}
      {isMobileMenuOpen && (
        <div className="md:hidden fixed inset-0 bg-slate-900/50 z-40" onClick={() => setIsMobileMenuOpen(false)} />
      )}

      {/* Mobile Sidebar */}
      <aside className={cn(
        "md:hidden fixed top-0 left-0 bottom-0 w-64 bg-white z-50 transform transition-transform duration-300 ease-in-out",
        isMobileMenuOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="p-6 border-b border-slate-100">
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Package size={20} className="text-indigo-600" />
            SmartWMS
          </h1>
        </div>
        <nav className="p-4 space-y-1">
          {navItems.filter((item) => {
            if (item.path === '/inbound' && !can('inbound')) return false;
            if (item.path === '/outbound' && !can('outbound_only')) return false;
            return true;
          }).map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setIsMobileMenuOpen(false)}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                  isActive 
                    ? "bg-indigo-50 text-indigo-700" 
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                )}
              >
                <item.icon size={18} />
                {item.name}
              </Link>
            );
          })}
          <div className="p-4 border-t border-slate-100 mt-4">
            <button onClick={handleLogout} className="flex items-center gap-3 px-3 py-2 w-full text-slate-600 hover:text-red-600 rounded-lg">
              <LogOut size={18} /> 退出登录
            </button>
          </div>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 pt-16 md:pt-0">
        <div className="p-4 md:p-5 max-w-7xl mx-auto w-full text-sm space-y-3">
          <div className="flex items-center justify-between">
            <Breadcrumb
              items={[
                { title: <Link to="/">首页</Link> },
                ...(activeNavItem && activeNavItem.path !== '/'
                  ? [{ title: <span className="text-slate-700">{activeNavItem.name}</span> }]
                  : []),
              ]}
            />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
