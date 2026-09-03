import { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ChatsStackParamList } from '../navigation/ChatsStackNavigator';
import { ChevronLeft, ClipboardList, CreditCard, QrCode, PackageCheck, ShieldCheck } from 'lucide-react-native';
import { useTheme } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/colors';

type Props = NativeStackScreenProps<ChatsStackParamList, 'RentalGuide'>;

const STEPS = [
  {
    icon: ClipboardList,
    title: '1. Request & approval',
    body: "Send a rental request with your dates from the item's page. The lender approves or declines it in the chat's Deal Board tab.",
  },
  {
    icon: CreditCard,
    title: '2. Payment',
    body: 'Once approved, pay from the Deal Board. Your payment is held until the rental is confirmed complete — nothing reaches the lender until then.',
  },
  {
    icon: QrCode,
    title: '3. Pickup',
    body: "Meet the lender, confirm the item's condition, and scan their QR code. That marks the rental active.",
  },
  {
    icon: PackageCheck,
    title: '4. Return',
    body: "At the end of the rental, meet again, confirm condition, and scan the return QR code. That's what completes the rental.",
  },
  {
    icon: ShieldCheck,
    title: 'If something goes wrong',
    body: "Use Get Help at any point. Message UseIT directly — you don't need to fill out any special form, just tell us what happened. A real person reviews it and steps in if needed.",
  },
];

export default function RentalGuideScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <ChevronLeft size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>How Renting Works</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {STEPS.map(({ icon: Icon, title, body }) => (
          <View key={title} style={styles.card}>
            <View style={styles.iconCircle}>
              <Icon size={20} color={colors.primary} />
            </View>
            <View style={styles.cardText}>
              <Text style={styles.cardTitle}>{title}</Text>
              <Text style={styles.cardBody}>{body}</Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 8, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface,
  },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: colors.text },
  scroll: { padding: 16, gap: 12 },
  card: {
    flexDirection: 'row', gap: 12,
    backgroundColor: colors.card, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: colors.border,
  },
  iconCircle: {
    width: 40, height: 40, borderRadius: 10, backgroundColor: colors.infoBg,
    alignItems: 'center', justifyContent: 'center',
  },
  cardText: { flex: 1, gap: 4 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  cardBody: { fontSize: 13, color: colors.textMuted, lineHeight: 19 },
});
