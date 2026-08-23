import { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ProfileStackParamList } from '../navigation/ProfileStackNavigator';
import { supabase } from '../services/supabase';
import { useTheme } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/colors';
import { ChevronLeft, Scale, PackageCheck, Users, Clock, ShieldCheck, ChevronRight } from 'lucide-react-native';

type Props = NativeStackScreenProps<ProfileStackParamList, 'AdminHome'>;

export default function AdminHomeScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [disputeCount, setDisputeCount] = useState(0);
  const [pendingItemCount, setPendingItemCount] = useState(0);
  const [overdueCount, setOverdueCount] = useState(0);
  const [supportUnreadCount, setSupportUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        const [disputes, items, overdue, support] = await Promise.all([
          supabase.rpc('admin_list_disputes'),
          supabase.rpc('admin_list_pending_items'),
          supabase.rpc('admin_list_overdue_rentals'),
          supabase.rpc('admin_list_support_threads'),
        ]);
        if (!active) return;
        setDisputeCount(disputes.data?.length ?? 0);
        setPendingItemCount(items.data?.length ?? 0);
        setOverdueCount(overdue.data?.length ?? 0);
        setSupportUnreadCount(
          ((support.data as any[]) ?? []).filter(t =>
            t.last_message_at && (!t.admin_last_read_at || new Date(t.last_message_at) > new Date(t.admin_last_read_at))
          ).length
        );
        setLoading(false);
      })();
      return () => { active = false; };
    }, [])
  );

  const items = [
    {
      key: 'AdminDisputes' as const,
      icon: Scale,
      label: 'Dispute Queue',
      count: disputeCount,
      sub: 'Review evidence and rule in favor of a party',
    },
    {
      key: 'AdminItems' as const,
      icon: PackageCheck,
      label: 'Item Moderation',
      count: pendingItemCount,
      sub: 'Approve or reject pending listings',
    },
    {
      key: 'AdminUsers' as const,
      icon: Users,
      label: 'User Management',
      count: null,
      sub: 'Search users, ban or unban',
    },
    {
      key: 'AdminOverdue' as const,
      icon: Clock,
      label: 'Overdue Rentals',
      count: overdueCount,
      sub: 'Late-return fees and 2-week overdue penalties',
    },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('ProfileMain')} style={styles.backBtn}>
          <ChevronLeft size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Admin Console</Text>
        <View style={styles.backBtn} />
      </View>

      {loading ? (
        <ActivityIndicator color={colors.text} style={{ flex: 1 }} />
      ) : (
        <View style={styles.list}>
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <TouchableOpacity key={item.key} style={styles.row} onPress={() => navigation.navigate(item.key)}>
                <View style={styles.rowIcon}>
                  <Icon size={20} color={colors.primary} />
                </View>
                <View style={styles.rowContent}>
                  <View style={styles.rowTop}>
                    <Text style={styles.rowLabel}>{item.label}</Text>
                    {item.count !== null && item.count > 0 && (
                      <View style={styles.countBadge}>
                        <Text style={styles.countBadgeText}>{item.count}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.rowSub}>{item.sub}</Text>
                </View>
                <ChevronRight size={18} color={colors.textFaint} />
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12,
  },
  backBtn: { width: 36 },
  title: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '700', color: colors.text },
  list: { padding: 16, gap: 10 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.card, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: colors.border,
  },
  rowIcon: {
    width: 40, height: 40, borderRadius: 10, backgroundColor: colors.infoBg,
    alignItems: 'center', justifyContent: 'center',
  },
  rowContent: { flex: 1, gap: 2 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowLabel: { fontSize: 15, fontWeight: '600', color: colors.text },
  rowSub: { fontSize: 12, color: colors.textFaint },
  countBadge: {
    backgroundColor: colors.danger, borderRadius: 10,
    minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 5,
  },
  countBadgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
});
