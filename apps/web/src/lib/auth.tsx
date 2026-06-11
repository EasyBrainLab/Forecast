'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, setToken } from './api';

export type Rolle = 'AGM' | 'VERTRIEBSLEITER' | 'BU_LEITER' | 'ADMIN' | 'SUPPORT';
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  rolle: Rolle;
  passwortWechselPflicht: boolean;
}

interface AuthCtx {
  user: AuthUser | null;
  laden: boolean;
  login: (email: string, passwort: string) => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [laden, setLaden] = useState(true);

  useEffect(() => {
    api
      .get<AuthUser>('/auth/me')
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLaden(false));
  }, []);

  const login = async (email: string, passwort: string): Promise<void> => {
    const res = await api.post<{ accessToken: string; user: AuthUser }>('/auth/login', { email, passwort });
    setToken(res.accessToken);
    setUser(res.user);
  };
  const logout = (): void => {
    setToken(null);
    setUser(null);
  };

  return <Ctx.Provider value={{ user, laden, login, logout }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth außerhalb AuthProvider');
  return c;
}

export const ROLLEN_LABEL: Record<Rolle, string> = {
  AGM: 'Regionsverantwortliche:r (AGM)',
  VERTRIEBSLEITER: 'Vertriebsleitung',
  BU_LEITER: 'BU-Leitung',
  ADMIN: 'Administration',
  SUPPORT: 'Support',
};
