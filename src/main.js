// Zqnzer — skeleton: 4 tracks, 16 steps, sample playback.
// This is the pipeline smoke test (audio unlock on phone + deploy), not the real sequencer yet.

const STEPS = 16;
const TRACKS = 4;
const DEFAULT_SAMPLES = ['kick.wav', 'snare.wav', 'hat-closed.wav', 'bass-c.wav'];

const ctx = new AudioContext();
const buffers = [];
const state = {
  sel: 0,
  playing: false,
  bpm: 96,
  steps: Array.from({ length: TRACKS }, () => Array(STEPS).fill(false)),
};

async function loadSample(name) {
  const res = await fetch(`assets/samples/${name}`);
  return ctx.decodeAudioData(await res.arrayBuffer());
}

function trigger(t, when = 0) {
  const b = buffers[t];
  if (!b) return;
  const src = ctx.createBufferSource();
  src.buffer = b;
  src.connect(ctx.destination);
  src.start(when);
}

// --- UI ---
const $tracks = document.getElementById('tracks');
const $pads = document.getElementById('pads');

const trackEls = Array.from({ length: TRACKS }, (_, t) => {
  const el = document.createElement('button');
  el.className = 'btn track';
  el.onpointerdown = () => { state.sel = t; trigger(t); render(); };
  $tracks.append(el);
  return el;
});

const padEls = Array.from({ length: STEPS }, (_, s) => {
  const el = document.createElement('button');
  el.className = 'btn pad';
  el.onpointerdown = () => { const row = state.steps[state.sel]; row[s] = !row[s]; render(); };
  $pads.append(el);
  return el;
});

function render(cur = -1) {
  trackEls.forEach((el, t) => el.classList.toggle('sel', t === state.sel));
  padEls.forEach((el, s) => {
    el.classList.toggle('on', state.steps[state.sel][s]);
    el.classList.toggle('now', s === cur);
  });
  drawWave();
}

function drawWave() {
  const c = document.querySelector('#wave canvas');
  const w = (c.width = c.clientWidth * devicePixelRatio);
  const h = (c.height = c.clientHeight * devicePixelRatio);
  const g = c.getContext('2d');
  const b = buffers[state.sel];
  if (!b) return;
  const data = b.getChannelData(0);
  const bars = 64, step = Math.floor(data.length / bars), bw = w / bars;
  g.fillStyle = '#fff';
  for (let i = 0; i < bars; i++) {
    let m = 0;
    for (let j = i * step; j < (i + 1) * step; j += 16) m = Math.max(m, Math.abs(data[j]));
    const bh = Math.max(2, m * h * 0.8);
    g.fillRect(i * bw + bw * 0.3, (h - bh) / 2, bw * 0.4, bh);
  }
}

// --- Scheduler (lookahead) ---
let step = 0, nextTime = 0;
function tick() {
  if (!state.playing) return;
  const dur = 60 / state.bpm / 4;
  while (nextTime < ctx.currentTime + 0.1) {
    for (let t = 0; t < TRACKS; t++) if (state.steps[t][step]) trigger(t, nextTime);
    const s = step, at = nextTime;
    setTimeout(() => render(s), Math.max(0, (at - ctx.currentTime) * 1000));
    step = (step + 1) % STEPS;
    nextTime += dur;
  }
  setTimeout(tick, 25);
}

document.getElementById('play').onclick = (e) => {
  state.playing = !state.playing;
  e.target.textContent = state.playing ? '■' : '▶';
  if (state.playing) { step = 0; nextTime = ctx.currentTime + 0.05; tick(); } else render();
};

// iOS/Android need a user gesture before audio can start.
const $unlock = document.getElementById('unlock');
$unlock.onpointerdown = async () => { await ctx.resume(); $unlock.classList.add('hide'); };

document.getElementById('build').textContent = document.lastModified;

Promise.all(DEFAULT_SAMPLES.map(loadSample)).then((bs) => { buffers.push(...bs); render(); });
render();
