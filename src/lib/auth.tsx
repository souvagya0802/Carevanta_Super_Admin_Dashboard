'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, api, session } from './api';

export interface Me {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  status: string;
  mustChangePassword: boolean;
  roles: string[];
  permissions: string[];
}

interface AuthState {
  me: Me | null;
  loading: boolean;
  can: (...permissions: string[]) => boolean;
  login: (identifier: string, password: string) => Promise<Me>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchMe = useCallback(async (): Promise<Me | null> => {
    // A throttled or briefly unavailable API keeps the session (see refresh() in api.ts): retry a
    // couple of times before giving up, instead of treating it as signed out.
    for (let attempt = 0; ; attempt++) {
      if (!session.accessToken && !session.hasRefreshToken()) return null;
      try {
        return (await api.get<{ data: Me }>('/auth/me')).data;
      } catch (err) {
        const transient = !(err instanceof ApiError) || err.status === 429 || err.status >= 500 || (err.status === 401 && session.hasRefreshToken());
        if (!transient || attempt >= 2) return null;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
  }, []);
  const reload = useCallback(async () => {
    const m = await fetchMe();
    setMe(m);
    setLoading(false);
  }, [fetchMe]);

  useEffect(() => {
    let active = true;
    fetchMe().then((m) => {
      if (!active) return;
      setMe(m);
      setLoading(false);
    });
    const unsubscribe = session.subscribe((signedIn) => {
      if (!signedIn) setMe(null);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [fetchMe]);

  const login = useCallback(async (identifier: string, password: string) => {
    const { data } = await api.post<{ data: { accessToken: string; refreshToken: string } }>('/auth/login', { identifier, password });
    session.set(data);
    const meRes = await api.get<{ data: Me }>('/auth/me');
    setMe(meRes.data);
    return meRes.data;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout', { allDevices: false });
    } catch {
      /* already invalid */
    }
    session.clear();
    setMe(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      me,
      loading,
      can: (...perms) => !!me && perms.every((p) => me.permissions.includes(p)),
      login,
      logout,
      reload,
    }),
    [me, loading, login, logout, reload],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
