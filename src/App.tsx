import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/query-client";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { LoginPage } from "./components/auth/LoginPage";
import { AccessDeniedPage } from "./pages/AccessDeniedPage";
import { AppLayout } from "./components/layout/AppLayout";
import { DocsPage } from "./pages/DocsPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { PwaUpdatePrompt } from "./components/common/PwaUpdatePrompt";
import { Home, Bookmark, Activity, MoreHorizontal, Shield } from "lucide-react";

const AppRoutes: React.FC = () => {
  const { user, isLoading } = useAuth();

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
          <Route
            path="/home"
            element={
              <PlaceholderPage
                title="Home Dashboard"
                subtitle="High-level vault summary, storage meter, and recent files"
                icon={Home}
                badge="Phase 3"
                phaseInfo="Storage quota analytics, fast search, and recently opened document shortcuts."
              />
            }
          />
          <Route
            path="/saved"
            element={
              <PlaceholderPage
                title="Saved & Starred"
                subtitle="Quick access to pinned documents and offline vault"
                icon={Bookmark}
                badge="Phase 3"
                phaseInfo="Starred document quick list and AES-GCM encrypted local device offline storage."
              />
            }
          />
          <Route
            path="/activity"
            element={
              <PlaceholderPage
                title="Activity Feed"
                subtitle="Neon Postgres indexed audit trail of vault events"
                icon={Activity}
                badge="Phase 3"
                phaseInfo="Live event stream of file uploads, moves, renames, and deletions."
              />
            }
          />
          <Route
            path="/more"
            element={
              <PlaceholderPage
                title="More & Settings"
                subtitle="Google Drive Bin, members management, and security lock"
                icon={MoreHorizontal}
                badge="Phase 3"
                phaseInfo="Drive trash bin restoration, family members administration, and WebAuthn biometrics."
              />
            }
          />
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
        <BrowserRouter>
          <PwaUpdatePrompt />
          <AppRoutes />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
