import React, { createContext, useContext, useState, useEffect } from 'react';
import { apiClient, ApiError } from '../api/client';
import { hasPermission } from '../../shared/permissions';

export type Role = 'admin' | 'warehouse_keeper' | 'readonly' | 'reporter';

export interface User {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  permissions?: string[];
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  can: (action: string) => boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    
    apiClient
      .get<{ user: User }>('/api/auth/me')
      .then((data) => {
        if (data?.user) setUser(data.user);
        else setUser(null);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          localStorage.removeItem('token');
        }
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (username: string, password: string) => {
    try {
      const data = await apiClient.post<{ token: string; user: User }>('/api/auth/login', { username, password });
      localStorage.setItem('token', data.token);
      setUser(data.user);
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      } else {
        throw new Error('登录失败，请稍后重试');
      }
    }
  };

  const logout = async () => {
    try {
      await apiClient.post('/api/auth/logout', {});
    } catch (error) {
      console.error('登出失败:', error);
    } finally {
      localStorage.removeItem('token');
      setUser(null);
    }
  };

  const can = (action: string): boolean => {
    if (!user) return false;
    const perms = user.permissions || [];
    // 历史兼容：outbound_only 用 outbound
    if (action === 'outbound_only') return hasPermission(perms, 'outbound');
    return hasPermission(perms, action as any);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, can }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
