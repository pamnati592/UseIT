import { useState, useCallback, useRef } from 'react';
import { Alert } from 'react-native';
import { supabase } from '../services/supabase';
import type { Database } from '../types/database';

type AdminRpcName = keyof Database['public']['Functions'] & `admin_list_${string}`;

// Every admin list screen (Reports, Disputes, Items, Users, Overdue,
// Support Inbox) re-implemented the same "call one admin_list_* RPC, show a
// loading spinner, Alert on error, set the rows" boilerplate. This factors
// that out; each screen still owns its own useFocusEffect call (the refresh
// dependencies genuinely differ per screen, e.g. AdminUsersScreen re-loads
// when route.params.initialSearch changes) and its own mutation actions
// (approve/reject/ban/etc.) — only the read path moves here.
export function useAdminList<T>(
  rpcName: AdminRpcName,
  options?: { transform?: (rows: T[]) => Promise<T[]> | T[] },
) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);

  // A ref, not a dependency: an inline `{ transform: ... }` literal at the
  // call site would otherwise get a new identity every render, recreating
  // `load` and (through the screen's own useFocusEffect(useCallback(...,
  // [load]))) re-triggering a fetch on every render instead of just on focus.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const load = useCallback(async (params?: Record<string, unknown>) => {
    setLoading(true);
    const { data: rows, error } = await supabase.rpc(rpcName, params);
    if (error) { Alert.alert('Error', error.message); setLoading(false); return; }
    const result = (rows as T[]) ?? [];
    const transform = optionsRef.current?.transform;
    setData(transform ? await transform(result) : result);
    setLoading(false);
  }, [rpcName]);

  return { data, setData, loading, load };
}
