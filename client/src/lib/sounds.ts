// Trade Sound Notifications — Web Audio API
// All sounds are generated programmatically (no external files needed)
// Sounds are under 1 second, non-annoying

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  // Resume if suspended (browser autoplay policy)
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  return audioCtx;
}

/** Trade Entry — short bright "ding" (500ms) */
export function playEntrySound(): void {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  
  osc.connect(gain);
  gain.connect(ctx.destination);
  
  osc.type = "sine";
  osc.frequency.setValueAtTime(880, ctx.currentTime); // A5
  osc.frequency.setValueAtTime(1320, ctx.currentTime + 0.1); // E6
  
  gain.gain.setValueAtTime(0.3, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
  
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.4);
}

/** Trade Exit Profit — "ka-ching" cash register (600ms) */
export function playProfitSound(): void {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  
  // First chime
  const osc1 = ctx.createOscillator();
  const gain1 = ctx.createGain();
  osc1.connect(gain1);
  gain1.connect(ctx.destination);
  osc1.type = "sine";
  osc1.frequency.setValueAtTime(1047, ctx.currentTime); // C6
  gain1.gain.setValueAtTime(0.3, ctx.currentTime);
  gain1.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
  osc1.start(ctx.currentTime);
  osc1.stop(ctx.currentTime + 0.15);
  
  // Second chime (higher)
  const osc2 = ctx.createOscillator();
  const gain2 = ctx.createGain();
  osc2.connect(gain2);
  gain2.connect(ctx.destination);
  osc2.type = "sine";
  osc2.frequency.setValueAtTime(1319, ctx.currentTime + 0.12); // E6
  gain2.gain.setValueAtTime(0, ctx.currentTime);
  gain2.gain.setValueAtTime(0.3, ctx.currentTime + 0.12);
  gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
  osc2.start(ctx.currentTime + 0.12);
  osc2.stop(ctx.currentTime + 0.3);
  
  // Third chime (highest) — the "ching"
  const osc3 = ctx.createOscillator();
  const gain3 = ctx.createGain();
  osc3.connect(gain3);
  gain3.connect(ctx.destination);
  osc3.type = "sine";
  osc3.frequency.setValueAtTime(1568, ctx.currentTime + 0.25); // G6
  gain3.gain.setValueAtTime(0, ctx.currentTime);
  gain3.gain.setValueAtTime(0.35, ctx.currentTime + 0.25);
  gain3.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.6);
  osc3.start(ctx.currentTime + 0.25);
  osc3.stop(ctx.currentTime + 0.6);
}

/** Trade Exit Loss — subtle low tone (400ms, not annoying) */
export function playLossSound(): void {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  
  osc.connect(gain);
  gain.connect(ctx.destination);
  
  osc.type = "sine";
  osc.frequency.setValueAtTime(220, ctx.currentTime); // A3 (low)
  osc.frequency.linearRampToValueAtTime(165, ctx.currentTime + 0.3); // E3 (lower)
  
  gain.gain.setValueAtTime(0.15, ctx.currentTime); // Quieter than entry/profit
  gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
  
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.35);
}

/** Check if sound notifications are enabled */
export function isSoundEnabled(): boolean {
  return localStorage.getItem("scalpbot_sound_notifications") !== "false"; // Default ON
}

/** Toggle sound notifications */
export function setSoundEnabled(enabled: boolean): void {
  localStorage.setItem("scalpbot_sound_notifications", enabled ? "true" : "false");
}
