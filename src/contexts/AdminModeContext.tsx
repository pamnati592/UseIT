import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../services/supabase';

const STORAGE_KEY = 'sar_admin_mode_active';

// Admin was previously just a flag bolted onto a personal profile — reached
// via a menu item, still "Ori's" account the whole time. Requested
// 2026-08-19: make Admin a genuinely separate persona, an app-wide mode you
// step into and back out of, not a nested screen. While active, the Chats
// tab shows only the support inbox (see ChatsScreen) instead of personal
// rentals — nothing done in this mode is "as Ori." Home/AI Planner/Add Item
// deliberately stay untouched (confirmed) — this only changes what Chats
// means and makes the mode visually unmistakable via the global banner.
type AdminModeContextValue = {
  isAdmin: boolean;
  adminModeActive: boolean;
  enterAdminMode: () => void;
  exitAdminMode: () => void;
};

const AdminModeContext = createContext<AdminModeContextValue | null>(null);

export function AdminModeProvider({ children }: { children: ReactNode }) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminModeActive, setAdminModeActive] = useState(false);

  useEffect(() => {
    let mounted = true;

    // Re-checked on every auth change (not just once on mount) — this app's
    // "Switch User" feature swaps the session without a fresh app launch, so
    // switching from an admin to a non-admin test account must immediately
    // stop treating the new session as admin.
    async function loadForUser(userId: string | null) {
      if (!userId) {
        if (mounted) { setIsAdmin(false); setAdminModeActive(false); }
        return;
      }
      const { data } = await supabase.from('profiles').select('is_admin').eq('id', userId).single();
      if (!mounted) return;
      const admin = !!data?.is_admin;
      setIsAdmin(admin);
      if (admin) {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (mounted) setAdminModeActive(stored === 'true');
      } else {
        setAdminModeActive(false);
      }
    }

    supabase.auth.getUser().then(({ data }) => loadForUser(data.user?.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      loadForUser(session?.user?.id ?? null);
    });

    return () => { mounted = false; sub.subscription.unsubscribe(); };
  }, []);

  function enterAdminMode() {
    setAdminModeActive(true);
    AsyncStorage.setItem(STORAGE_KEY, 'true');
  }
  function exitAdminMode() {
    setAdminModeActive(false);
    AsyncStorage.setItem(STORAGE_KEY, 'false');
  }

  return (
    <AdminModeContext.Provider value={{ isAdmin, adminModeActive, enterAdminMode, exitAdminMode }}>
      {children}
    </AdminModeContext.Provider>
  );
}

export function useAdminMode(): AdminModeContextValue {
  const ctx = useContext(AdminModeContext);
  if (!ctx) throw new Error('useAdminMode must be used within AdminModeProvider');
  return ctx;
}
