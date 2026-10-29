/** A short, quiet two-note chime for incoming messages. Generated with Web Audio, so there is no asset to ship.
 *  Browsers may block audio until the page has had a click; that is caught and ignored. */
let ctx: AudioContext | null = null;

export const soundEnabled = () => localStorage.getItem("cpms_sound") !== "off";
export const setSoundEnabled = (on: boolean) => localStorage.setItem("cpms_sound", on ? "on" : "off");

export function playMessageTone() {
  if (!soundEnabled()) return;
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = ctx ?? new AC();
    if (ctx.state === "suspended") void ctx.resume();
    const now = ctx.currentTime;
    [660, 880].forEach((freq, i) => {
      const osc = ctx!.createOscillator(), gain = ctx!.createGain();
      osc.type = "sine"; osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + i * 0.11);
      gain.gain.exponentialRampToValueAtTime(0.05, now + i * 0.11 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.11 + 0.18);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(now + i * 0.11); osc.stop(now + i * 0.11 + 0.2);
    });
  } catch { /* audio is a nicety; never let it break the app */ }
}
