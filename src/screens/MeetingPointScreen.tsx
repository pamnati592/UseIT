import { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ChatsStackParamList } from '../navigation/ChatsStackNavigator';
import { useTheme } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/colors';
import { ChevronLeft, MapPin, Navigation, Users, CircleCheck } from 'lucide-react-native';

type Props = NativeStackScreenProps<ChatsStackParamList, 'MeetingPoint'>;

// TODO: replace with a real suggested spot once meeting-point selection is built
const MEETING_LOCATION = {
  name: 'Dizengoff Square',
  address: 'Dizengoff Square, Tel Aviv',
  distance: '0.3 km away',
};

export default function MeetingPointScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { renterName, lenderName, confirmMode } = route.params;
  const [confirmed, setConfirmed] = useState(false);

  function handleConfirm() {
    setConfirmed(true);
    setTimeout(() => navigation.goBack(), 1400);
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <ChevronLeft size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Meeting Point</Text>
        <View style={{ width: 36 }} />
      </View>

      {/* Map placeholder */}
      <View style={styles.mapContainer}>
        {/* Simulated map grid */}
        <View style={styles.mapGrid}>
          {Array.from({ length: 6 }).map((_, i) => (
            <View key={`h${i}`} style={[styles.gridLineH, { top: `${(i + 1) * 14}%` }]} />
          ))}
          {Array.from({ length: 6 }).map((_, i) => (
            <View key={`v${i}`} style={[styles.gridLineV, { left: `${(i + 1) * 14}%` }]} />
          ))}
        </View>

        {/* Roads simulation */}
        <View style={[styles.road, styles.roadH, { top: '42%' }]} />
        <View style={[styles.road, styles.roadH, { top: '60%' }]} />
        <View style={[styles.road, styles.roadV, { left: '38%' }]} />
        <View style={[styles.road, styles.roadV, { left: '60%' }]} />

        {/* Pin */}
        <View style={styles.pinWrapper}>
          <View style={styles.pinCircle}>
            <MapPin size={22} color={colors.white} fill={colors.white} strokeWidth={1.5} />
          </View>
          <View style={styles.pinShadow} />
        </View>

        {/* Location label on map */}
        <View style={styles.mapLabel}>
          <Text style={styles.mapLabelText}>{MEETING_LOCATION.name}</Text>
        </View>

        {/* Distance badge */}
        <View style={styles.distanceBadge}>
          <Navigation size={12} color={colors.primary} />
          <Text style={styles.distanceText}>{MEETING_LOCATION.distance}</Text>
        </View>
      </View>

      {/* Location card */}
      <View style={styles.locationCard}>
        <View style={styles.locationRow}>
          <View style={styles.locationIcon}>
            <MapPin size={20} color={colors.primary} />
          </View>
          <View style={styles.locationInfo}>
            <Text style={styles.locationName}>{MEETING_LOCATION.name}</Text>
            <Text style={styles.locationAddress}>{MEETING_LOCATION.address}</Text>
          </View>
        </View>
      </View>

      {/* Parties */}
      <View style={styles.partiesCard}>
        <View style={styles.partiesRow}>
          <Users size={16} color={colors.textMuted} />
          <Text style={styles.partiesLabel}>Meeting participants</Text>
        </View>
        <View style={styles.avatarRow}>
          <View style={styles.avatarItem}>
            <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
              <Text style={styles.avatarInitial}>{renterName.charAt(0).toUpperCase()}</Text>
            </View>
            <Text style={styles.avatarName}>{renterName}</Text>
            <Text style={styles.avatarRole}>Renter</Text>
          </View>
          <View style={styles.avatarDivider} />
          <View style={styles.avatarItem}>
            <View style={[styles.avatar, { backgroundColor: colors.accent }]}>
              <Text style={styles.avatarInitial}>{lenderName.charAt(0).toUpperCase()}</Text>
            </View>
            <Text style={styles.avatarName}>{lenderName}</Text>
            <Text style={styles.avatarRole}>Lender</Text>
          </View>
        </View>

        {/* Within 50m indicator */}
        <View style={styles.proximityRow}>
          <View style={styles.proximityDot} />
          <Text style={styles.proximityText}>Both parties are within 50 meters</Text>
        </View>
      </View>

      {/* Confirm button — hidden for the party who set the spot (confirmMode false) */}
      {confirmMode !== false && (
        <View style={styles.footer}>
          {confirmed ? (
            <View style={styles.confirmedRow}>
              <CircleCheck size={22} color={colors.success} />
              <Text style={styles.confirmedText}>Meeting point confirmed!</Text>
            </View>
          ) : (
            <TouchableOpacity style={styles.confirmBtn} onPress={handleConfirm} activeOpacity={0.85}>
              <Text style={styles.confirmBtnText}>Confirm Meeting Point</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '600', color: colors.text },

  // Map
  mapContainer: {
    height: 240, backgroundColor: '#1e2733', overflow: 'hidden', position: 'relative',
  },
  mapGrid: { ...StyleSheet.absoluteFillObject },
  gridLineH: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.05)' },
  gridLineV: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(255,255,255,0.05)' },
  road: { position: 'absolute', backgroundColor: '#2c3a4a' },
  roadH: { left: 0, right: 0, height: 16 },
  roadV: { top: 0, bottom: 0, width: 16 },

  pinWrapper: { position: 'absolute', top: '35%', left: '45%', alignItems: 'center' },
  pinCircle: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: '#f44336',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#f44336', shadowOpacity: 0.6, shadowRadius: 8, elevation: 8,
  },
  pinShadow: {
    width: 14, height: 6, borderRadius: 7,
    backgroundColor: 'rgba(0,0,0,0.3)',
    marginTop: 2,
  },

  mapLabel: {
    position: 'absolute', bottom: 48, alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 4,
  },
  mapLabelText: { color: '#fff', fontSize: 13, fontWeight: '600' },

  distanceBadge: {
    position: 'absolute', top: 12, right: 12,
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: colors.card, borderRadius: 12,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: colors.border,
  },
  distanceText: { color: colors.primary, fontSize: 12, fontWeight: '600' },

  // Cards
  locationCard: {
    marginHorizontal: 16, marginTop: 16,
    backgroundColor: colors.card, borderRadius: 14,
    padding: 16, borderWidth: 1, borderColor: colors.border,
  },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  locationIcon: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.infoBg,
    alignItems: 'center', justifyContent: 'center',
  },
  locationInfo: { flex: 1 },
  locationName: { fontSize: 16, fontWeight: '700', color: colors.text },
  locationAddress: { fontSize: 13, color: colors.textMuted, marginTop: 2 },

  partiesCard: {
    marginHorizontal: 16, marginTop: 12,
    backgroundColor: colors.card, borderRadius: 14,
    padding: 16, borderWidth: 1, borderColor: colors.border, gap: 14,
  },
  partiesRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  partiesLabel: { fontSize: 13, color: colors.textMuted, fontWeight: '500' },
  avatarRow: { flexDirection: 'row', alignItems: 'center' },
  avatarItem: { flex: 1, alignItems: 'center', gap: 6 },
  avatarDivider: { width: 1, height: 60, backgroundColor: colors.border },
  avatar: {
    width: 48, height: 48, borderRadius: 24,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitial: { color: '#fff', fontSize: 20, fontWeight: '700' },
  avatarName: { fontSize: 14, fontWeight: '600', color: colors.text },
  avatarRole: { fontSize: 12, color: colors.textMuted },

  proximityRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.successBg, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  proximityDot: {
    width: 8, height: 8, borderRadius: 4, backgroundColor: '#4cd964',
  },
  proximityText: { fontSize: 13, color: '#4cd964', fontWeight: '600' },

  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: 16, paddingBottom: 32, paddingTop: 12,
    backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.border,
  },
  confirmBtn: {
    height: 52, backgroundColor: colors.btn, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  confirmBtnText: { color: colors.btnText, fontSize: 16, fontWeight: '700' },
  confirmedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, height: 52 },
  confirmedText: { color: colors.success, fontSize: 16, fontWeight: '600' },
});
