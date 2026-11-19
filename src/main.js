// Zqnzer — 16-step, 4-track sample sequencer.
import { ctx, loadSample, play, createClock, setTempo } from './audio.js';
import { STEPS, TRACKS, load, save, clearTrack } from './state.js';

const S = load();
const buffers = []; // per track
let sampleList = [];

const $ = (id) => document.getElementById(id);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const persist = () => save(S);

// ---------- samples ----------
async function setSample(t, name, resetTrim = true) {
  const tr = S.tracks[t];
  tr.sample = name;
  if (resetTrim) { tr.start = 0; tr.end = 1; }
  buffers[t] = await loadSample(name);
  persist();
  render();
}

function trigger(t, when, step) {
  const tr = S.tracks[t];
  const st = step ?? { pitch: 0, fx: 0 };
  const len = play(buffers[t], {
    track: t, start: tr.start, end: tr.end,
    vol: tr.vol,
    pitch: st.pitch || 0,
    fx: clamp(tr.fx + st.fx, -1, 1),
  }, when);
  if (t === S.sel) playhead = { at: when || ctx.currentTime, len, t };
}

// ---------- clock ----------
const visualQueue = [];
const clock = createClock(() => S.bpm, (step, time) => {
  S.tracks.forEach((tr, t) => { const st = tr.steps[step]; if (st.on) trigger(t, time, st); });
  visualQueue.push({ step, time });
});

// ---------- gestures ----------
// Tap → onTap. Drag → XY control: x = reverb ← dry → delay, y = an axis (volume or pitch).
const hud = $('hud');
const fxText = (fx) => fx < -0.02 ? `Reverb ${Math.round(-fx * 100)}%` : fx > 0.02 ? `Delay ${Math.round(fx * 100)}%` : 'Dry';
const fmtSemis = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0') + ' st';
function showHud(text) { hud.textContent = text; hud.classList.add('show'); }

const VOL_AXIS = { key: 'vol', min: 0, max: 1, snap: 0, fmt: (v) => `Vol ${Math.round(v * 100)}%` };
// ~12px per semitone on a phone: full ±12 sweep takes a long drag, so small notes are easy.
const PITCH_AXIS = { key: 'pitch', min: -12, max: 12, snap: 1, span: 1.5, fmt: fmtSemis };

function xyGesture(el, { getTarget, onTap, onDragStart, onAudition, label, y: Y }) {
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX, y0 = e.clientY;
    let dragging = false, target, v0, f0;
    const move = (e) => {
      const dx = e.clientX - x0, dy = e.clientY - y0;
      if (!dragging && Math.hypot(dx, dy) > 10) {
        dragging = true;
        onDragStart?.();
        target = getTarget();
        v0 = target[Y.key] ?? 0; f0 = target.fx;
      }
      if (!dragging) return;
      const range = Math.min(innerWidth, 400) * 0.5;
      let v = clamp(v0 - (dy / (range * (Y.span || 1))) * (Y.max - Y.min), Y.min, Y.max);
      if (Y.snap) v = Math.round(v / Y.snap) * Y.snap;
      const changed = v !== target[Y.key];
      target[Y.key] = v;
      let fx = clamp(f0 + dx / range, -1, 1);
      if (Math.abs(fx) < 0.06) fx = 0; // detent at dry
      target.fx = fx;
      showHud(`${label()} · ${Y.fmt(v)} · ${fxText(fx)}`);
      if (changed && Y.snap && !clock.running) onAudition?.(); // hear each new note
      render();
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      hud.classList.remove('show');
      if (dragging) persist(); else onTap();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  });
}

// ---------- build UI ----------
const $tracks = $('tracks'), $pads = $('pads');

const trackEls = Array.from({ length: TRACKS }, (_, t) => {
  const slot = document.createElement('div');
  slot.className = 'slot';
  const el = document.createElement('button');
  el.className = 'btn track';
  slot.append(el);
  $tracks.append(slot);
  xyGesture(el, {
    label: () => `Track ${t + 1}`,
    y: VOL_AXIS,
    getTarget: () => S.tracks[t],
    onDragStart: () => { S.sel = t; },
    onTap: () => { S.sel = t; trigger(t); persist(); render(); },
  });
  return el;
});

const padEls = Array.from({ length: STEPS }, (_, s) => {
  const el = document.createElement('button');
  el.className = 'btn pad';
  $pads.append(el);
  xyGesture(el, {
    label: () => `Step ${s + 1}`,
    y: PITCH_AXIS,
    getTarget: () => S.tracks[S.sel].steps[s],
    onAudition: () => trigger(S.sel, 0, S.tracks[S.sel].steps[s]),
    onDragStart: () => { S.tracks[S.sel].steps[s].on = true; },
    onTap: () => {
      const st = S.tracks[S.sel].steps[s];
      st.on = !st.on;
      if (st.on && !clock.running) trigger(S.sel, 0, st);
      persist(); render();
    },
  });
  return el;
});

// sample picker
function cycleSample(dir) {
  const i = sampleList.indexOf(S.tracks[S.sel].sample);
  const name = sampleList[(i + dir + sampleList.length) % sampleList.length];
  setSample(S.sel, name).then(() => trigger(S.sel));
}
$('prev').onclick = () => cycleSample(-1);
$('next').onclick = () => cycleSample(1);
const sheet = $('sheet');
$('sname').onclick = () => {
  const ul = sheet.querySelector('ul');
  ul.innerHTML = '';
  for (const name of sampleList) {
    const li = document.createElement('li');
    li.textContent = name.replace(/\.wav$/, '');
    li.classList.toggle('cur', name === S.tracks[S.sel].sample);
    li.onclick = (e) => { e.stopPropagation(); setSample(S.sel, name).then(() => trigger(S.sel)); sheet.hidden = true; };
    ul.append(li);
  }
  sheet.hidden = false;
};
sheet.onclick = () => (sheet.hidden = true);

// transport
const $play = $('play');
$play.onclick = () => {
  if (clock.running) { clock.stop(); visualQueue.length = 0; curStep = -1; }
  else clock.start();
  render();
};
function setBpm(b) { S.bpm = clamp(Math.round(b), 50, 200); setTempo(S.bpm); persist(); render(); }
$('slower').onclick = () => setBpm(S.bpm - 1);
$('faster').onclick = () => setBpm(S.bpm + 1);
$('bpm').addEventListener('pointerdown', (e) => {
  const el = e.currentTarget, y0 = e.clientY, b0 = S.bpm;
  el.setPointerCapture(e.pointerId);
  const move = (e) => setBpm(b0 + (y0 - e.clientY) / 4);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', () => el.removeEventListener('pointermove', move), { once: true });
});
$('clear').onclick = () => { clearTrack(S.tracks[S.sel]); persist(); render(); };

// ---------- waveform + trim ----------
const canvas = document.querySelector('#wave canvas');
const g = canvas.getContext('2d');
const peaksCache = new WeakMap();
const BARS = 72;
const HANDLE_ZONE = 0.3; // bottom fraction of canvas for trim handles
let playhead = null;

function peaks(buf) {
  if (peaksCache.has(buf)) return peaksCache.get(buf);
  const d = buf.getChannelData(0), step = Math.floor(d.length / BARS), out = [];
  let max = 0;
  for (let i = 0; i < BARS; i++) {
    let m = 0;
    for (let j = i * step; j < (i + 1) * step; j += 8) m = Math.max(m, Math.abs(d[j]));
    out.push(m); max = Math.max(max, m);
  }
  const norm = out.map((m) => m / (max || 1));
  peaksCache.set(buf, norm);
  return norm;
}

function drawWave() {
  const dpr = devicePixelRatio;
  const W = canvas.clientWidth * dpr, H = canvas.clientHeight * dpr;
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  g.clearRect(0, 0, W, H);
  const wh = H * (1 - HANDLE_ZONE), r = 16 * dpr;
  const tr = S.tracks[S.sel], buf = buffers[S.sel];

  g.fillStyle = '#021a2b';
  g.beginPath(); g.roundRect(0, 0, W, wh, r); g.fill();

  const x0 = tr.start * W, x1 = tr.end * W;
  g.save();
  g.beginPath(); g.roundRect(0, 0, W, wh, r); g.clip();
  g.fillStyle = '#0b7268';
  g.fillRect(x0, 0, x1 - x0, wh);
  if (buf) {
    const p = peaks(buf), pad = W * 0.04, bw = (W - pad * 2) / BARS;
    for (let i = 0; i < BARS; i++) {
      const x = pad + i * bw + bw / 2, inside = x >= x0 && x <= x1;
      const bh = Math.max(3 * dpr, p[i] * wh * 0.75);
      g.fillStyle = inside ? '#8ff5e6' : '#fff';
      g.fillRect(x - bw * 0.18, (wh - bh) / 2, Math.max(1.5 * dpr, bw * 0.36), bh);
    }
    // playhead
    if (playhead && playhead.t === S.sel && playhead.len) {
      const k = (ctx.currentTime - playhead.at) / playhead.len;
      if (k >= 0 && k <= 1) {
        g.fillStyle = '#fff';
        g.fillRect(x0 + (x1 - x0) * k - dpr, 0, 2 * dpr, wh);
      }
    }
  }
  g.restore();

  // trim markers (per mockup: line + triangle pointing inward)
  const hz = H - wh, lw = 3 * dpr, tri = hz * 0.45;
  g.fillStyle = '#fff';
  g.fillRect(x0, 0, lw, H);
  g.fillRect(x1 - lw, 0, lw, H);
  g.fillStyle = '#d0d0d0';
  const ty = wh + hz / 2;
  g.beginPath(); g.moveTo(x0 + lw * 2, ty - tri / 2); g.lineTo(x0 + lw * 2 + tri * 0.8, ty); g.lineTo(x0 + lw * 2, ty + tri / 2); g.fill();
  g.beginPath(); g.moveTo(x1 - lw * 2, ty - tri / 2); g.lineTo(x1 - lw * 2 - tri * 0.8, ty); g.lineTo(x1 - lw * 2, ty + tri / 2); g.fill();
}

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  const tr = S.tracks[S.sel];
  const rect = canvas.getBoundingClientRect();
  const fx = (e) => clamp((e.clientX - rect.left) / rect.width, 0, 1);
  const x = fx(e);
  const which = Math.abs(x - tr.start) <= Math.abs(x - tr.end) ? 'start' : 'end';
  const move = (e) => {
    const v = fx(e);
    if (which === 'start') tr.start = Math.min(v, tr.end - 0.01);
    else tr.end = Math.max(v, tr.start + 0.01);
    render();
  };
  move(e);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', () => {
    canvas.removeEventListener('pointermove', move);
    persist();
    if (!clock.running) trigger(S.sel);
  }, { once: true });
});

// ---------- render ----------
let curStep = -1;
function setSquare(el, vol, fx) {
  el.style.setProperty('--x', (fx + 1) / 2);
  el.style.setProperty('--y', vol);
}

function render() {
  $tracks.dataset.sel = $pads.dataset.sel = S.sel;
  trackEls.forEach((el, t) => {
    el.parentElement.classList.toggle('sel', t === S.sel);
    setSquare(el, S.tracks[t].vol, S.tracks[t].fx);
  });
  const tr = S.tracks[S.sel];
  padEls.forEach((el, s) => {
    const st = tr.steps[s];
    el.classList.toggle('on', st.on);
    el.classList.toggle('now', s === curStep);
    setSquare(el, ((st.pitch || 0) + 12) / 24, st.fx);
    el.dataset.pitch = st.pitch ? fmtSemis(st.pitch).replace(' st', '') : '';
  });
  $('sname').textContent = tr.sample.replace(/\.wav$/, '');
  $('bpm').textContent = `${S.bpm} bpm`;
  $play.textContent = clock.running ? '■' : '▶';
  drawWave();
}

function frame() {
  while (visualQueue.length && visualQueue[0].time <= ctx.currentTime) {
    curStep = visualQueue.shift().step;
    padEls.forEach((el, s) => el.classList.toggle('now', s === curStep));
  }
  drawWave();
  requestAnimationFrame(frame);
}

// ---------- boot ----------
const $unlock = $('unlock');
$unlock.addEventListener('pointerdown', () => { ctx.resume(); $unlock.remove(); });
// iOS may suspend audio when backgrounded; resume on any touch.
addEventListener('pointerdown', () => { if (ctx.state !== 'running') ctx.resume(); }, { capture: true });
addEventListener('resize', render);
$('build').textContent = `build ${document.lastModified}`;

setTempo(S.bpm);
render();
fetch('assets/samples/index.json').then((r) => r.json()).then((l) => (sampleList = l));
Promise.all(S.tracks.map((tr, t) => setSample(t, tr.sample, false)));
requestAnimationFrame(frame);
