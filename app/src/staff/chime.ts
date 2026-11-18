// The new-order chime: a two-note sine chime (E5 then A5). On by default; the
// setting lasts only for this page.
let ctx: AudioContext | null = null;
export let soundEnabled = true;

export const setSound = (on: boolean): void => {
  soundEnabled = on;
};

function note(ac: AudioContext, freq: number, gain: number, start: number, end: number) {
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, ac.currentTime + start);
  amp.gain.setValueAtTime(gain, ac.currentTime + start);
  amp.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + end);
  osc.connect(amp);
  amp.connect(ac.destination);
  osc.start(ac.currentTime + start);
  osc.stop(ac.currentTime + end);
}

export function playOrderChime(): void {
  if (!soundEnabled) return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    note(ctx, 659.25, 0.25, 0, 0.35);
    note(ctx, 880, 0.3, 0.15, 0.65);
  } catch {
    // No audio output: the snack still tells staff about the order.
  }
}
