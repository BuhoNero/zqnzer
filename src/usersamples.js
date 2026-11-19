// User samples (recorded or imported): kept short, stored as mono 16-bit WAV in IndexedDB.
// A user sample is referenced from patterns as "user:<id>"; its display name lives with it.

export const MAX_SEC = 4;
export const isUser = (name) => name.startsWith('user:');

const lib = new Map(); // "user:<id>" -> { name, wav: ArrayBuffer }
export const userSamples = () => [...lib.keys()];
export const userWav = (key) => lib.get(key)?.wav;
export const userName = (key) => lib.get(key)?.name ?? 'missing sample';

// ---------- IndexedDB ----------
let dbp;
function db() {
  dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open('zqnzer', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('samples', { keyPath: 'key' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction('samples', mode), out = fn(t.objectStore('samples'));
    t.oncomplete = () => res(out?.result);
    t.onerror = () => rej(t.error);
  });
}

/** Load the whole library into memory (it's small: a few hundred KB per sample). */
export async function loadLibrary() {
  try {
    const all = await tx('readonly', (s) => s.getAll());
    for (const r of all ?? []) lib.set(r.key, { name: r.name, wav: r.wav });
  } catch (e) { console.warn('user samples unavailable', e); }
}

async function put(key, name, wav) {
  lib.set(key, { name, wav });
  try { await tx('readwrite', (s) => s.put({ key, name, wav })); }
  catch (e) { console.warn('could not store sample', e); }
}

/** Store prepared audio as a new user sample; returns its key. */
export async function addSample(name, samples, sampleRate) {
  const key = `user:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await put(key, name, encodeWav(samples, sampleRate));
  return key;
}

// ---------- processing ----------
/**
 * Mono mix, skip leading silence, cap at MAX_SEC, fade the tail, normalize.
 * Returns null if there's nothing audible.
 */
export function prepare(buf) {
  const n = buf.length, ch = buf.numberOfChannels, sr = buf.sampleRate;
  const mono = new Float32Array(n);
  for (let c = 0; c < ch; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) mono[i] += d[i] / ch;
  }
  let peak = 0;
  for (const x of mono) peak = Math.max(peak, Math.abs(x));
  if (peak < 0.003) return null;
  // start just before the first sound above 6% of the peak
  let s = mono.findIndex((x) => Math.abs(x) > peak * 0.06);
  s = Math.max(0, s - Math.floor(sr * 0.005));
  // cut trailing near-silence too
  let e = n;
  while (e > s && Math.abs(mono[e - 1]) < peak * 0.01) e--;
  e = Math.min(e, s + Math.floor(MAX_SEC * sr));
  const out = mono.slice(s, e);
  const g = 0.9 / peak, fade = Math.min(out.length, Math.floor(sr * 0.01));
  for (let i = 0; i < out.length; i++) out[i] *= g;
  for (let i = 0; i < fade; i++) out[out.length - 1 - i] *= i / fade;
  return out;
}

export function encodeWav(d, sr) {
  const b = new ArrayBuffer(44 + d.length * 2), v = new DataView(b);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + d.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, d.length * 2, true);
  for (let i = 0; i < d.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, d[i])) * 32767, true);
  return b;
}

// ---------- project files ----------
const toB64 = (ab) => {
  const u = new Uint8Array(ab); let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)).buffer;

/** The user samples a song uses, ready to embed in a project file. */
export function embed(song) {
  const used = new Set(song.patterns.flatMap((p) => p?.sounds.map((x) => x.sample) ?? []).filter(isUser));
  return Object.fromEntries([...used].filter((k) => lib.has(k))
    .map((k) => [k, { name: lib.get(k).name, wav: toB64(lib.get(k).wav) }]));
}
/** Store the samples embedded in an imported project file. */
export async function unembed(map) {
  for (const [k, v] of Object.entries(map ?? {})) {
    if (isUser(k) && typeof v?.wav === 'string') await put(k, String(v.name ?? 'sample'), fromB64(v.wav));
  }
}
