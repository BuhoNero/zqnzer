// Song state + localStorage persistence.
// Song = tempo + 64 patterns (4 banks × 16).
// A pattern = steps for the 4 tracks + the 4 sounds it uses (sample, trim, vol, fx, mute).

const KEY = 'zqnzer.v1';
export const STEPS = 16;
export const TRACKS = 4;
export const BANKS = 4;
export const PATTERNS = BANKS * STEPS;
const DEFAULT_SAMPLES = ['kick.wav', 'snare.wav', 'hat-closed.wav', 'bass-c.wav'];

const newStep = () => ({ on: false, pitch: 0, fx: 0 });
const newRow = () => Array.from({ length: STEPS }, newStep);
const newSteps = () => Array.from({ length: TRACKS }, newRow);
const newSound = (sample) => ({ sample, start: 0, end: 1, vol: 0.8, fx: 0, mute: false });
const defaultSounds = () => DEFAULT_SAMPLES.map(newSound);
const newTrack = () => ({}); // kept for file compatibility; settings live in patterns

function demo() {
  const s = {
    bpm: 96, sel: 0, pat: 0,
    tracks: DEFAULT_SAMPLES.map(newTrack),
    patterns: Array(PATTERNS).fill(null),
  };
  const p = (s.patterns[0] = { steps: newSteps(), sounds: defaultSounds() }).steps;
  const on = (t, ...idx) => idx.forEach((i) => (p[t][i].on = true));
  on(0, 0, 6, 10);
  on(1, 4, 12);
  on(2, 0, 2, 4, 6, 8, 10, 12, 14);
  on(3, 0, 3, 8, 11, 14);
  [0, 0, 0, 3, 0, 0, 0, 0, 7, 0, 0, 5, 0, 0, -2, 0].forEach((v, i) => (p[3][i].pitch = v));
  p[1][12].fx = -0.5;
  s.patterns[0].sounds[2].vol = 0.55;
  return s;
}

function migrate(s) {
  // v1: one pattern, steps lived on each track
  if (!s.patterns) {
    s.patterns = Array(PATTERNS).fill(null);
    s.patterns[0] = s.tracks.map((t) => t.steps ?? newRow());
    s.pat = 0;
  }
  // v2: patterns were bare step arrays and sounds lived on the tracks
  const sounds = s.tracks.map((t) => ({ ...newSound(t.sample ?? 'kick.wav'), vol: t.vol ?? 0.8, fx: t.fx ?? 0 }));
  s.tracks.forEach((t, i) => {
    if (t.start !== undefined) Object.assign(sounds[i], { start: t.start, end: t.end });
    delete t.steps; delete t.sample; delete t.start; delete t.end;
  });
  s.patterns = s.patterns.map((p) =>
    Array.isArray(p) ? { steps: p, sounds: structuredClone(sounds) } : p);
  // v3: vol/fx lived on the tracks (song-wide) → copy into every pattern's sounds
  s.patterns.forEach((p) => p?.sounds.forEach((sd, t) => {
    if (sd.vol === undefined) sd.vol = s.tracks[t].vol ?? 0.8;
    if (sd.fx === undefined) sd.fx = s.tracks[t].fx ?? 0;
    if (sd.mute === undefined) sd.mute = !!s.tracks[t].mute; // v4: mute was song-wide
  }));
  s.tracks.forEach((t) => { delete t.vol; delete t.fx; delete t.mute; });
  return s;
}

/** Project file: the whole song (tempo, mixer, all banks/patterns with their sounds). */
export function toFile(s) {
  return { app: 'zqnzer', format: 1, exported: new Date().toISOString(), song: s };
}
/** Parse a project file (or a bare song) into a current-format song; throws if it isn't one. */
export function fromFile(o) {
  const s = o && o.app === 'zqnzer' ? o.song : o;
  if (!s || !Array.isArray(s.tracks) || s.tracks.length !== TRACKS) throw new Error('Not a Zqnzer project');
  const song = migrate(structuredClone(s));
  if (!Array.isArray(song.patterns)) throw new Error('Not a Zqnzer project');
  song.patterns = Array.from({ length: PATTERNS }, (_, i) => song.patterns[i] ?? null);
  song.pat = Math.min(Math.max(0, song.pat | 0), PATTERNS - 1);
  song.sel = Math.min(Math.max(0, song.sel | 0), TRACKS - 1);
  song.bpm = Math.min(200, Math.max(50, +song.bpm || 120));
  return song;
}

export function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.tracks?.length === TRACKS) return migrate(s);
  } catch {}
  return demo();
}

let saveTimer = 0;
export function save(s) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
  }, 200);
}

/** Pattern i, created on first use with the sounds of the current pattern. */
export function pattern(s, i = s.pat) {
  if (!s.patterns[i]) {
    const from = i !== s.pat && s.patterns[s.pat];
    s.patterns[i] = { steps: newSteps(), sounds: from ? structuredClone(from.sounds) : defaultSounds() };
  }
  return s.patterns[i];
}
export const isEmpty = (p) => !p || p.steps.every((row) => row.every((st) => !st.on));
export const patName = (i) => 'ABCD'[Math.floor(i / STEPS)] + ((i % STEPS) + 1);
export function clearRow(s, t) { pattern(s).steps[t] = newRow(); }
export function clearSteps(s) { pattern(s).steps = newSteps(); }
