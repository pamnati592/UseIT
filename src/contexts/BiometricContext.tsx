import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import * as LocalAuthentication from 'expo-local-authentication';

// Spec 4.2: biometric auth required for full access; without it, read-only
// mode. Checked once per app session (mounted above MainTabNavigator, keyed
// by session so it re-runs on every fresh login/Switch User) rather than
// per-screen — a single shared flag every write action can check, instead
// of each screen reimplementing its own LocalAuthentication call.
type BiometricContextValue = {
  checking: boolean;
  isReadOnly: boolean;
  retry: () => void;
};

const BiometricContext = createContext<BiometricContextValue | null>(null);

export function BiometricProvider({ children }: { children: ReactNode }) {
  const [checking, setChecking] = useState(true);
  const [isReadOnly, setIsReadOnly] = useState(false);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hasHardware || !isEnrolled) {
        setIsReadOnly(true);
        return;
      }
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Verify it\'s you to unlock full access',
        fallbackLabel: 'Use passcode',
      });
      setIsReadOnly(!result.success);
    } catch {
      setIsReadOnly(true);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => { check(); }, [check]);

  return (
    <BiometricContext.Provider value={{ checking, isReadOnly, retry: check }}>
      {children}
    </BiometricContext.Provider>
  );
}

export function useBiometric(): BiometricContextValue {
  const ctx = useContext(BiometricContext);
  if (!ctx) throw new Error('useBiometric must be used within BiometricProvider');
  return ctx;
}
