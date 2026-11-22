/**
 * ZIP and distance helpers, ported from the Warrior Wayfinder™ app (lib/geo.ts).
 * All of this runs in the browser — no network, no API key.
 */
import {
  ZIP_ALPHABET,
  ZIP_DATA,
  ZIP_RECORD_LENGTH,
  ZIP_STATE_CODES,
} from '../data/zip-centroids.js';

const RECORDS = Math.floor(ZIP_DATA.length / ZIP_RECORD_LENGTH);

function dec3(at) {
  return (
    ZIP_ALPHABET.indexOf(ZIP_DATA[at]) * 4096 +
    ZIP_ALPHABET.indexOf(ZIP_DATA[at + 1]) * 64 +
    ZIP_ALPHABET.indexOf(ZIP_DATA[at + 2])
  );
}

function zipAt(i) {
  return dec3(i * ZIP_RECORD_LENGTH);
}

function pointAt(i, exact) {
  const at = i * ZIP_RECORD_LENGTH;
  return {
    latitude: (dec3(at + 3) - 9000) / 100,
    longitude: (dec3(at + 6) - 18000) / 100,
    stateCode: ZIP_STATE_CODES[ZIP_ALPHABET.indexOf(ZIP_DATA[at + 9])] ?? '',
    exact,
    zip: String(zipAt(i)).padStart(5, '0'),
  };
}

export function isValidZip(value) {
  return /^\d{5}$/.test(value) && value !== '00000';
}

export function cleanZipInput(value) {
  return value.replace(/\D/g, '').slice(0, 5);
}

export function zipPoint(zip) {
  if (!/^\d{5}$/.test(zip)) return null;
  const target = Number(zip);
  let lo = 0;
  let hi = RECORDS - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const z = zipAt(mid);
    if (z === target) return pointAt(mid, true);
    if (z < target) lo = mid + 1;
    else hi = mid - 1;
  }
  const prefix = Math.floor(target / 100);
  const candidates = [hi, lo].filter(
    (i) => i >= 0 && i < RECORDS && Math.floor(zipAt(i) / 100) === prefix
  );
  if (candidates.length === 0) return null;
  const nearest = candidates.reduce((a, b) =>
    Math.abs(zipAt(a) - target) <= Math.abs(zipAt(b) - target) ? a : b
  );
  return pointAt(nearest, false);
}

export function distanceMiles(a, b) {
  const R = 3958.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isLatLng(lat, lng) {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
}

/** Closest Census ZIP area to a map point. Used instead of an online geocoder. */
export function nearestZipFromCoords(latitude, longitude) {
  if (!isLatLng(latitude, longitude)) return null;
  const cos = Math.cos((latitude * Math.PI) / 180);
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < RECORDS; i++) {
    const at = i * ZIP_RECORD_LENGTH;
    const lat = (dec3(at + 3) - 9000) / 100;
    const lng = (dec3(at + 6) - 18000) / 100;
    const dLat = lat - latitude;
    const dLng = (lng - longitude) * cos;
    const d = dLat * dLat + dLng * dLng;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  const point = pointAt(best, true);
  point.miles = Math.sqrt(bestD) * 69; // approx degrees to miles
  return point;
}

export function milesText(miles) {
  if (miles == null || !Number.isFinite(miles)) return null;
  if (miles < 1) return 'Under 1 mi away';
  return `${Math.round(miles)} mi away`;
}
