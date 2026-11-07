// Progress lives in localStorage. Everything is wrapped so the game still
// works in private windows or when storage is blocked.
const KEY = 'pps-save-v1';

const DEFAULTS = {
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
};

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, paint: {}, best: {}, ...JSON.parse(raw) };
  } catch (e) { /* ignore */ }
  return { ...DEFAULTS, unlocked: [...DEFAULTS.unlocked], best: {}, paint: {} };
}

export function writeSave(save) {
  try { localStorage.setItem(KEY, JSON.stringify(save)); } catch (e) { /* ignore */ }
}
