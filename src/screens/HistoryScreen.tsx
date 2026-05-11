import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';

export default function HistoryScreen() {
  const navigation = useNavigation();
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backArrow}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.title}>History</Text>
        <View style={styles.backBtn} />
      </View>
      <View style={styles.empty}>
        <Text style={styles.emptyIcon}>🕓</Text>
        <Text style={styles.emptyText}>Coming soon</Text>
        <Text style={styles.emptySub}>Your completed and past rentals will appear here</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a1a' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12,
  },
  backBtn: { width: 36 },
  backArrow: { fontSize: 32, color: '#fff', fontWeight: '300', lineHeight: 36 },
  title: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '700', color: '#fff' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyIcon: { fontSize: 48 },
  emptyText: { fontSize: 18, fontWeight: '600', color: '#fff' },
  emptySub: { fontSize: 14, color: '#666', textAlign: 'center', paddingHorizontal: 40 },
});
