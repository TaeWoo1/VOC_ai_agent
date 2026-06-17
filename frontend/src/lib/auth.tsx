import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { UserView } from "./types";
import { api, clearToken, getToken, setToken } from "./apiClient";

interface AuthState {
  user: UserView | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserView | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    async function hydrate() {
      if (!getToken()) {
        setReady(true);
        return;
      }
      try {
        const me = await api.getMe();
        if (active) {
          setUser(me);
        }
      } catch {
        clearToken();
      } finally {
        if (active) {
          setReady(true);
        }
      }
    }
    hydrate();
    return () => {
      active = false;
    };
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      ready,
      async login(email: string, password: string) {
        const res = await api.login(email, password);
        setToken(res.token);
        setUser(res.user);
      },
      logout() {
        clearToken();
        setUser(null);
      },
    }),
    [user, ready],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
