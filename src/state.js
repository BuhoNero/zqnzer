// Song state + localStorage persistence.

const KEY = 'zqnzer.v1';
export const STEPS = 16;
export const TRACKS = 4;
const DEFAULT_SAMPLES = ['kick.wav', 'snare.wav', 'hat-closed.wav', 'bass-c.wav'];

const newStep = () => ({ on: false, vol: 1, fx: 0 });
const newTrack = (sample) => ({
  sample, vol: 0.8, fx: 0, start: 0, end: 1,
  steps: Array.from({ length: STEPS }, newStep),
});

function demo() {
  const s = { bpm: 96, sel: 0, tracks: DEFAULT_SAMPLES.map(newTrack) };
  const on = (t, ...idx) => idx.forEach((i) => (s.tracks[t].steps[i].on = true));
  on(0, 0, 6, 10);
  on(1, 4, 12);
  on(2, 0, 2, 4, 6, 8, 10, 12, 14);
  on(3, 0, 3, 11);
  s.tracks[2].vol = 0.55;
  s.tracks[1].steps[12].fx = -0.5;
  return s;
}

export function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.tracks?.length === TRACKS) return s;
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

export function clearTrack(t) { t.steps = Array.from({ length: STEPS }, newStep); }
export function reset() { return demo(); }
