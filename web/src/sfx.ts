/** Every sound in Long Con is synthesized here with WebAudio: no audio files. */
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let musicBus: GainNode | null = null;
let musicTimer = 0;
const MUTE_KEY = 'longcon.mute';
export let muted = localStorage.getItem(MUTE_KEY) === '1';

function ac(): AudioContext | null {
  if (muted) return null;
  if (!ctx) {
    // Browsers refuse audio before a real gesture; creating a context earlier only floods the console.
    if (!(navigator as any).userActivation?.hasBeenActive) return null;
    const C = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!C) return null;
    ctx = new C();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(freq: number, dur: number, type: OscillatorType, vol: number, at = 0, slideTo?: number, bus?: GainNode | null) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + at;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(bus ?? master!);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur: number, vol: number, freq: number, at = 0) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + at;
  const buf = a.createBuffer(1, Math.ceil(a.sampleRate * dur), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = 1.2;
  const g = a.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(master!);
  src.start(t);
}

let stepAlt = false;
export const sfx = {
  step() { stepAlt = !stepAlt; noise(0.06, 0.35, stepAlt ? 900 : 700); },
  /** One syllable of a merchant's voice. Each merchant speaks at its own pitch. */
  blip(pitch: number) { tone(pitch * (0.92 + Math.random() * 0.16), 0.05, 'square', 0.05); },
  talkOpen() { tone(392, 0.08, 'triangle', 0.12); tone(523, 0.12, 'triangle', 0.12, 0.07); },
  talkClose() { tone(523, 0.08, 'triangle', 0.1); tone(392, 0.12, 'triangle', 0.1, 0.07); },
  coin(at = 0) { tone(988, 0.07, 'square', 0.06, at); tone(1319, 0.22, 'square', 0.06, at + 0.07); },
  coins(n: number) { for (let i = 0; i < Math.min(n, 10); i++) sfx.coin(i * 0.09); },
  /** The wax seal hitting the counter. */
  seal() { tone(110, 0.35, 'sine', 0.5, 0, 48); noise(0.12, 0.6, 300); },
  refused() { sfx.seal(); tone(311, 0.18, 'square', 0.06, 0.25); tone(233, 0.32, 'square', 0.06, 0.42); },
  bell() { for (const [f, v] of [[660, 0.2], [1320, 0.08], [1980, 0.04]] as const) tone(f, 1.6, 'sine', v); },
  courier() { tone(1175, 0.06, 'triangle', 0.05); tone(1568, 0.1, 'triangle', 0.05, 0.08); },
  error() { tone(180, 0.2, 'square', 0.06, 0, 120); },
};

/** A quiet pentatonic lute loop; brighter by day, lower at night. */
const DAY = [392, 440, 523, 587, 659, 784];
const NIGHT = [330, 370, 440, 494, 554, 659];
let night = false;
export function setNight(n: boolean) { night = n; }
export function startMusic() {
  const a = ac();
  if (!a || musicTimer) return;
  musicBus = a.createGain();
  musicBus.gain.value = 0.35;
  musicBus.connect(master!);
  let beat = 0;
  const pattern = [0, 2, 4, 2, 5, 4, 2, 1, 0, 2, 3, 2, 4, 3, 1, -1];
  musicTimer = window.setInterval(() => {
    const scale = night ? NIGHT : DAY;
    const p = pattern[beat % pattern.length];
    if (p >= 0) tone(scale[p], 0.5, 'triangle', 0.05, 0, undefined, musicBus);
    if (beat % 8 === 0) tone(scale[0] / 2, 1.8, 'sine', 0.06, 0, undefined, musicBus);
    if (beat % 8 === 4) tone(scale[2] / 2, 1.8, 'sine', 0.04, 0, undefined, musicBus);
    beat++;
  }, 280);
}

export function toggleMute(): boolean {
  muted = !muted;
  localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  if (muted) {
    window.clearInterval(musicTimer);
    musicTimer = 0;
    void ctx?.suspend();
  } else {
    void ctx?.resume();
    startMusic();
  }
  return muted;
}
