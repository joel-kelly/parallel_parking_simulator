// Progress lives in localStorage. Everything is wrapped so the game still
// works in private windows or when storage is blocked.
const KEY = 'pps-save-v1';

const DEFAULTS = () => ({
  points: 0,
  totalEarned: 0,
  unlocked: ['bean'],
  vehicle: 'bean',
  difficulty: 'normal',
  best: {},          // `${vehicle}:${difficulty}` -> best score
  wins: 0,
  ega: true,
  muted: false,
  paint: {},         // vehicle id -> { color, accent }
  tutorialSeen: false,
  tutorialDone: false,
  career: {},        // level id -> stars (0-3)
  trophies: [],      // trophy ids
  beaten: [],        // AI profile ids (difficulty) beaten in a race
  shiftBest: 0,      // best Valet Shift score
  shiftBestRound: 0, // furthest customer served
  daily: {},         // 'YYYY-MM-DD' -> best score that day
  honks: 0,
  topSpeed: 0,       // km/h
  parks: 0,
});

export function loadSave() {
  const d = DEFAULTS();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      // Fill in anything a save from an older version is missing.
      for (const k of Object.keys(d)) if (s[k] === undefined || s[k] === null) s[k] = d[k];
      return s;
    }
  } catch (e) { /* ignore */ }
  return d;
}

export function writeSave(save) {
  try { localStorage.setItem(KEY, JSON.stringify(save)); } catch (e) { /* ignore */ }
}

// Today's date as a stable key (local time), for the Daily Dare.
export function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
