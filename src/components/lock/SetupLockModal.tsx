import React, { useState } from "react";
import { useLock } from "../../context/LockContext";
import { ShieldCheck, Fingerprint, Lock, Check } from "lucide-react";

interface SetupLockModalProps {
  isOpen: boolean;
  onClose?: () => void;
}

export const SetupLockModal: React.FC<SetupLockModalProps> = ({ isOpen, onClose }) => {
  const { setupLock, isBiometricSupported } = useLock();
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [enableBio, setEnableBio] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.length < 4) {
      setErrorMsg("PIN must be at least 4 digits");
      return;
    }
    if (pin !== confirmPin) {
      setErrorMsg("PINs do not match");
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const ok = await setupLock(pin, enableBio);
      if (ok && onClose) {
        onClose();
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to setup device lock");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div className="relative w-full max-w-md bg-[#0d1322] border border-white/10 rounded-2xl p-6 shadow-2xl text-foreground">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-sky-500/20 border border-sky-500/30 flex items-center justify-center text-sky-400">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">Setup Device Lock</h2>
            <p className="text-xs text-muted-foreground">
              Protect this device & encrypt your offline documents
            </p>
          </div>
        </div>

        <p className="text-xs text-muted-foreground mb-4 bg-white/5 p-3 rounded-xl border border-white/5 leading-relaxed">
          This PIN and optional biometric lock remain <strong>strictly local to this device</strong>. They are never transmitted over the internet or saved in Neon.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">
              Create Device PIN (4 - 6 digits)
            </label>
            <div className="relative">
              <input
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                placeholder="Enter 4-6 digits"
                className="w-full px-4 py-2.5 bg-black/40 border border-white/10 rounded-xl text-center text-lg tracking-widest text-white focus:outline-none focus:border-sky-500"
                required
              />
              <Lock className="w-4 h-4 text-muted-foreground absolute left-3 top-3.5" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-foreground mb-1">
              Confirm Device PIN
            </label>
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ""))}
              placeholder="Confirm digits"
              className="w-full px-4 py-2.5 bg-black/40 border border-white/10 rounded-xl text-center text-lg tracking-widest text-white focus:outline-none focus:border-sky-500"
              required
            />
          </div>

          {isBiometricSupported && (
            <label className="flex items-center gap-3 p-3 bg-white/5 rounded-xl border border-white/5 cursor-pointer hover:bg-white/10 transition-colors">
              <input
                type="checkbox"
                checked={enableBio}
                onChange={(e) => setEnableBio(e.target.checked)}
                className="rounded border-white/20 text-sky-500 focus:ring-sky-500/20 bg-black/30"
              />
              <Fingerprint className="w-5 h-5 text-sky-400 flex-shrink-0" />
              <div className="text-left text-xs">
                <span className="font-medium text-white block">Enable Biometrics</span>
                <span className="text-muted-foreground">
                  Unlock using Touch ID, Face ID, or Windows Hello
                </span>
              </div>
            </label>
          )}

          {errorMsg && (
            <p className="text-xs text-rose-400 bg-rose-500/10 p-2.5 rounded-lg border border-rose-500/20 text-center">
              {errorMsg}
            </p>
          )}

          <div className="flex gap-2 justify-end pt-2">
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs rounded-xl bg-white/5 hover:bg-white/10 text-muted-foreground transition-colors"
              >
                Later
              </button>
            )}
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-1.5 px-5 py-2.5 text-xs font-semibold rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white shadow-lg shadow-sky-500/25 transition-all duration-150 disabled:opacity-50"
            >
              <Check className="w-4 h-4" />
              <span>{isSubmitting ? "Securing Device..." : "Activate Device Lock"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
