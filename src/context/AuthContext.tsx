import React, { createContext, useContext, useEffect, useState } from "react";
import { clearQueryCache } from "../lib/query-client";
import { wipeOfflineStorage } from "../lib/offline-crypto";
import { resetDeviceLock } from "../lib/lock";

export interface UserSession {
  id: number;
  email: string;
  name: string;
  givenName?: string;
  picture?: string;
  role: "admin" | "member";
  isAdmin?: boolean;
}

interface AuthContextType {
  user: UserSession | null;
  isAdmin: boolean;
  isLoading: boolean;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchSession = async () => {
    try {
      const res = await fetch("/api/auth/me");
      if (res.ok) {
        const data = await res.json();
        const userData = data.user || null;
        const isAdmin = Boolean(data.isAdmin ?? userData?.isAdmin);
        if (userData) {
          userData.isAdmin = isAdmin;
        }
        setUser(userData);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSession();
  }, []);

  const logout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Ignore
    }
    await clearQueryCache();
    await wipeOfflineStorage();
    await resetDeviceLock();
    setUser(null);
    window.location.href = "/";
  };

  const isAdmin = Boolean(user?.isAdmin);

  return (
    <AuthContext.Provider value={{ user, isAdmin, isLoading, logout, refreshUser: fetchSession }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
};
