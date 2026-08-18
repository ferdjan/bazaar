'use strict';

// Formate une date SQLite (UTC, "YYYY-MM-DD HH:MM:SS") en heure locale
// d'Algérie (UTC+1, sans DST) selon la langue de l'interface. Retourne "—"
// pour une date vide/invalide afin de ne jamais afficher une valeur brute.
function formatDate(sqliteUtc, lang) {
  if (!sqliteUtc) return '—';
  const d = new Date(String(sqliteUtc).replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return String(sqliteUtc);
  try {
    return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-DZ' : 'fr-FR', {
      timeZone: 'Africa/Algiers',
      dateStyle: 'long',
      timeStyle: 'short',
    }).format(d);
  } catch (_) {
    return String(sqliteUtc);
  }
}

module.exports = { formatDate };
