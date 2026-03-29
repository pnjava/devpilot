import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { api } from "../lib/api";

interface User {
  id: string;
  username: string;
  avatarUrl: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: () => Promise<void>;
  devLogin: () => Promise<void>;
  handleCallback: (code: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("gp_token");
    if (token) {
      api.getMe()
        .then(setUser)
        .catch(() => localStorage.removeItem("gp_token"))
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = useCallback(async () => {
    const { url } = await api.getAuthUrl();
    window.location.href = url;
  }, []);

  const handleCallback = useCallback(async (code: string) => {
    const { token, user: u } = await api.authCallback(code);
    localStorage.setItem("gp_token", token);
    setUser(u);
  }, []);

  const devLogin = useCallback(async () => {
    const { token, user: u } = await api.devLogin();
    localStorage.setItem("gp_token", token);
    setUser(u);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("gp_token");
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, devLogin, handleCallback, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
