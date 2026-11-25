// The sounds of the Épopée, synthesised with Web Audio: no audio file, so they
// work offline and weigh nothing. Short and soft on purpose (a coin, not a slot
// machine). Muted per device, by the speaker button of the runner.

const KEY = 'foyer.epopee.son';
let ctx: AudioContext | null = null;

export const soundOn = (): boolean => { try { return localStorage.getItem(KEY) !== 'non'; } catch { return true; } };
export const setSound = (on: boolean): void => { try { localStorage.setItem(KEY, on ? 'oui' : 'non'); } catch { /* private mode: the choice lasts the session */ } };

function tone(freq: number, at: number, dur: number, peak = 0.12): void {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + at;
    o.type = 'triangle'; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + dur + 0.02);
  } catch { /* no Web Audio: the picture says it all */ }
}

/** A coin dropping in the pouch, with a short buzz where the device can (not on iOS Safari). */
export function coin(): void {
  if (soundOn()) { tone(1319, 0, 0.1); tone(1976, 0.07, 0.25); }
  try { navigator.vibrate?.(30); } catch { /* no haptics */ }
}
/** The end of a routine: four rising notes. */
export function fanfare(): void {
  if (soundOn()) [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.13, i === 3 ? 0.5 : 0.22));
  try { navigator.vibrate?.([30, 60, 30]); } catch { /* no haptics */ }
}
