import { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ChatsStackParamList } from '../navigation/ChatsStackNavigator';
import { useTheme } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/colors';
import { ChevronLeft, MapPin, Navigation, MessageCircle } from 'lucide-react-native';

type Props = NativeStackScreenProps<ChatsStackParamList, 'MeetingPoint'>;

export default function MeetingPointScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { pickupLocation, itemTitle } = route.params;

  function openDirections() {
    if (!pickupLocation) return;
    const query = encodeURIComponent(pickupLocation);
    const url = Platform.OS === 'ios'
      ? `https://maps.apple.com/?q=${query}`
      : `https://www.google.com/maps/search/?api=1&query=${query}`;
    Linking.openURL(url);
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <ChevronLeft size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Meeting Point</Text>
        <View style={{ width: 36 }} />
      </View>

      <View style={styles.body}>
        <Text style={styles.itemName} numberOfLines={1}>{itemTitle}</Text>

        {pickupLocation ? (
          <>
            <View style={styles.locationCard}>
              <View style={styles.locationRow}>
                <View style={styles.locationIcon}>
                  <MapPin size={20} color={colors.primary} />
                </View>
                <View style={styles.locationInfo}>
                  <Text style={styles.locationLabel}>Set by the lender</Text>
                  <Text style={styles.locationName}>{pickupLocation}</Text>
                </View>
              </View>
            </View>

            <TouchableOpacity style={styles.directionsBtn} onPress={openDirections}>
              <Navigation size={16} color={colors.btnText} />
              <Text style={styles.directionsBtnText}>Get Directions</Text>
            </TouchableOpacity>
          </>
        ) : (
          <View style={styles.emptyCard}>
            <MapPin size={28} color={colors.textFaint} strokeWidth={1.5} />
            <Text style={styles.emptyText}>
              The lender hasn't set a pickup location for this item.
            </Text>
          </View>
        )}

        <View style={styles.noteRow}>
          <MessageCircle size={15} color={colors.textMuted} />
          <Text style={styles.noteText}>
            Want to meet somewhere else? Agree on a different spot together in chat.
          </Text>
        </View>
      </View>
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

  body: { padding: 20, gap: 16 },
  itemName: { fontSize: 13, color: colors.textFaint, textAlign: 'center' },

  locationCard: {
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
  locationLabel: { fontSize: 11, color: colors.textFaint },
  locationName: { fontSize: 16, fontWeight: '700', color: colors.text, marginTop: 2 },

  directionsBtn: {
    height: 48, backgroundColor: colors.btn, borderRadius: 12,
    flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center',
  },
  directionsBtnText: { color: colors.btnText, fontSize: 15, fontWeight: '700' },

  emptyCard: {
    alignItems: 'center', gap: 10, paddingVertical: 32,
    backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border,
  },
  emptyText: { fontSize: 14, color: colors.textMuted, textAlign: 'center', paddingHorizontal: 24, lineHeight: 20 },

  noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingHorizontal: 4 },
  noteText: { flex: 1, fontSize: 13, color: colors.textMuted, lineHeight: 18 },
});
