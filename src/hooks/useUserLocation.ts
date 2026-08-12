import { useState, useEffect, useCallback, useRef } from 'react';
import * as Location from 'expo-location';

export type Coords = { latitude: number; longitude: number; accuracy?: number | null };

export type LocationStatus =
  | 'idle'        // Permission not requested yet
  | 'requesting'  // Asking the user / waiting on the OS
  | 'granted'     // Coords successfully captured
  | 'denied'      // User declined permission
  | 'error';      // Lookup failed for any other reason

export type UserLocation = {
  coords: Coords | null;
  status: LocationStatus;
  error: string | null;
  refresh: () => Promise<void>;
};

// Distance threshold (meters) before emitting a new position. Tuned to balance
// freshness (feed re-ranks when the user actually moves) against battery drain
// and excessive RPC calls.
const WATCH_DISTANCE_INTERVAL_M = 50;
// Minimum time between updates regardless of movement.
const WATCH_TIME_INTERVAL_MS = 10_000;

// Reactive hook used by HomeScreen. Asks for permission on mount, then keeps
// the coords fresh via expo-location's watcher — every WATCH_DISTANCE_INTERVAL_M
// meters or WATCH_TIME_INTERVAL_MS milliseconds, whichever fires first.
// `denied` and `error` are not fatal — the caller falls back to a flat feed
// without distances (or to the profile location via the get_feed RPC).
export function useUserLocation(): UserLocation {
  const [coords, setCoords] = useState<Coords | null>(null);
  const [status, setStatus] = useState<LocationStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const watcherRef = useRef<Location.LocationSubscription | null>(null);

  async function startWatching() {
    watcherRef.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        distanceInterval: WATCH_DISTANCE_INTERVAL_M,
        timeInterval: WATCH_TIME_INTERVAL_MS,
      },
      (position) => {
        setCoords({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
    );
  }

  function stopWatching() {
    watcherRef.current?.remove();
    watcherRef.current = null;
  }

  const refresh = useCallback(async () => {
    setStatus('requesting');
    setError(null);
    stopWatching();
    try {
      const { status: permission } = await Location.requestForegroundPermissionsAsync();
      if (permission !== 'granted') {
        setStatus('denied');
        setCoords(null);
        return;
      }
      // Seed with a one-shot fix so the feed renders immediately, then watch
      // for further movement.
      const initial = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setCoords({
        latitude: initial.coords.latitude,
        longitude: initial.coords.longitude,
      });
      setStatus('granted');
      await startWatching();
    } catch (err) {
      setStatus('error');
      setCoords(null);
      setError(err instanceof Error ? err.message : 'Location lookup failed');
    }
  }, []);

  useEffect(() => {
    refresh();
    return stopWatching;
  }, [refresh]);

  return { coords, status, error, refresh };
}

// Imperative one-shot helper for AddItemScreen / EditItemScreen.
// Called only when the user taps Save, so the permission prompt feels
// purposeful instead of greeting them when the screen opens.
// Returns null on denial or any error — caller decides how to handle it
// (e.g. allow the item to be saved without a location).
/**
 * One-shot position read.
 *
 * `accuracy` defaults to Balanced (~100m, Wi-Fi/network derived) which is right for
 * things like resolving a city name cheaply. It is **far too coarse for the QR
 * proximity check**, whose threshold is 50m — a 100m error budget compared against a
 * 50m limit means two phones touching each other can read anywhere from 0m to 150m
 * apart. Those callers pass Location.Accuracy.High (~10m) instead.
 *
 * Returns the reported `accuracy` radius alongside the coords so callers can tell a
 * genuine distance from a bad fix.
 */
export async function getCurrentLocationOnce(
  accuracy: Location.LocationAccuracy = Location.Accuracy.Balanced,
): Promise<Coords | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    const position = await Location.getCurrentPositionAsync({ accuracy });
    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
    };
  } catch {
    return null;
  }
}
