import { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, type GestureResponderEvent } from 'react-native';
import { Play, Pause } from 'lucide-react-native';
import { useTheme } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/colors';

const BAR_COUNT = 28;

// Deterministic per-message bar heights (not a real decode of the audio's
// amplitude — that needs a native PCM decoder we don't have — but stable
// across renders/re-plays, and gives a real place to show playback position
// and seek, which is what actually matters here).
function seededBarHeights(seed: string): number[] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const bars: number[] = [];
  for (let i = 0; i < BAR_COUNT; i++) {
    h = (h * 1103515245 + 12345) >>> 0;
    bars.push(0.25 + ((h >>> 8) % 100) / 100 * 0.75);
  }
  return bars;
}

function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

export function VoiceMessageBubble({
  messageId, isMe, isPlaying, currentTime, duration, onToggle, onSeek,
}: {
  messageId: string;
  isMe: boolean;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  onToggle: () => void;
  onSeek: (fraction: number) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const bars = useMemo(() => seededBarHeights(messageId), [messageId]);
  const [barsWidth, setBarsWidth] = useState(0);

  const progressFraction = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  // Counts down while playing (spec: show time remaining, not the fixed total)
  // — before playback starts there's no "remaining" yet, so show the total.
  const displaySeconds = isPlaying ? Math.max(0, duration - currentTime) : duration;
  const activeColor = isMe ? colors.btnText : colors.text;
  const dimColor = isMe ? 'rgba(255,255,255,0.35)' : colors.border;

  function handleSeekPress(e: GestureResponderEvent) {
    if (barsWidth <= 0) return;
    const fraction = Math.max(0, Math.min(1, e.nativeEvent.locationX / barsWidth));
    onSeek(fraction);
  }

  return (
    <View style={styles.row}>
      <TouchableOpacity onPress={onToggle} style={styles.playBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 4 }}>
        {isPlaying ? <Pause size={16} color={activeColor} /> : <Play size={16} color={activeColor} />}
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.bars}
        activeOpacity={0.8}
        onLayout={(e) => setBarsWidth(e.nativeEvent.layout.width)}
        onPress={handleSeekPress}
      >
        {bars.map((height, i) => (
          <View
            key={i}
            style={[
              styles.bar,
              { height: `${Math.round(height * 100)}%`, backgroundColor: i / BAR_COUNT < progressFraction ? activeColor : dimColor },
            ]}
          />
        ))}
      </TouchableOpacity>
      <Text style={[styles.time, { color: activeColor }]}>{formatTime(displaySeconds)}</Text>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 180, paddingVertical: 2 },
  playBtn: { width: 24, alignItems: 'center', justifyContent: 'center' },
  bars: { flex: 1, height: 28, flexDirection: 'row', alignItems: 'center', gap: 2 },
  bar: { flex: 1, minHeight: 3, borderRadius: 1.5 },
  time: { fontSize: 11, fontVariant: ['tabular-nums'], minWidth: 30 },
});
