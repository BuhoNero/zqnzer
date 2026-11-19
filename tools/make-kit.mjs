// Synthesizes a basic drum kit as 16-bit mono WAVs → assets/samples/.
// Everything here is generated from math, so the output is free to use (CC0).
// Usage: node tools/make-kit.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SR = 44100;
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'samples');
fs.mkdirSync(out, { recursive: true });

// deterministic noise so rebuilds are identical
let seed = 1;
const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;

function render(sec, fn) {
  const n = Math.floor(sec * SR), d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = fn(i / SR, i);
  return d;
}
// one-pole filters
function hp(d, fc) { const a = 1 / (1 + 2 * Math.PI * fc / SR); let y = 0, px = 0;
  return d.map((x) => (y = a * (y + x - px), px = x, y)); }
function lp(d, fc) { const a = 1 - Math.exp(-2 * Math.PI * fc / SR); let y = 0;
  return d.map((x) => (y += a * (x - y))); }
const env = (t, decay) => Math.exp(-t / decay);
const sat = (x, k = 1.5) => Math.tanh(x * k) / Math.tanh(k);

function writeWav(name, d) {
  let peak = 0; for (const x of d) peak = Math.max(peak, Math.abs(x));
  const g = peak ? 0.9 / peak : 1;
  const b = Buffer.alloc(44 + d.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + d.length * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(d.length * 2, 40);
  d.forEach((x, i) => b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x * g)) * 32767), 44 + i * 2));
  fs.writeFileSync(path.join(out, name), b);
  return name;
}

const kit = {
  'kick.wav': () => { let ph = 0; return render(0.6, (t) => {
    ph += 2 * Math.PI * (45 + 110 * Math.exp(-t / 0.04)) / SR;
    return sat(Math.sin(ph) * env(t, 0.22) + noise() * env(t, 0.003) * 0.3, 2); }); },
  'kick-short.wav': () => { let ph = 0; return render(0.3, (t) => {
    ph += 2 * Math.PI * (55 + 160 * Math.exp(-t / 0.025)) / SR;
    return sat(Math.sin(ph) * env(t, 0.08), 3); }); },
  'snare.wav': () => { let ph = 0; const body = render(0.35, (t) => {
    ph += 2 * Math.PI * (180 + 60 * Math.exp(-t / 0.02)) / SR; return Math.sin(ph) * env(t, 0.06); });
    const nz = hp(render(0.35, (t) => noise() * env(t, 0.1)), 1500);
    return body.map((x, i) => sat(x * 0.7 + nz[i] * 0.8)); },
  'clap.wav': () => { const nz = hp(lp(render(0.4, () => noise()), 5000), 900);
    return nz.map((x, i) => { const t = i / SR;
      const bursts = [0, 0.011, 0.022].reduce((a, o) => a + (t >= o ? env(t - o, 0.006) : 0), 0);
      return x * (bursts + (t > 0.03 ? env(t - 0.03, 0.12) : 0)); }); },
  'rim.wav': () => render(0.12, (t) =>
    (Math.sin(2 * Math.PI * 820 * t) * 0.6 + Math.sin(2 * Math.PI * 1680 * t) * 0.4) * env(t, 0.012)),
  'hat-closed.wav': () => metal(0.12, 0.025),
  'hat-open.wav': () => metal(0.6, 0.22),
  'tom.wav': () => { let ph = 0; return render(0.5, (t) => {
    ph += 2 * Math.PI * (110 + 70 * Math.exp(-t / 0.05)) / SR; return Math.sin(ph) * env(t, 0.18); }); },
  'shaker.wav': () => hp(render(0.15, (t) => noise() * Math.sin(Math.PI * Math.min(1, t / 0.15)) ** 3), 4000),
  'cowbell.wav': () => lp(render(0.4, (t) =>
    (Math.sign(Math.sin(2 * Math.PI * 540 * t)) + Math.sign(Math.sin(2 * Math.PI * 800 * t))) * env(t, 0.09)), 3000),
  'bass-c.wav': () => { const s = lp(render(0.8, (t) => ((t * 65.41) % 1) * 2 - 1), 600);
    return s.map((x, i) => sat(x * env(i / SR, 0.35) * Math.min(1, i / 100), 2)); },
  'stab-chord.wav': () => lp(render(0.9, (t) => [261.6, 311.1, 392, 466.2]
    .reduce((a, f) => a + (((t * f) % 1) * 2 - 1), 0) * env(t, 0.25) * Math.min(1, t * 400)), 2500),
};

// 808-style metallic: six square oscillators, highpassed
function metal(sec, decay) {
  const fs6 = [205.3, 304.4, 369.6, 522.7, 540, 800];
  return hp(render(sec, (t) => fs6.reduce((a, f) => a + Math.sign(Math.sin(2 * Math.PI * f * 1.7 * t)), 0) / 6
    * env(t, decay) + noise() * env(t, decay) * 0.3), 7000);
}

// 2-pole state-variable lowpass with resonance; cutoff may change per sample (fc(i)).
function svf(d, fc, q = 0.7) { let lo = 0, bd = 0;
  return d.map((x, i) => { const f = 2 * Math.sin(Math.PI * Math.min(fc(i), SR / 6) / SR);
    lo += f * bd; const hi = x - lo - bd / q * 1; bd += f * hi; return lo; }); }
const C2 = 65.41;
const saw = (t, f) => ((t * f) % 1) * 2 - 1;

// Added later; generated after the original kit so the originals stay byte-identical.
const extra = {
  'snare-tight.wav': () => { let ph = 0; const body = render(0.18, (t) => {
    ph += 2 * Math.PI * (260 + 90 * Math.exp(-t / 0.01)) / SR; return Math.sin(ph) * env(t, 0.03); });
    const nz = hp(render(0.18, (t) => noise() * env(t, 0.045)), 3000);
    return body.map((x, i) => sat(x * 0.6 + nz[i], 2)); },
  'snare-fat.wav': () => { let ph = 0; const body = render(0.55, (t) => {
    ph += 2 * Math.PI * (150 + 80 * Math.exp(-t / 0.03)) / SR; return Math.sin(ph) * env(t, 0.1); });
    const nz = lp(hp(render(0.55, (t) => noise() * env(t, 0.2)), 700), 7000);
    return body.map((x, i) => sat(x + nz[i] * 0.9, 2.5)); },
  'snare-808.wav': () => { let a = 0, b = 0; const nz = hp(render(0.4, (t) => noise() * env(t, 0.13)), 2000);
    return nz.map((x, i) => { const t = i / SR; a += 2 * Math.PI * 238 / SR; b += 2 * Math.PI * 476 / SR;
      return (Math.sin(a) * env(t, 0.06) * 0.8 + Math.sin(b) * env(t, 0.03) * 0.4) + x * 0.7; }); },
  'snare-lofi.wav': () => { let ph = 0; const raw = render(0.3, (t) => {
    ph += 2 * Math.PI * (200 + 50 * Math.exp(-t / 0.02)) / SR;
    return Math.sin(ph) * env(t, 0.05) * 0.8 + noise() * env(t, 0.08); });
    let held = 0; // 8 kHz sample-and-hold + 5-bit crush
    return lp(raw.map((x, i) => (i % 5 === 0 ? (held = Math.round(x * 16) / 16) : held)), 6000); },
  'bass-sub.wav': () => { let ph = 0; return render(1.2, (t) => {
    ph += 2 * Math.PI * (C2 * (1 + 0.6 * Math.exp(-t / 0.015))) / SR;
    return sat(Math.sin(ph) * env(t, 0.6) * Math.min(1, t * 2000), 1.8); }); },
  'bass-square.wav': () => { const s = render(0.7, (t) => (((t * C2) % 1) < 0.35 ? 1 : -1) * env(t, 0.3) * Math.min(1, t * 1500));
    return lp(lp(s, 900), 1400); },
  'bass-acid.wav': () => svf(render(0.5, (t) => saw(t, C2) * Math.min(1, t * 1500) * (t < 0.42 ? 1 : env(t - 0.42, 0.015))),
    (i) => 180 + 2600 * Math.exp(-i / SR / 0.09), 6).map((x) => sat(x * 0.6, 2)),
  'bass-pluck.wav': () => svf(render(0.45, (t) => (saw(t, C2) + saw(t, C2 * 2) * 0.4) * env(t, 0.16) * Math.min(1, t * 2000)),
    (i) => 120 + 3500 * Math.exp(-i / SR / 0.04), 1.2),
  'bass-reese.wav': () => lp(render(1.0, (t) => (saw(t, C2 * 0.993) + saw(t, C2 * 1.007) + saw(t, C2 * 0.5) * 0.5)
    * Math.min(1, t * 300) * (t < 0.85 ? 1 : env(t - 0.85, 0.04))), 700).map((x) => sat(x * 0.8, 1.6)),
};

const written = [...Object.entries(kit), ...Object.entries(extra)].map(([n, f]) => writeWav(n, f()));
// list order: kicks, snares, the rest of the drums, then basses and synths
const rank = (n) => (/^kick/.test(n) ? 0 : /^snare/.test(n) ? 1 : /^bass/.test(n) ? 3 : /^stab/.test(n) ? 4 : 2);
const names = written.map((n, i) => [n, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([n]) => n);
fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify(names, null, 1));
console.log(`wrote ${names.length} samples to ${out}`);
