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

export function unlockAudio(): void {
  if (!soundEnabled || typeof AudioContext === 'undefined') return;
  try {
    const ac = (ctx ??= new AudioContext());
    if (ac.state === 'suspended') void ac.resume().catch(() => {});
  } catch {
    // AudioContext unavailable in this environment.
  }
}

export function playOrderChime(): void {
  if (!soundEnabled) return;
  try {
    const ac = (ctx ??= new AudioContext());
    const trigger = () => {
      note(ac, 659.25, 0.25, 0, 0.35);
      note(ac, 880, 0.3, 0.15, 0.65);
    };
    if (ac.state === 'suspended') {
      void ac.resume().then(
        () => {
          if (ac.state === 'running') trigger();
        },
        () => {},
      );
    } else if (ac.state === 'running') {
      trigger();
    }
  } catch {
    // No audio output: the snack still tells staff about the order.
  }
}
