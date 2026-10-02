import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from "react";
import {
  isDeviceLockConfigured,
  setupDeviceLock,
  verifyDevicePassword,
  isBiometricsAvailable,
  isBiometricsRegistered,
  registerBiometric,
  verifyBiometric,
  getAutoLockTimeoutMinutes,
  setAutoLockTimeoutMinutes,
} from "../lib/lock";

interface LockContextType {
  isLocked: boolean;
  hasDeviceLock: boolean;
  isBiometricSupported: boolean;
  isBiometricRegisteredState: boolean;
  autoLockMinutes: number;
  unlockWithPin: (pin: string) => Promise<boolean>;
  unlockWithBiometric: () => Promise<boolean>;
  lockNow: () => void;
  setupLock: (pin: string, enableBiometrics?: boolean) => Promise<boolean>;
  updateAutoLockMinutes: (mins: number) => Promise<void>;
  enableBiometrics: () => Promise<boolean>;
}

const LockContext = createContext<LockContextType | undefined>(undefined);

export const LockProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isLocked, setIsLocked] = useState(false);
  const [hasDeviceLock, setHasDeviceLock] = useState(false);
  const [isBiometricSupported, setIsBiometricSupported] = useState(false);
  const [isBiometricRegisteredState, setIsBiometricRegisteredState] = useState(false);
  const [autoLockMinutes, setAutoLockMinutesState] = useState(5);
  const lastActivityRef = useRef<number>(0);
  const timerRef = useRef<number | null>(null);

  const initLockState = useCallback(async () => {
    const configured = await isDeviceLockConfigured();
    setHasDeviceLock(configured);

    const bioSupported = await isBiometricsAvailable();
    setIsBiometricSupported(bioSupported);

    if (configured) {
      const bioRegistered = await isBiometricsRegistered();
      setIsBiometricRegisteredState(bioRegistered);
      setIsLocked(true); // Always lock on initial app open if configured
    } else {
      setIsLocked(false);
    }

    const timeout = await getAutoLockTimeoutMinutes();
    setAutoLockMinutesState(timeout);
  }, []);

  useEffect(() => {
    initLockState();
  }, [initLockState]);

  // Idle tracking for auto-lock
  const resetActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
  }, []);

  useEffect(() => {
    if (!hasDeviceLock || isLocked) return;

    const events = ["mousedown", "mousemove", "keydown", "touchstart", "scroll"];
    events.forEach((ev) => window.addEventListener(ev, resetActivity, { passive: true }));

    // Visibility change handler (lock when minimized or switched tab after delay)
    const handleVisibilityChange = () => {
      if (document.hidden) {
        lastActivityRef.current = Date.now();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Periodic check for idle timeout
    timerRef.current = window.setInterval(() => {
      const idleTimeMs = Date.now() - lastActivityRef.current;
      const thresholdMs = autoLockMinutes * 60 * 1000;
      if (idleTimeMs >= thresholdMs) {
        setIsLocked(true);
      }
    }, 10000); // Check every 10 seconds

    return () => {
      events.forEach((ev) => window.removeEventListener(ev, resetActivity));
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [hasDeviceLock, isLocked, autoLockMinutes, resetActivity]);

  const unlockWithPin = async (pin: string): Promise<boolean> => {
    const valid = await verifyDevicePassword(pin);
    if (valid) {
      setIsLocked(false);
      lastActivityRef.current = Date.now();
      return true;
    }
    return false;
  };

  const unlockWithBiometric = async (): Promise<boolean> => {
    const valid = await verifyBiometric();
    if (valid) {
      setIsLocked(false);
      lastActivityRef.current = Date.now();
      return true;
    }
    return false;
  };

  const lockNow = () => {
    if (hasDeviceLock) {
      setIsLocked(true);
    }
  };

  const setupLock = async (pin: string, enableBio = false): Promise<boolean> => {
    const success = await setupDeviceLock(pin);
    if (!success) return false;

    if (enableBio && isBiometricSupported) {
      await registerBiometric();
      setIsBiometricRegisteredState(true);
    }

    setHasDeviceLock(true);
    setIsLocked(false);
    lastActivityRef.current = Date.now();
    return true;
  };

  const enableBiometrics = async (): Promise<boolean> => {
    const success = await registerBiometric();
    if (success) {
      setIsBiometricRegisteredState(true);
      return true;
    }
    return false;
  };

  const updateAutoLockMinutes = async (mins: number) => {
    await setAutoLockTimeoutMinutes(mins);
    setAutoLockMinutesState(mins);
  };

  return (
    <LockContext.Provider
      value={{
        isLocked,
        hasDeviceLock,
        isBiometricSupported,
        isBiometricRegisteredState,
        autoLockMinutes,
        unlockWithPin,
        unlockWithBiometric,
        lockNow,
        setupLock,
        updateAutoLockMinutes,
        enableBiometrics,
      }}
    >
      {children}
    </LockContext.Provider>
  );
};

export const useLock = () => {
  const context = useContext(LockContext);
  if (!context) throw new Error("useLock must be used within a LockProvider");
  return context;
};
