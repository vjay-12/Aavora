import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/query-client";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { LockProvider, useLock } from "./context/LockContext";
import { LockScreen } from "./components/lock/LockScreen";
import { LoginPage } from "./components/auth/LoginPage";
import { AccessDeniedPage } from "./pages/AccessDeniedPage";
import { AppLayout } from "./components/layout/AppLayout";
import { DocsPage } from "./pages/DocsPage";
import { HomePage } from "./pages/HomePage";
import { SavedPage } from "./pages/SavedPage";
import { ActivityPage } from "./pages/ActivityPage";
import { MorePage } from "./pages/MorePage";
import { PwaUpdatePrompt } from "./components/common/PwaUpdatePrompt";
import { Shield } from "lucide-react";

const AppRoutes: React.FC = () => {
  const { user, isLoading } = useAuth();
  const { isLocked, hasDeviceLock } = useLock();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#070b12] flex flex-col items-center justify-center text-foreground">
        <div className="relative mb-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-sky-500/20 via-indigo-500/20 to-purple-500/20 border border-sky-400/30 flex items-center justify-center animate-pulse">
            <Shield className="w-7 h-7 text-sky-400" />
          </div>
        </div>
        <p className="text-xs text-muted-foreground font-mono tracking-wider">
          LOADING AAVORA VAULT...
        </p>
      </div>
    );
  }

  // Device Lock Screen (if PIN is configured and vault is currently locked)
  if (user && hasDeviceLock && isLocked) {
    return <LockScreen />;
  }

  return (
    <Routes>
      {/* Access Denied Route (Accessible regardless of login state) */}
      <Route path="/access-denied" element={<AccessDeniedPage />} />

      {/* Main Authenticated Layout or Login */}
      {!user ? (
        <Route path="*" element={<LoginPage />} />
      ) : (
        <Route element={<AppLayout />}>
          <Route path="/" element={<Navigate to="/docs" replace />} />
          <Route path="/docs" element={<DocsPage />} />
          <Route path="/home" element={<HomePage />} />
          <Route path="/saved" element={<SavedPage />} />
          <Route path="/activity" element={<ActivityPage />} />
          <Route path="/more" element={<MorePage />} />
          <Route path="*" element={<Navigate to="/docs" replace />} />
        </Route>
      )}
    </Routes>
  );
};

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <LockProvider>
          <BrowserRouter>
            <PwaUpdatePrompt />
            <AppRoutes />
          </BrowserRouter>
        </LockProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
