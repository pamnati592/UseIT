import { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet } from 'react-native';
import { MoreVertical, ChevronRight } from 'lucide-react-native';
import { useTheme } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/colors';

export type OverflowMenuItem = {
  key: string;
  label: string;
  icon: React.ComponentType<{ size?: number; color?: string }>;
  onPress: () => void;
  destructive?: boolean;
};

// Page-level "everything that isn't this screen's core purpose" menu — a 3-dot
// button in the header opening the same bottom-sheet pattern already used by
// ProfileScreen's hamburger menu. Renders nothing when there are no items, so
// callers can pass a conditionally-empty array (e.g. hidden on your own profile)
// without needing their own visibility check around it.
export function OverflowMenu({ items }: { items: OverflowMenuItem[] }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const styles = makeStyles(colors);

  if (items.length === 0) return null;

  return (
    <>
      <TouchableOpacity
        style={styles.trigger}
        onPress={() => setOpen(true)}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <MoreVertical size={22} color={colors.text} />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            {items.map(({ key, label, icon: Icon, onPress, destructive }) => (
              <TouchableOpacity
                key={key}
                style={styles.sheetRow}
                onPress={() => { setOpen(false); onPress(); }}
              >
                <View style={styles.sheetRowIcon}>
                  <Icon size={20} color={destructive ? colors.dangerSoft : colors.text} />
                </View>
                <Text style={[styles.sheetRowLabel, destructive && styles.sheetRowLabelDanger]}>{label}</Text>
                <ChevronRight size={18} color={colors.textFaint} />
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  trigger: { padding: 4 },
  overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingBottom: 40, paddingTop: 12, gap: 4,
  },
  sheetHandle: { width: 40, height: 4, backgroundColor: colors.cardAlt, borderRadius: 2, alignSelf: 'center', marginBottom: 12 },
  sheetRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  sheetRowIcon: { width: 28, alignItems: 'center', justifyContent: 'center' },
  sheetRowLabel: { flex: 1, fontSize: 16, color: colors.text, fontWeight: '500' },
  sheetRowLabelDanger: { color: colors.dangerSoft },
});
