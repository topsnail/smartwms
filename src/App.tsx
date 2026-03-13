import { BrowserRouter as Router, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import { lazy, Suspense } from 'react';

// 懒加载组件
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Materials = lazy(() => import('./pages/Materials'));
const Inventory = lazy(() => import('./pages/Inventory'));
const TransactionForm = lazy(() => import('./pages/TransactionForm'));
const History = lazy(() => import('./pages/History'));
const Settings = lazy(() => import('./pages/Settings'));
const OperationLogs = lazy(() => import('./pages/OperationLogs'));
const Reports = lazy(() => import('./pages/Reports'));

function ProtectedLayout() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-slate-500">加载中...</div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return (
    <Layout>
      <Suspense fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-50">
          <div className="text-slate-500">加载中...</div>
        </div>
      }>
        <Outlet />
      </Suspense>
    </Layout>
  );
}

export default function App() {
  return (
    <Router>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<ProtectedLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="materials" element={<Materials />} />
            <Route path="inventory" element={<Inventory />} />
            <Route path="inbound" element={<TransactionForm type="IN" />} />
            <Route path="outbound" element={<TransactionForm type="OUT" />} />
            <Route path="history" element={<History />} />
            <Route path="settings" element={<Settings />} />
            <Route path="logs" element={<OperationLogs />} />
            <Route path="reports" element={<Reports />} />
          </Route>
        </Routes>
      </AuthProvider>
    </Router>
  );
}
