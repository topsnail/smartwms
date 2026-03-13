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
  LogOut
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
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
  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar - Desktop */}
      <aside className="hidden md:flex flex-col w-64 bg-white border-r border-slate-200 sticky top-0 h-screen">
        <div className="p-6 border-b border-slate-100">
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white">
              <Package size={20} />
            </div>
            SmartWMS
          </h1>
        </div>
        
        <nav className="flex-1 px-4 py-4 space-y-1">
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
        </nav>

        <div className="p-4 border-t border-slate-100">
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs font-bold">
              {(user?.displayName || user?.username || "U").slice(0, 1)}
            </div>
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
            <button onClick={handleLogout} className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg" title="退出登录">
              <LogOut size={18} />
            </button>
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
        <div className="p-4 md:p-5 max-w-7xl mx-auto w-full">
          {children}
        </div>
      </main>
    </div>
  );
}
