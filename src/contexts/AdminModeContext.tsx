import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { supabase } from '../services/supabase';

// Whether the signed-in account is an admin — a fixed account property, not
// a mode you step into and back out of. Requested 2026-08-23: the earlier
// "Admin Mode" toggle (a persona you enter/exit, transforming the Chats tab
// into a platform-wide support inbox) was removed — admin functionality now
// lives only in the Admin Console (see AdminHomeScreen), reached from
// Profile. This context just answers "is this account an admin," for the
// few places that still need to know (e.g. hiding Contact UseIT from an
// admin's own rentals, since an admin is UseIT).
type AdminModeContextValue = {
  isAdmin: boolean;
};

const AdminModeContext = createContext<AdminModeContextValue | null>(null);

export function AdminModeProvider({ children }: { children: ReactNode }) {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let mounted = true;

    // Re-checked on every auth change (not just once on mount) — this app's
    // "Switch User" feature swaps the session without a fresh app launch, so
    // switching from an admin to a non-admin test account must immediately
    // stop treating the new session as admin.
    async function loadForUser(userId: string | null) {
      if (!userId) {
        if (mounted) setIsAdmin(false);
        return;
      }
      const { data } = await supabase.from('profiles').select('is_admin').eq('id', userId).single();
      if (!mounted) return;
      setIsAdmin(!!data?.is_admin);
    }

    supabase.auth.getUser().then(({ data }) => loadForUser(data.user?.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      loadForUser(session?.user?.id ?? null);
    });

    return () => { mounted = false; sub.subscription.unsubscribe(); };
  }, []);

  return (
    <AdminModeContext.Provider value={{ isAdmin }}>
      {children}
    </AdminModeContext.Provider>
  );
}

export function useAdminMode(): AdminModeContextValue {
  const ctx = useContext(AdminModeContext);
  if (!ctx) throw new Error('useAdminMode must be used within AdminModeProvider');
  return ctx;
}
