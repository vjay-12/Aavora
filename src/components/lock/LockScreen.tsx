import React, { useState, useEffect, useCallback } from "react";
import { useLock } from "../../context/LockContext";
import { useAuth } from "../../context/AuthContext";
import { Shield, Fingerprint, Delete, AlertCircle, KeyRound } from "lucide-react";

export const LockScreen: React.FC = () => {
  const { unlockWithPin, unlockWithBiometric, isBiometricRegisteredState } = useLock();
  const { user, logout } = useAuth();
  const [pin, setPin] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [showForgotConfirm, setShowForgotConfirm] = useState(false);

  const handleBiometric = useCallback(async () => {
    setErrorMsg(null);
    setIsVerifying(true);
    const success = await unlockWithBiometric();
    setIsVerifying(false);
    if (!success) {
      setErrorMsg("Biometric verification cancelled or failed.");
    }
  }, [unlockWithBiometric]);

  // Auto trigger biometric prompt on initial mount if available
  useEffect(() => {
    if (isBiometricRegisteredState) {
      handleBiometric();
    }
  }, [isBiometricRegisteredState, handleBiometric]);

  const handleDigit = (digit: string) => {
    if (pin.length < 6) {
      const nextPin = pin + digit;
      setPin(nextPin);
      setErrorMsg(null);
      if (nextPin.length >= 4) {
        checkPin(nextPin);
      }
    }
  };

  const handleBackspace = () => {
    setPin((prev) => prev.slice(0, -1));
    setErrorMsg(null);
  };

  const checkPin = async (candidatePin: string) => {
    setIsVerifying(true);
    const success = await unlockWithPin(candidatePin);
    setIsVerifying(false);
    if (!success) {
      if (candidatePin.length >= 6) {
        setErrorMsg("Incorrect PIN. Please try again.");
        setPin("");
      }
    }
  };

  const handleForgotPin = async () => {
    // Re-verify with Google login: logs out and wipes local device PIN
    await logout();
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center p-4 bg-[#070b12] text-foreground select-none overflow-hidden">
      {/* Ambient background glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-primary/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 left-1/2 -translate-x-1/2 w-80 h-80 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative w-full max-w-sm flex flex-col items-center text-center">
        {/* Shield Icon & Brand */}
        <div className="relative mb-6">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-sky-500/20 via-indigo-500/20 to-purple-500/20 border border-sky-400/30 flex items-center justify-center shadow-lg shadow-sky-500/10 backdrop-blur-md">
            <Shield className="w-8 h-8 text-sky-400" />
          </div>
          <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
            <KeyRound className="w-2.5 h-2.5 text-emerald-400" />
          </div>
        </div>

        <h1 className="text-2xl font-bold tracking-tight text-white mb-1">
          Aavora Vault
        </h1>
        <p className="text-sm text-muted-foreground mb-6">
          {user?.name ? `Welcome back, ${user.name}` : "Enter device PIN to unlock"}
        </p>

        {/* PIN Dots Display */}
        <div className="flex items-center justify-center gap-3 mb-6 h-8">
          {[0, 1, 2, 3].map((idx) => {
            const filled = pin.length > idx;
            return (
              <div
                key={idx}
                className={`w-3.5 h-3.5 rounded-full transition-all duration-200 ${
                  filled
                    ? "bg-sky-400 scale-110 shadow-[0_0_8px_rgba(56,189,248,0.8)]"
                    : "bg-white/15 border border-white/10"
                }`}
              />
            );
          })}
        </div>

        {/* Error message */}
        {errorMsg && (
          <div className="flex items-center gap-1.5 text-xs text-rose-400 mb-4 bg-rose-500/10 border border-rose-500/20 px-3 py-1.5 rounded-full animate-shake">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Keypad Grid */}
        <div className="grid grid-cols-3 gap-3 w-64 mb-6">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((num) => (
            <button
              key={num}
              onClick={() => handleDigit(num)}
              disabled={isVerifying}
              className="h-14 rounded-2xl bg-white/5 hover:bg-white/10 active:bg-sky-500/20 border border-white/5 hover:border-white/15 text-xl font-medium text-white transition-all duration-150 flex items-center justify-center active:scale-95"
            >
              {num}
            </button>
          ))}

          {/* Biometric Button */}
          {isBiometricRegisteredState ? (
            <button
              onClick={handleBiometric}
              disabled={isVerifying}
              title="Unlock with biometric"
              className="h-14 rounded-2xl bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/30 text-sky-400 transition-all duration-150 flex items-center justify-center active:scale-95"
            >
              <Fingerprint className="w-6 h-6" />
            </button>
          ) : (
            <div className="h-14" />
          )}

          {/* 0 */}
          <button
            onClick={() => handleDigit("0")}
            disabled={isVerifying}
            className="h-14 rounded-2xl bg-white/5 hover:bg-white/10 active:bg-sky-500/20 border border-white/5 hover:border-white/15 text-xl font-medium text-white transition-all duration-150 flex items-center justify-center active:scale-95"
          >
            0
          </button>

          {/* Backspace */}
          <button
            onClick={handleBackspace}
            disabled={pin.length === 0 || isVerifying}
            title="Backspace"
            className="h-14 rounded-2xl bg-white/5 hover:bg-white/10 active:bg-white/15 border border-white/5 text-muted-foreground hover:text-white transition-all duration-150 flex items-center justify-center active:scale-95 disabled:opacity-30 disabled:pointer-events-none"
          >
            <Delete className="w-5 h-5" />
          </button>
        </div>

        {/* Forgot PIN / Reset Link */}
        {!showForgotConfirm ? (
          <button
            onClick={() => setShowForgotConfirm(true)}
            className="text-xs text-muted-foreground hover:text-sky-400 transition-colors"
          >
            Forgot device PIN?
          </button>
        ) : (
          <div className="bg-white/5 border border-white/10 p-3.5 rounded-xl text-left text-xs max-w-xs space-y-2">
            <p className="text-foreground">
              Resetting your PIN wipes local encrypted offline copies on this device, but your Drive files remain 100% safe. You will re-verify with Google Sign-in.
            </p>
            <div className="flex gap-2 justify-end pt-1">
              <button
                onClick={() => setShowForgotConfirm(false)}
                className="px-2.5 py-1 text-xs rounded-md bg-white/10 hover:bg-white/15 text-muted-foreground"
              >
                Cancel
              </button>
              <button
                onClick={handleForgotPin}
                className="px-2.5 py-1 text-xs rounded-md bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 font-medium"
              >
                Sign in with Google
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
