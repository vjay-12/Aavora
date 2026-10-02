import React from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { ShieldAlert, ArrowLeft, LogIn } from "lucide-react";

export const AccessDeniedPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const email = searchParams.get("email");
  const error = searchParams.get("error");
  const navigate = useNavigate();

  const handleTryAgain = () => {
    window.location.href = "/api/auth/login";
  };

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center p-4 bg-[#070b12] text-foreground relative overflow-hidden select-none">
      {/* Background glow */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-rose-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative w-full max-w-md bg-[#0d1322] border border-rose-500/20 rounded-3xl p-8 shadow-2xl text-center space-y-6">
        <div className="w-16 h-16 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center mx-auto text-rose-400">
          <ShieldAlert className="w-8 h-8" />
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-white font-['Outfit']">Access Denied</h1>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Aavora is a restricted private family document vault. Your Google account is not on the authorized members list.
          </p>
        </div>

        {email && (
          <div className="p-3 rounded-xl bg-white/5 border border-white/5 text-xs text-foreground font-mono break-all">
            Attempted login: <span className="text-rose-300 font-semibold">{email}</span>
          </div>
        )}

        {error && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300">
            {decodeURIComponent(error)}
          </div>
        )}

        <div className="pt-2 space-y-3">
          <button
            onClick={handleTryAgain}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white font-semibold text-xs shadow-lg shadow-sky-500/20 transition-all active:scale-95"
          >
            <LogIn className="w-4 h-4" />
            <span>Sign In with Authorized Google Account</span>
          </button>

          <button
            onClick={() => navigate("/")}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-white text-xs font-medium transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Home</span>
          </button>
        </div>
      </div>
    </div>
  );
};
