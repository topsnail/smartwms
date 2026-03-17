import React from 'react';
import { MapPin, Ruler, Users, Building2, Package, Download, Handshake, KeyRound, SlidersHorizontal, Settings as SettingsIcon } from 'lucide-react';
import { Button } from 'antd';
import { useAuth } from '../contexts/AuthContext';
import type { SettingsTabId, SimpleNameType } from './settings/types';
import { PageHeader } from '../components/PageHeader';
import { SimpleNamePanel } from './settings/SimpleNamePanel';
import { StaffPanel } from './settings/StaffPanel';
import { CategoriesPanel } from './settings/CategoriesPanel';
import { PartnersPanel } from './settings/PartnersPanel';
import { ImportExportPanel } from './settings/ImportExportPanel';
import { AccountsPanel } from './settings/AccountsPanel';
import { RolePermissionsPanel } from './settings/RolePermissionsPanel';

export default function Settings() {
  const { can, user } = useAuth();
  const [activeTab, setActiveTab] = React.useState<SettingsTabId>('locations');

  const tabs = [
    { id: 'locations', name: '存放位置', icon: MapPin },
    { id: 'units', name: '计量单位', icon: Ruler },
    { id: 'departments', name: '领料部门', icon: Building2 },
    { id: 'reasons', name: '领用事由', icon: Building2 },
    { id: 'sources', name: '物料来源', icon: Package },
    { id: 'categories', name: '物料分类', icon: Package },
    { id: 'partners', name: '往来单位', icon: Handshake },
    { id: 'staff', name: '人员管理', icon: Users },
    ...(can('manage_role_permissions') ? [{ id: 'role-permissions', name: '角色权限', icon: SlidersHorizontal }] : []),
    ...(can('manage_accounts') ? [{ id: 'accounts', name: '账号与权限', icon: KeyRound }] : []),
    { id: 'import-export', name: '数据导入导出', icon: Download },
  ] as const;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<SettingsIcon size={22} className="text-blue-500" />}
        title="系统设置"
        subtitle="管理仓库的基础配置数据，如库位、单位、人员等。"
      />

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Sidebar Tabs */}
        <div className="w-full lg:w-64 space-y-1">
          {tabs.map((tab) => (
            <Button
              key={tab.id}
              type={activeTab === tab.id ? 'primary' : 'text'}
              block
              onClick={() => setActiveTab(tab.id)}
              className={`!justify-start !h-auto py-2.5 px-4 rounded-xl text-sm font-medium ${
                activeTab === tab.id ? '!bg-white !text-blue-600 shadow-sm border border-slate-200' : '!text-slate-600 hover:!bg-white/50'
              }`}
              icon={<tab.icon size={18} />}
            >
              {tab.name}
            </Button>
          ))}
        </div>

        {/* Content Area */}
        <div className="flex-1 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-semibold text-slate-900">{tabs.find(t => t.id === activeTab)?.name}</h3>
            {/* 各面板内自带“新增/编辑”交互，避免在 Settings.tsx 中继续膨胀 */}
          </div>

          <div className="p-5">
            {activeTab === "import-export" ? (
              <ImportExportPanel />
            ) : activeTab === "staff" ? (
              <StaffPanel />
            ) : activeTab === "categories" ? (
              <CategoriesPanel />
            ) : activeTab === "partners" ? (
              <PartnersPanel />
            ) : activeTab === "accounts" ? (
              <AccountsPanel />
            ) : activeTab === "role-permissions" ? (
              <RolePermissionsPanel />
            ) : (
              <SimpleNamePanel type={activeTab as SimpleNameType} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
