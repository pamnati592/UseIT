// Thin wrapper around Google Places Autocomplete + Geocoding REST APIs.
// We use the REST endpoints (not the native SDK) so the picker works in Expo Go
// without an EAS dev build.

const API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

export type PlaceSuggestion = {
  placeId: string;
  description: string;       // "Tel Aviv-Yafo, Israel"
  primaryText: string;       // "Tel Aviv-Yafo"
  secondaryText: string;     // "Israel"
};

export type ResolvedPlace = {
  city: string;              // human-readable city name
  lat: number;
  lng: number;
};

// Minimal shapes for the two Google REST APIs used here — see
// https://developers.google.com/maps/documentation/places/web-service/autocomplete
// and https://developers.google.com/maps/documentation/geocoding/requests-geocoding
type GooglePrediction = {
  place_id: string;
  description: string;
  structured_formatting?: { main_text?: string; secondary_text?: string };
};

type GoogleAddressComponent = {
  long_name: string;
  short_name: string;
  types: string[];
};

// Autocomplete for city-type results. Empty input returns [].
// Uses a session token so Google bills suggestions + final details as one
// transaction (recommended for billing optimization).
export async function autocompleteCities(
  input: string,
  sessionToken: string,
): Promise<PlaceSuggestion[]> {
  if (!input.trim() || !API_KEY) return [];

  const url =
    `https://maps.googleapis.com/maps/api/place/autocomplete/json?` +
    `input=${encodeURIComponent(input)}` +
    `&types=(cities)` +
    `&language=en` +
    `&sessiontoken=${sessionToken}` +
    `&key=${API_KEY}`;

  const res = await fetch(url);
  const json = await res.json();
  if (json.status !== 'OK' && json.status !== 'ZERO_RESULTS') {
    throw new Error(json.error_message || json.status);
  }
  return ((json.predictions ?? []) as GooglePrediction[]).map(p => ({
    placeId: p.place_id,
    description: p.description,
    primaryText: p.structured_formatting?.main_text ?? p.description,
    secondaryText: p.structured_formatting?.secondary_text ?? '',
  }));
}

// Resolves a place_id into a city name + coordinates.
// Must be called with the same session token used for the autocomplete query
// that surfaced this place_id.
export async function getPlaceDetails(
  placeId: string,
  sessionToken: string,
): Promise<ResolvedPlace> {
  if (!API_KEY) throw new Error('Maps API key missing');

  const url =
    `https://maps.googleapis.com/maps/api/place/details/json?` +
    `place_id=${placeId}` +
    `&fields=name,geometry/location` +
    `&language=en` +
    `&sessiontoken=${sessionToken}` +
    `&key=${API_KEY}`;

  const res = await fetch(url);
  const json = await res.json();
  if (json.status !== 'OK') throw new Error(json.error_message || json.status);

  const loc = json.result.geometry.location;
  return { city: json.result.name, lat: loc.lat, lng: loc.lng };
}

// Reverse geocodes raw GPS coords into a city name.
// Picks the most specific "locality" component (city/town), falling back to
// administrative areas if the GPS landed outside a populated locality.
export async function reverseGeocodeToCity(
  lat: number,
  lng: number,
): Promise<ResolvedPlace> {
  if (!API_KEY) throw new Error('Maps API key missing');

  const url =
    `https://maps.googleapis.com/maps/api/geocode/json?` +
    `latlng=${lat},${lng}` +
    `&result_type=locality|administrative_area_level_2|administrative_area_level_1` +
    `&language=en` +
    `&key=${API_KEY}`;

  const res = await fetch(url);
  const json = await res.json();
  if (json.status !== 'OK') throw new Error(json.error_message || json.status);

  const result = json.results[0];
  const addressComponents = result.address_components as GoogleAddressComponent[];
  const cityComponent =
    addressComponents.find(c => c.types.includes('locality')) ??
    addressComponents.find(c => c.types.includes('administrative_area_level_2')) ??
    addressComponents.find(c => c.types.includes('administrative_area_level_1'));

  return {
    city: cityComponent?.long_name ?? result.formatted_address,
    lat,
    lng,
  };
}

// Tiny random session-token generator — Google accepts any unique string.
export function newSessionToken(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
