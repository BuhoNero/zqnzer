// Audio engine: sample loading, voices with trim/volume/fx sends, global reverb + delay, scheduler.

export const ctx = new AudioContext();

const master = ctx.createDynamicsCompressor();
master.threshold.value = -10;
master.ratio.value = 4;
master.connect(ctx.destination);

const dryBus = ctx.createGain();
dryBus.connect(master);

// Reverb: convolver with a generated decaying-noise impulse response.
const reverb = ctx.createConvolver();
reverb.buffer = makeImpulse(2.2, 3);
const reverbIn = ctx.createGain();
const reverbOut = ctx.createGain();
reverbOut.gain.value = 0.8;
reverbIn.connect(reverb).connect(reverbOut).connect(master);

// Delay: tempo-synced dotted 8th, filtered feedback loop.
const delay = ctx.createDelay(2);
const delayFb = ctx.createGain();
const delayTone = ctx.createBiquadFilter();
delayTone.type = 'lowpass';
delayTone.frequency.value = 3500;
delayFb.gain.value = 0.42;
const delayIn = ctx.createGain();
const delayOut = ctx.createGain();
delayOut.gain.value = 0.7;
delayIn.connect(delay);
delay.connect(delayTone).connect(delayFb).connect(delay);
delay.connect(delayOut).connect(master);

export function setTempo(bpm) {
  delay.delayTime.setTargetAtTime((60 / bpm) * 0.75, ctx.currentTime, 0.05);
}

function makeImpulse(sec, decay) {
  const n = Math.floor(sec * ctx.sampleRate);
  const b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
  }
  return b;
}

const cache = new Map();
export function loadSample(name) {
  if (!cache.has(name)) {
    cache.set(name, fetch(`assets/samples/${name}`)
      .then((r) => r.arrayBuffer())
      .then((a) => ctx.decodeAudioData(a)));
  }
  return cache.get(name);
}

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// Per-track meter taps (post track volume). Analysers must be pulled by the graph,
// so they feed a silent gain into the destination.
const silent = ctx.createGain();
silent.gain.value = 0;
silent.connect(ctx.destination);
export const meters = Array.from({ length: 4 }, () => {
  const a = ctx.createAnalyser();
  a.fftSize = 1024;
  a.connect(silent);
  return a;
});

// Choke: each track cuts its previous voice, like a hardware groove box.
const lastVoice = [];

/**
 * Play a buffer.
 * @param {AudioBuffer} buf
 * @param {{track:number, start:number, end:number, vol:number, fx:number, pitch?:number}} p
 *   start/end in 0..1 of the buffer, vol 0..1, fx -1 (reverb) .. 0 (dry) .. +1 (delay),
 *   pitch in semitones (repitches like a sampler: higher = shorter)
 * @returns real playback length in seconds
 */
export function play(buf, p, when = 0) {
  if (!buf) return 0;
  when = Math.max(when, ctx.currentTime);
  const rate = Math.pow(2, (p.pitch || 0) / 12);
  const off = p.start * buf.duration;
  const bufLen = Math.max(0.005, (p.end - p.start) * buf.duration);
  const len = bufLen / rate; // wall-clock length

  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const amp = ctx.createGain();
  const v = p.vol * p.vol; // perceptual curve
  amp.gain.setValueAtTime(0, when);
  amp.gain.linearRampToValueAtTime(v, when + 0.002);
  amp.gain.setValueAtTime(v, when + Math.max(0.002, len - 0.006));
  amp.gain.linearRampToValueAtTime(0, when + len);
  src.connect(amp);
  if (meters[p.track]) amp.connect(meters[p.track]);

  const fx = clamp(p.fx, -1, 1);
  const dry = ctx.createGain();
  dry.gain.value = 1 - Math.abs(fx) * 0.6;
  amp.connect(dry).connect(dryBus);
  if (fx < 0) { const s = ctx.createGain(); s.gain.value = -fx; amp.connect(s).connect(reverbIn); }
  if (fx > 0) { const s = ctx.createGain(); s.gain.value = fx; amp.connect(s).connect(delayIn); }

  const prev = lastVoice[p.track];
  if (prev) {
    prev.gain.cancelScheduledValues(when);
    prev.gain.setTargetAtTime(0, when, 0.004);
  }
  lastVoice[p.track] = amp;

  src.start(when, off, bufLen); // duration is in buffer time
  src.stop(when + len + 0.01);
  return len;
}

/** Lookahead scheduler. onStep(step, time) is called ahead of time for every 16th. */
export function createClock(getBpm, onStep) {
  let running = false, step = 0, next = 0, timer = 0;
  function tick() {
    const dur = 60 / getBpm() / 4;
    while (next < ctx.currentTime + 0.12) {
      onStep(step, next);
      step = (step + 1) % 16;
      next += dur;
    }
    timer = setTimeout(tick, 25);
  }
  return {
    get running() { return running; },
    start() { if (running) return; running = true; step = 0; next = ctx.currentTime + 0.06; tick(); },
    stop() { running = false; clearTimeout(timer); },
  };
}
