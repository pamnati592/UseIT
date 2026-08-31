import { StyleSheet } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';

// Native controls (play/pause/scrub) come free from expo-video — no custom
// player UI needed here, unlike the voice bubble which has no native equivalent.
export function VideoMessageBubble({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => { p.loop = false; });
  return <VideoView player={player} style={styles.video} nativeControls contentFit="cover" />;
}

const styles = StyleSheet.create({
  video: { width: 220, height: 220, borderRadius: 15 },
});
