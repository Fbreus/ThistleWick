let AC: AudioContext | null = null, master: GainNode | null = null;
export const audioState = { muted: false };
export function setMuted(m: boolean) { audioState.muted = m; if (master) master.gain.value = m ? 0 : 0.5; }
export function initAudio() {
  if (AC) return;
  try {
    AC = new (window.AudioContext || (window as any).webkitAudioContext)(); master = AC.createGain(); master.gain.value = audioState.muted ? 0 : 0.5; master.connect(AC.destination);
    const len = AC.sampleRate * 2, buf = AC.createBuffer(1, len, AC.sampleRate), d = buf.getChannelData(0); let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
    const src = AC.createBufferSource(); src.buffer = buf; src.loop = true; const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520;
    const gn = AC.createGain(); gn.gain.value = 0.22; src.connect(lp); lp.connect(gn); gn.connect(master); src.start();
  } catch (e) { AC = null; }
}
function tone(f0: number, f1: number, dur: number, type: OscillatorType, vol: number, delay?: number) {
  if (!AC) return; const t = AC.currentTime + (delay || 0), o = AC.createOscillator(), g = AC.createGain(); o.type = type; o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(g); g.connect(master!); o.start(t); o.stop(t + dur + 0.02);
}
function noiseBurst(dur: number, f: number, vol: number, q?: number) {
  if (!AC) return; const n = (AC.sampleRate * dur) | 0, b = AC.createBuffer(1, n, AC.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const s = AC.createBufferSource(); s.buffer = b; const bp = AC.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q || 0.8;
  const g = AC.createGain(); g.gain.value = vol; s.connect(bp); bp.connect(g); g.connect(master!); s.start();
}
export const sfx = {
  step() { noiseBurst(0.05, 2400 + Math.random() * 1500, 0.12); }, jump() { tone(300, 520, 0.12, 'sine', 0.1); },
  chop() { noiseBurst(0.12, 380, 0.5, 1.2); tone(140, 80, 0.1, 'triangle', 0.25); }, mine() { tone(1500, 900, 0.09, 'square', 0.07); noiseBurst(0.08, 3000, 0.25, 2); },
  swing() { noiseBurst(0.12, 1400, 0.1, 0.5); }, dig() { noiseBurst(0.1, 260, 0.55, 0.9); tone(110, 70, 0.08, 'triangle', 0.15); }, place() { tone(220, 160, 0.09, 'triangle', 0.25); noiseBurst(0.07, 600, 0.3); },
  pickup() { tone(700, 1000, 0.1, 'sine', 0.16); tone(1050, 1500, 0.12, 'sine', 0.13, 0.06); }, craft() { [520, 700, 880].forEach((f, i) => tone(f, f, 0.14, 'triangle', 0.16, i * 0.07)); },
  eat() { noiseBurst(0.09, 900, 0.3); noiseBurst(0.09, 700, 0.3); }, hurt() { tone(220, 70, 0.35, 'square', 0.2); noiseBurst(0.22, 500, 0.3); },
  clang() { tone(900, 600, 0.18, 'square', 0.1); tone(1350, 900, 0.2, 'sine', 0.12); }, bite() { noiseBurst(0.1, 1800, 0.4, 2); },
  squish() { tone(180, 60, 0.18, 'sawtooth', 0.12); noiseBurst(0.12, 500, 0.3); }, brk() { noiseBurst(0.25, 450, 0.6, 0.6); tone(120, 60, 0.2, 'triangle', 0.3); },
  chirp() { for (let i = 0; i < 4; i++) tone(4300, 4300, 0.035, 'sine', 0.02, i * 0.07); },
  hum() { tone(118, 124, 0.8, 'sine', 0.045); tone(236, 248, 0.7, 'sine', 0.018, 0.05); },
  growl() { tone(90, 60, 0.4, 'sawtooth', 0.09); }, hoot() { tone(390, 350, 0.4, 'sine', 0.14); tone(390, 340, 0.5, 'sine', 0.14, 0.55); }
};
export const audioReady = () => !!AC;
export const resumeAudio = () => { if (AC && AC.state === 'suspended') void AC.resume(); };
