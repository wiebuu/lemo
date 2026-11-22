// Where the visitor probably is, from their device's time zone (and, failing that, the
// browser's language). Nothing is looked up or sent anywhere: it only decides which
// featured shelf comes first, so a singer in Tokyo sees Japanese songs before Hindi ones.

import { LANGUAGES } from './library'

/** Time zones whose country has its own language shelf ('india': Lemody's home order). */
const ZONES: Record<string, string> = {
  'Asia/Kolkata': 'india', 'Asia/Calcutta': 'india', 'Asia/Kathmandu': 'india',
  'Asia/Karachi': 'ur', 'Asia/Dhaka': 'bn',
  'Asia/Tokyo': 'ja',
  'Asia/Manila': 'tl', 'Asia/Ho_Chi_Minh': 'vi', 'Asia/Saigon': 'vi', 'Asia/Bangkok': 'th',
  'Asia/Kuala_Lumpur': 'ms', 'Asia/Kuching': 'ms',
  'Asia/Jakarta': 'id', 'Asia/Pontianak': 'id', 'Asia/Makassar': 'id', 'Asia/Jayapura': 'id',
  'Europe/Paris': 'fr', 'Europe/Monaco': 'fr',
  'Europe/Berlin': 'de', 'Europe/Vienna': 'de', 'Europe/Zurich': 'de', 'Europe/Busingen': 'de',
  'Europe/Rome': 'it', 'Europe/San_Marino': 'it', 'Europe/Vatican': 'it',
  'Europe/Madrid': 'es', 'Atlantic/Canary': 'es', 'America/Mexico_City': 'es', 'America/Bogota': 'es',
  'America/Lima': 'es', 'America/Santiago': 'es', 'America/Argentina/Buenos_Aires': 'es', 'America/Buenos_Aires': 'es',
  'America/Caracas': 'es', 'America/Guayaquil': 'es', 'America/Montevideo': 'es', 'America/La_Paz': 'es',
  'America/Monterrey': 'es', 'America/Tijuana': 'es', 'America/Cancun': 'es', 'America/Merida': 'es', 'America/Chihuahua': 'es',
  'America/Hermosillo': 'es', 'America/Mazatlan': 'es', 'America/Matamoros': 'es', 'America/Bahia_Banderas': 'es',
  'Asia/Seoul': 'ko',
  'America/Sao_Paulo': 'pt', 'Europe/Lisbon': 'pt', 'America/Fortaleza': 'pt', 'America/Recife': 'pt', 'America/Bahia': 'pt',
  'America/Belem': 'pt', 'America/Manaus': 'pt', 'America/Cuiaba': 'pt', 'America/Campo_Grande': 'pt', 'America/Maceio': 'pt',
  'Europe/Moscow': 'ru',
}
/** Languages spoken in India: the home order (garhwali, hindi, english) stays. (Urdu and Bengali
 * browsers get their own shelf: Pakistan and Bangladesh have their own songs.) */
const INDIAN = new Set(['hi', 'pa', 'hr', 'gw', 'ta', 'te', 'mr', 'gu', 'kn', 'ml', 'ne'])

/**
 * The visitor's own language for the featured shelves: 'india' (Lemody's home order),
 * a language code like 'ja', or null (English-speaking or unknown: English first).
 */
export function homeLanguage(zone: string | undefined, languages: readonly string[]): string | null {
  const z = zone ? ZONES[zone] : undefined
  if (z) return z
  const first = (languages[0] ?? '').toLowerCase().split('-')[0]
  if (!first || first === 'en') return null
  if (INDIAN.has(first)) return 'india'
  return first in LANGUAGES ? first : null
}

/** This visitor's home language (see homeLanguage). `lemo.home` in localStorage overrides it, for testing. */
export function visitorHome(): string | null {
  try {
    const o = localStorage.getItem('lemo.home')
    if (o) return o === 'none' ? null : o
  } catch {
    /* blocked */
  }
  let zone: string | undefined
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    zone = undefined
  }
  return homeLanguage(zone, typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language])
}

/**
 * The featured shelves, in the order this visitor should see them: India keeps garhwali,
 * hindi, english. Anyone else gets their own language first (when Lemody has songs in it),
 * then english, then the rest.
 */
export function shelfOrder(home: string | null): string[] {
  if (home === 'india') return ['garhwali', 'hindi', 'english']
  return [...(home ? ['local'] : []), 'english', 'hindi', 'garhwali']
}
