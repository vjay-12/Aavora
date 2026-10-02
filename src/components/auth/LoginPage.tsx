import React from "react";
import { Shield, Sparkles, Database, Lock, CheckCircle2, AlertTriangle } from "lucide-react";

export const LoginPage: React.FC = () => {
  const urlParams = new URLSearchParams(window.location.search);
  const authError = urlParams.get("auth_error");
  const rejectedEmail = urlParams.get("email");

  const handleGoogleLogin = () => {
    window.location.href = "/api/auth/login";
  };

  return (
    <div className="min-h-screen w-full flex flex-col justify-between bg-[#070b12] text-foreground relative overflow-hidden px-4 py-8">
      {/* Dynamic ambient background blobs */}
      <div className="absolute top-10 left-1/2 -translate-x-1/2 w-[550px] h-[350px] bg-gradient-to-tr from-sky-500/15 via-indigo-600/15 to-purple-600/15 blur-[120px] pointer-events-none rounded-full" />
      <div className="absolute -bottom-20 right-10 w-96 h-96 bg-sky-600/10 blur-[100px] pointer-events-none rounded-full" />

      {/* Header */}
      <header className="w-full max-w-5xl mx-auto flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-500 to-indigo-600 p-[1px] shadow-lg shadow-sky-500/20">
            <div className="w-full h-full bg-[#090d16] rounded-[11px] flex items-center justify-center">
              <Shield className="w-5 h-5 text-sky-400" />
            </div>
          </div>
          <span className="font-extrabold text-xl tracking-tight text-white font-['Outfit']">
            AAVORA
          </span>
        </div>
        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs text-sky-300">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>Singapore Region (sin1)</span>
        </div>
      </header>

      {/* Main Content */}
      <main className="w-full max-w-md mx-auto my-auto z-10 flex flex-col items-center text-center">
        {/* Error Alert if unallowed email tried to log in */}
        {authError && (
          <div className="w-full mb-6 p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-200 text-xs text-left flex items-start gap-3 shadow-lg">
            <AlertTriangle className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-semibold text-rose-300">
                {authError === "unregistered"
                  ? "Access Restricted to Allowed Members"
                  : authError === "account_deactivated"
                  ? "Account Deactivated"
                  : "Authentication Error"}
              </p>
              <p className="text-rose-200/80 leading-relaxed">
                {authError === "unregistered" && rejectedEmail
                  ? `The email (${rejectedEmail}) is not in the authorized Aavora user list. Please ask the vault administrator to grant access.`
                  : authError === "account_deactivated"
                  ? "Your account has been deactivated by the vault administrator."
                  : decodeURIComponent(authError)}
              </p>
            </div>
          </div>
        )}

        {/* Hero Badge */}
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-sky-500/10 border border-sky-500/20 text-sky-400 text-xs font-medium mb-6">
          <Sparkles className="w-3.5 h-3.5" />
          <span>Private Family & Personal Document Cloud</span>
        </div>

        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-white mb-4 leading-tight font-['Outfit']">
          Uncompromised speed.<br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-sky-400 via-indigo-300 to-purple-400">
            Absolute privacy.
          </span>
        </h1>

        <p className="text-sm text-muted-foreground mb-8 max-w-sm leading-relaxed">
          Powered directly by your Google Drive storage and low-latency Neon Postgres. Encrypted on your device, accessible anywhere.
        </p>

        {/* Sign in with Google Button */}
        <button
          onClick={handleGoogleLogin}
          className="w-full max-w-xs flex items-center justify-center gap-3 px-6 py-3.5 rounded-2xl bg-white hover:bg-slate-100 text-slate-900 font-semibold text-sm shadow-xl shadow-white/10 hover:shadow-white/20 transition-all duration-200 active:scale-95 group mb-8"
        >
          {/* Google Color G Icon */}
          <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
            />
          </svg>
          <span>Continue with Google</span>
        </button>

        {/* Value props cards */}
        <div className="grid grid-cols-3 gap-3 w-full text-left text-xs">
          <div className="p-3 rounded-xl bg-white/5 border border-white/5">
            <Lock className="w-4 h-4 text-sky-400 mb-2" />
            <div className="font-semibold text-white">Device Lock</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">Biometric & PBKDF2</div>
          </div>
          <div className="p-3 rounded-xl bg-white/5 border border-white/5">
            <Database className="w-4 h-4 text-indigo-400 mb-2" />
            <div className="font-semibold text-white">Neon DB</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">Instant activity sync</div>
          </div>
          <div className="p-3 rounded-xl bg-white/5 border border-white/5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 mb-2" />
            <div className="font-semibold text-white">Offline Ready</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">AES-GCM encryption</div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="w-full max-w-5xl mx-auto flex items-center justify-between text-[11px] text-muted-foreground pt-4 border-t border-white/5 z-10">
        <div>Aavora PWA Vault &copy; 2026</div>
        <div>Protected by Google OAuth & WebAuthn</div>
      </footer>
    </div>
  );
};
