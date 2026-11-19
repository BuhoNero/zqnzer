// Zqnzer — 16-step, 4-track sample sequencer.
import { ctx, loadSample, play, createClock, setTempo, meters } from './audio.js';
import { STEPS, TRACKS, load, save, pattern, isEmpty, patName, clearRow, clearSteps } from './state.js';

const S = load();
const decoded = new Map(); // sample name -> AudioBuffer (all preloaded so switching is instant)
let sampleList = [];

const $ = (id) => document.getElementById(id);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const persist = () => save(S);
const row = (t) => pattern(S).steps[t]; // steps of track t in the current pattern
const snd = (t) => pattern(S).sounds[t]; // sound (sample + trim) of track t in the current pattern
const buf = (t) => decoded.get(snd(t).sample);

// Track identity colours (kick, snare, hats, bass by default). Pattern mode stays pink.
const COL = ['#ff6b45', '#ffb829', '#14b8a6', '#4f8dff'];
const PINK = '#ff1fc8';
const buzz = (ms) => { try { navigator.vibrate?.(ms); } catch {} };

// UI mode: 'steps' (edit) or 'pattern' (choose pattern; track buttons = banks A–D)
let mode = 'steps';
let viewBank = Math.floor(S.pat / STEPS);

// ---------- samples ----------
async function ensure(name) {
  if (!decoded.has(name)) decoded.set(name, await loadSample(name));
  return decoded.get(name);
}
async function setSample(t, name) {
  const sd = snd(t);
  Object.assign(sd, { sample: name, start: 0, end: 1 });
  await ensure(name);
  persist();
  render();
}

function trigger(t, when, step) {
  const tr = S.tracks[t], sd = snd(t);
  const st = step ?? { pitch: 0, fx: 0 };
  const len = play(buf(t), {
    track: t, start: sd.start, end: sd.end,
    vol: tr.vol,
    pitch: st.pitch || 0,
    fx: clamp(tr.fx + st.fx, -1, 1),
  }, when);
  if (t === S.sel) playhead = { at: when || ctx.currentTime, len, t };
}

// ---------- clock ----------
const visualQueue = [];
const clock = createClock(() => S.bpm, (step, time) => {
  pattern(S).steps.forEach((r, t) => { const st = r[step]; if (st.on && !S.tracks[t].mute) trigger(t, time, st); });
  visualQueue.push({ step, time });
});

// Pattern copy: hold a pattern pad to pick it up, tap another pad to paste.
let copySrc = null;
const copySrcActive = () => copySrc !== null;
function startCopy(i) {
  copySrc = i;
  showHud(`Copy ${patName(i)} → tap a pad`);
  render();
}
function pasteTo(i) {
  const src = copySrc;
  copySrc = null;
  if (i !== src) {
    const replaced = !isEmpty(S.patterns[i]);
    S.patterns[i] = structuredClone(pattern(S, src)); // steps + sounds
    persist();
    showHud(`${patName(src)} → ${patName(i)} ${replaced ? 'replaced' : 'copied'}`);
    setTimeout(() => { if (!copySrcActive()) hud.classList.remove('show'); }, 1200);
    return choosePattern(i); // go to the copy
  }
  hud.classList.remove('show');
  render();
}

function choosePattern(i) {
  // immediate: playback keeps its position in the bar and continues with the new pattern
  pattern(S, i); // a new pattern inherits the current pattern's sounds
  S.pat = i;
  buzz(10);
  persist();
  render();
}

// ---------- gestures ----------
// Tap → onTap. Drag → XY control: x = reverb ← dry → delay, y = an axis (volume or pitch).
const hud = $('hud');
const fxText = (fx) => fx < -0.02 ? `Reverb ${Math.round(-fx * 100)}%` : fx > 0.02 ? `Delay ${Math.round(fx * 100)}%` : 'Dry';
const fmtSemis = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0') + ' st';
function showHud(text) { hud.textContent = text; hud.classList.add('show'); }

const VOL_AXIS = { key: 'vol', min: 0, max: 1, snap: 0, fmt: (v) => `Vol ${Math.round(v * 100)}%` };
// ~12px per semitone on a phone: full ±12 sweep takes a long drag, so small notes are easy.
const PITCH_AXIS = { key: 'pitch', min: -12, max: 12, snap: 1, span: 1.5, fmt: fmtSemis };

function xyGesture(el, { getTarget, onTap, onDragStart, onAudition, onLongPress, label, y: Y }) {
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch {}
    el.classList.add('down');
    const x0 = e.clientX, y0 = e.clientY;
    let dragging = false, longPressed = false, target, v0, f0;
    const lp = onLongPress && setTimeout(() => {
      if (onLongPress()) { longPressed = true; buzz(25); }
    }, 450);
    const move = (e) => {
      const dx = e.clientX - x0, dy = e.clientY - y0;
      if (Math.hypot(dx, dy) > 10) clearTimeout(lp);
      if (mode === 'pattern' || longPressed) return; // pattern mode: taps only
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
      clearTimeout(lp);
      el.classList.remove('down');
      if (!copySrcActive()) hud.classList.remove('show');
      if (dragging) persist(); else if (!longPressed) onTap();
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
  const scope = document.createElement('canvas');
  scope.className = 'scope';
  const name = document.createElement('span');
  name.className = 'tname';
  el.append(scope, name);
  slot.style.setProperty('--c', COL[t]);
  slot.append(el);
  $tracks.append(slot);
  xyGesture(el, {
    label: () => `Track ${t + 1}`,
    y: VOL_AXIS,
    getTarget: () => S.tracks[t],
    onDragStart: () => { S.sel = t; },
    onLongPress: () => {
      if (mode === 'pattern') return false;
      const tr = S.tracks[t];
      tr.mute = !tr.mute;
      showHud(`Track ${t + 1} ${tr.mute ? 'muted' : 'on'}`);
      setTimeout(() => hud.classList.remove('show'), 900);
      persist(); render();
      return true;
    },
    onTap: () => {
      buzz(8);
      if (mode === 'pattern') { viewBank = t; render(); return; }
      S.sel = t; persist(); render(); // select only, no audition
    },
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
    getTarget: () => row(S.sel)[s],
    onAudition: () => trigger(S.sel, 0, row(S.sel)[s]),
    onLongPress: () => {
      if (mode !== 'pattern') return false;
      startCopy(viewBank * STEPS + s);
      return true;
    },
    onDragStart: () => { row(S.sel)[s].on = true; },
    onTap: () => {
      if (mode === 'pattern') {
        const i = viewBank * STEPS + s;
        return copySrcActive() ? pasteTo(i) : choosePattern(i);
      }
      const st = row(S.sel)[s];
      st.on = !st.on;
      buzz(st.on ? 10 : 5);
      if (st.on && !clock.running) trigger(S.sel, 0, st);
      persist(); render();
    },
  });
  return el;
});

// sample picker
function cycleSample(dir) {
  const i = sampleList.indexOf(snd(S.sel).sample);
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
    li.classList.toggle('cur', name === snd(S.sel).sample);
    li.onclick = (e) => { e.stopPropagation(); setSample(S.sel, name).then(() => trigger(S.sel)); sheet.hidden = true; };
    ul.append(li);
  }
  sheet.hidden = false;
};
sheet.onclick = () => (sheet.hidden = true);

// transport
const $play = $('play');
$play.onclick = () => {
  if (clock.running) {
    clock.stop(); visualQueue.length = 0; curStep = -1;
  }
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
// clear: selected track's steps (steps mode) or the whole current pattern (pattern mode)
$('clear').onclick = () => {
  if (mode === 'pattern') clearSteps(S); else clearRow(S, S.sel); // sounds are kept
  persist(); render();
};
$('patbtn').onclick = () => {
  mode = mode === 'pattern' ? 'steps' : 'pattern';
  if (copySrc !== null) { copySrc = null; hud.classList.remove('show'); }
  viewBank = Math.floor(S.pat / STEPS);
  buzz(12);
  render();
  ripple();
};
// pads cascade in from the top-left when the grid changes meaning
function ripple() {
  padEls.forEach((el, s) => el.animate(
    [{ transform: 'scale(.82)', opacity: 0.3 }, { transform: 'scale(1)', opacity: 1 }],
    { duration: 220, delay: ((s % 4) + Math.floor(s / 4)) * 22, easing: 'cubic-bezier(.2,.9,.3,1.3)', fill: 'backwards' }));
}

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
  const tr = snd(S.sel), b = buf(S.sel);

  g.fillStyle = '#021a2b';
  g.beginPath(); g.roundRect(0, 0, W, wh, r); g.fill();

  const x0 = tr.start * W, x1 = tr.end * W;
  g.save();
  g.beginPath(); g.roundRect(0, 0, W, wh, r); g.clip();
  g.fillStyle = COL[S.sel] + '8c';
  g.fillRect(x0, 0, x1 - x0, wh);
  if (b) {
    const p = peaks(b), pad = W * 0.04, bw = (W - pad * 2) / BARS;
    for (let i = 0; i < BARS; i++) {
      const x = pad + i * bw + bw / 2, inside = x >= x0 && x <= x1;
      const bh = Math.max(3 * dpr, p[i] * wh * 0.75);
      g.fillStyle = inside ? '#fff' : '#ffffff4d';
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
  const tr = snd(S.sel);
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
  const pm = mode === 'pattern';
  document.documentElement.dataset.mode = mode;
  const tab = pm ? viewBank : S.sel;
  $tracks.dataset.sel = $pads.dataset.sel = tab;
  trackEls.forEach((el, t) => {
    el.parentElement.classList.toggle('sel', t === tab);
    el.dataset.label = 'ABCD'[t];
    el.classList.toggle('has-cur', pm && Math.floor(S.pat / STEPS) === t);
    el.classList.toggle('muted', !!S.tracks[t].mute);
    el.lastChild.textContent = snd(t).sample.replace(/\.wav$/, '');
    setSquare(el, S.tracks[t].vol, S.tracks[t].fx);
  });
  const r = row(S.sel);
  $pads.style.setProperty('--c', COL[S.sel]);
  $pads.classList.toggle('muted', !pm && !!S.tracks[S.sel].mute);
  padEls.forEach((el, s) => {
    if (pm) {
      const i = viewBank * STEPS + s;
      el.className = 'btn pad' + (i === S.pat ? ' cur' : '')
        + (isEmpty(S.patterns[i]) ? '' : ' filled') + (i === copySrc ? ' src' : '');
      el.dataset.label = patName(i);
      // which tracks this pattern uses → coloured segments of the mini bar
      const ps = S.patterns[i];
      COL.forEach((c, t) => el.style.setProperty(`--u${t}`,
        ps && ps.steps[t].some((st) => st.on) ? c : 'transparent'));
      return;
    }
    const st = r[s];
    el.className = 'btn pad' + (st.on ? ' on' : '') + (s === curStep ? ' now' : '');
    setSquare(el, ((st.pitch || 0) + 12) / 24, st.fx);
    el.dataset.label = st.pitch ? fmtSemis(st.pitch).replace(' st', '') : '';
  });
  const pb = $('patbtn');
  pb.textContent = patName(S.pat);
  pb.classList.toggle('active', pm);
  $('sname').textContent = snd(S.sel).sample.replace(/\.wav$/, '');
  $('bpm').innerHTML = `<b>${S.bpm}</b><small>BPM</small>`;
  $play.textContent = clock.running ? '■︎' : '▶︎'; // text glyphs, not emoji
  $play.classList.toggle('on', clock.running);
  drawWave();
}

function frame() {
  while (visualQueue.length && visualQueue[0].time <= ctx.currentTime) {
    const v = visualQueue.shift();
    curStep = v.step;
    if (mode === 'steps') padEls.forEach((el, s) => el.classList.toggle('now', s === curStep));
    hits(v.step);
  }
  drawWave();
  drawScopes();
  requestAnimationFrame(frame);
}

// one-shot flashes: track buttons glow on their hits, the playing pad pops, play pulses on beats
function hits(step) {
  const steps = pattern(S).steps;
  trackEls.forEach((el, t) => {
    if (!steps[t][step].on || S.tracks[t].mute) return;
    const c = mode === 'pattern' ? PINK : COL[t];
    el.animate([{ boxShadow: `0 0 0 3px ${c}, 0 0 14px ${c}` }, { boxShadow: `0 0 0 0 ${c}00, 0 0 0 ${c}00` }],
      { duration: 260, easing: 'ease-out' });
    if (mode === 'steps' && t === S.sel)
      padEls[step].animate([{ transform: 'scale(1.07)' }, { transform: 'scale(1)' }], { duration: 160, easing: 'ease-out' });
  });
  if (step % 4 === 0)
    $play.animate([{ transform: `scale(${step ? 1.05 : 1.1})` }, { transform: 'scale(1)' }], { duration: 180, easing: 'ease-out' });
}

// ---------- per-track mini scopes ----------
const scopeData = new Float32Array(1024);
const scopeIdle = [];
let scopeMode = '';
function drawScopes() {
  if (scopeMode !== mode) { scopeMode = mode; scopeIdle.length = 0; } // recolour on mode change
  const pm = mode === 'pattern';
  trackEls.forEach((el, t) => {
    const c = el.firstChild, g2 = c.getContext('2d');
    const dpr = devicePixelRatio, W = c.clientWidth * dpr, H = c.clientHeight * dpr;
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; scopeIdle[t] = false; }
    meters[t].getFloatTimeDomainData(scopeData);
    let peak = 0;
    for (let i = 0; i < scopeData.length; i += 4) peak = Math.max(peak, Math.abs(scopeData[i]));
    const silent = peak < 0.002;
    if (silent && scopeIdle[t]) return; // already drawn flat
    scopeIdle[t] = silent;

    g2.clearRect(0, 0, W, H);
    g2.lineWidth = 2 * dpr;
    g2.lineJoin = 'round';
    g2.strokeStyle = silent ? '#ffffff40' : pm ? '#ff7ae0' : COL[t];
    g2.beginPath();
    const n = 96, stride = scopeData.length / n, mid = H / 2;
    for (let i = 0; i < n; i++) {
      const v = clamp(scopeData[Math.floor(i * stride)] * 1.6, -1, 1);
      const x = (i / (n - 1)) * W, y = mid - v * (H / 2 - g2.lineWidth);
      i ? g2.lineTo(x, y) : g2.moveTo(x, y);
    }
    g2.stroke();
  });
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
fetch('assets/samples/index.json').then((r) => r.json()).then((l) => {
  sampleList = l;
  const used = S.patterns.flatMap((p) => p?.sounds.map((x) => x.sample) ?? []);
  return Promise.all([...new Set([...l, ...used])].map(ensure));
}).then(render);
requestAnimationFrame(frame);
