// Web Audio API primitives for the Concept Composer.
// Phase 1: synthesis helpers only. Per-prop palettes layered on top of these
// primitives as each prop ships:
//   - Cube     → playGlassyChime  (Phase 2 — glassy harmonic stack)
//   - Disc     → low harmonic intervals (Phase 3)
//   - Wire     → shimmering pulse + sharp snap (Phase 3)
//   - Scale    → brass clicks + deeper resonance (Phase 3)
//   - Firewall → snap-release click (Phase 4 — pitched-down wire snap)
//   - Hot-Swap → granular swarm-noise + delayed condense chime (Phase 5)
//   - FirewallHUD → high sine pip on pass + reused FirewallSnap on reject (Phase 6)
//   - TopologyCrystal → glass-chime snap + per-edge sine tick + low golden bell (Phase 7)

const MIN_HZ = 20;
const MAX_HZ = 20000;

export function clampFrequency(hz) {
  if (!Number.isFinite(hz)) return MAX_HZ;
  if (hz < MIN_HZ) return MIN_HZ;
  if (hz > MAX_HZ) return MAX_HZ;
  return hz;
}

export function envelope({ attack = 0, decay = 0, sustain = 0, release = 0 }) {
  const a = Math.max(0, attack);
  const d = Math.max(0, decay);
  const s = Math.max(0, sustain);
  const r = Math.max(0, release);
  return { attack: a, decay: d, sustain: s, release: r, totalDuration: a + d + s + r };
}

// Get-or-create the shared AudioContext. One per page lifetime.
let _ctx = null;
export function getAudioContext() {
  if (_ctx) return _ctx;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) throw new Error('Web Audio API not supported in this browser');
  _ctx = new Ctor();
  return _ctx;
}

// Play a single tone with the given envelope. Returns a Promise that resolves
// when the envelope completes. Used by per-prop audio modules in later phases.
export function playTone({ frequency, type = 'sine', envelope: env, gain = 0.3 }) {
  const ctx = getAudioContext();
  const osc = ctx.createOscillator();
  const gainNode = ctx.createGain();
  osc.type = type;
  osc.frequency.value = clampFrequency(frequency);
  osc.connect(gainNode).connect(ctx.destination);

  const now = ctx.currentTime;
  const { attack, decay, sustain, totalDuration } = env;

  gainNode.gain.setValueAtTime(0, now);
  gainNode.gain.linearRampToValueAtTime(gain, now + attack);
  gainNode.gain.linearRampToValueAtTime(gain * 0.7, now + attack + decay);
  gainNode.gain.setValueAtTime(gain * 0.7, now + attack + decay + sustain);
  gainNode.gain.linearRampToValueAtTime(0, now + totalDuration);

  osc.start(now);
  osc.stop(now + totalDuration);

  return new Promise((resolve) => {
    osc.onended = () => resolve();
  });
}

// Wire snap — bright, fast, gritty. Sawtooth + noise hit for the moment
// the citation breaks. The Citation Wire fires this when a sudden-yank is
// detected — operator pantomimes a failed fact lookup.
export function playWireSnap({ volume = 0.28 } = {}) {
  let ctx;
  try { ctx = getAudioContext(); } catch { return; }
  const now = ctx.currentTime;
  // Layer 1: bright sawtooth pitch-down (snap pitch envelope)
  const osc = ctx.createOscillator();
  const oscGain = ctx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(1800, now);
  osc.frequency.exponentialRampToValueAtTime(300, now + 0.15);
  osc.connect(oscGain).connect(ctx.destination);
  oscGain.gain.setValueAtTime(0, now);
  oscGain.gain.linearRampToValueAtTime(volume, now + 0.005);
  oscGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
  osc.start(now);
  osc.stop(now + 0.2);

  // Layer 2: short noise burst for the crackle. Synthesized from a buffer of
  // random samples — Web Audio doesn't ship a noise oscillator.
  const noiseDur = 0.12;
  const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * noiseDur, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1);
  const noiseSrc = ctx.createBufferSource();
  noiseSrc.buffer = noiseBuf;
  const noiseGain = ctx.createGain();
  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = 'bandpass';
  noiseFilter.frequency.value = 2400;
  noiseFilter.Q.value = 0.8;
  noiseSrc.connect(noiseFilter).connect(noiseGain).connect(ctx.destination);
  noiseGain.gain.setValueAtTime(0, now);
  noiseGain.gain.linearRampToValueAtTime(volume * 0.6, now + 0.003);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + noiseDur);
  noiseSrc.start(now);
  noiseSrc.stop(now + noiseDur + 0.02);
}

// Firewall snap — short clean "rule fired" click. Modeled on the Wire snap
// but pitched ~50 cents lower (pitchShift = 0.97) and with a softer noise
// contribution to read as "regex matched/rejected" rather than "yank broke."
// The Firewall Gate fires this on each reveal-cycle pulse.
export function playFirewallSnap({ volume = 0.22 } = {}) {
  let ctx;
  try { ctx = getAudioContext(); } catch { return; }
  const now = ctx.currentTime;
  const pitchShift = 0.97;
  // Layer 1: bright sawtooth pitch-down (snap pitch envelope)
  const osc = ctx.createOscillator();
  const oscGain = ctx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(1800 * pitchShift, now);
  osc.frequency.exponentialRampToValueAtTime(300 * pitchShift, now + 0.15);
  osc.connect(oscGain).connect(ctx.destination);
  oscGain.gain.setValueAtTime(0, now);
  oscGain.gain.linearRampToValueAtTime(volume, now + 0.005);
  oscGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
  osc.start(now);
  osc.stop(now + 0.18);

  // Layer 2: softer noise burst — lower volume + tighter Q than wire snap,
  // so the texture reads "click" not "crackle."
  const noiseDur = 0.10;
  const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * noiseDur, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1);
  const noiseSrc = ctx.createBufferSource();
  noiseSrc.buffer = noiseBuf;
  const noiseGain = ctx.createGain();
  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = 'bandpass';
  noiseFilter.frequency.value = 2400 * pitchShift;
  noiseFilter.Q.value = 1.2;
  noiseSrc.connect(noiseFilter).connect(noiseGain).connect(ctx.destination);
  noiseGain.gain.setValueAtTime(0, now);
  noiseGain.gain.linearRampToValueAtTime(volume * 0.35, now + 0.003);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + noiseDur);
  noiseSrc.start(now);
  noiseSrc.stop(now + noiseDur + 0.02);
}

// Brass click — short metallic tick + slight resonance. The Verdict Scale
// fires this on each tilt-direction crossing. Sharp attack, fast decay,
// secondary resonance for the "settling" feel.
export function playBrassClick({ pitch = 1, volume = 0.22 } = {}) {
  let ctx;
  try { ctx = getAudioContext(); } catch { return; }
  const now = ctx.currentTime;
  const base = 420 * pitch;
  // Click: square wave, very short envelope
  const osc1 = ctx.createOscillator();
  const g1 = ctx.createGain();
  osc1.type = 'square';
  osc1.frequency.value = clampFrequency(base);
  osc1.connect(g1).connect(ctx.destination);
  g1.gain.setValueAtTime(0, now);
  g1.gain.linearRampToValueAtTime(volume, now + 0.002);
  g1.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
  osc1.start(now);
  osc1.stop(now + 0.1);
  // Resonance: triangle at octave-down, decays slower
  const osc2 = ctx.createOscillator();
  const g2 = ctx.createGain();
  osc2.type = 'triangle';
  osc2.frequency.value = clampFrequency(base / 2);
  osc2.connect(g2).connect(ctx.destination);
  g2.gain.setValueAtTime(0, now);
  g2.gain.linearRampToValueAtTime(volume * 0.35, now + 0.004);
  g2.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
  osc2.start(now);
  osc2.stop(now + 0.27);
}

// Phase chime — low harmonic stack for the Phase Disc sector transition.
// Three pitches (one per sector: THESIS / ANTITHESIS / SYNTHESIS) shift by a
// major-third interval each, matching the spec's "low harmonic shifts by a
// third when the spotlight crosses a sector boundary." Sine root + triangle
// octave-down for body. Fire-and-forget.
export function playPhaseChime({ phase = 0, volume = 0.2 } = {}) {
  let ctx;
  try { ctx = getAudioContext(); } catch { return; }
  const baseFreq = 220; // A3
  // Major chord stack: root, third, fifth — sector index picks which one
  const intervals = [1.0, 1.25, 1.5];
  const freq = baseFreq * intervals[phase % 3];
  const now = ctx.currentTime;
  const attack = 0.012;
  const decay = 0.65;
  const layers = [
    { freq, gain: volume, type: 'sine' },
    { freq: freq / 2, gain: volume * 0.55, type: 'triangle' },
  ];
  for (const layer of layers) {
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    osc.type = layer.type;
    osc.frequency.value = clampFrequency(layer.freq);
    osc.connect(gainNode).connect(ctx.destination);
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(layer.gain, now + attack);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);
    osc.start(now);
    osc.stop(now + attack + decay + 0.05);
  }
}

// Topology Crystal snap — crystalline glass-chime that reads as "chaos
// resolved into structured lattice." Four sine harmonics stacked with a
// fast attack + ~0.35s exp decay. Fires once at the crystallize → stable
// transition.
export function playTopologyCrystalSnap({ volume = 0.22 } = {}) {
  let ctx;
  try { ctx = getAudioContext(); } catch { return; }
  const now = ctx.currentTime;
  const freqs = [1320, 1980, 2640, 3960];           // E6, B6, E7, B7-ish
  const attack = 0.006;
  const decay = 0.35;
  freqs.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = clampFrequency(freq);
    osc.connect(gainNode).connect(ctx.destination);
    const layerGain = volume * (0.65 - i * 0.13);
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(layerGain, now + attack);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);
    osc.start(now);
    osc.stop(now + attack + decay + 0.05);
  });
}

// Topology Crystal pulse — short sine tick fired per edge as a running
// light traverses it. Low volume because many fire in close succession.
// 880 Hz (A5), 5ms attack + 80ms exp decay.
export function playTopologyCrystalPulse({ volume = 0.10 } = {}) {
  let ctx;
  try { ctx = getAudioContext(); } catch { return; }
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gainNode = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = clampFrequency(880);
  osc.connect(gainNode).connect(ctx.destination);
  gainNode.gain.setValueAtTime(0, now);
  gainNode.gain.linearRampToValueAtTime(volume, now + 0.005);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.085);
  osc.start(now);
  osc.stop(now + 0.1);
}

// Topology Crystal beam — low golden bell that fires when a reasoning
// node's HYPOTHESIZES beam attaches to its evidence target. Sine root
// + triangle octave-up for body, ~0.6s exp decay.
export function playTopologyCrystalBeam({ volume = 0.18 } = {}) {
  let ctx;
  try { ctx = getAudioContext(); } catch { return; }
  const now = ctx.currentTime;
  const attack = 0.015;
  const decay = 0.6;
  // Root sine.
  const osc1 = ctx.createOscillator();
  const g1 = ctx.createGain();
  osc1.type = 'sine';
  osc1.frequency.value = clampFrequency(220);          // A3
  osc1.connect(g1).connect(ctx.destination);
  g1.gain.setValueAtTime(0, now);
  g1.gain.linearRampToValueAtTime(volume * 0.75, now + attack);
  g1.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);
  osc1.start(now);
  osc1.stop(now + attack + decay + 0.05);
  // Triangle harmonic for warmth.
  const osc2 = ctx.createOscillator();
  const g2 = ctx.createGain();
  osc2.type = 'triangle';
  osc2.frequency.value = clampFrequency(660);          // E5
  osc2.connect(g2).connect(ctx.destination);
  g2.gain.setValueAtTime(0, now);
  g2.gain.linearRampToValueAtTime(volume * 0.4, now + attack);
  g2.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);
  osc2.start(now);
  osc2.stop(now + attack + decay + 0.05);
}

// Firewall pass — high single-sine pip for "valid match" verdicts in the
// FirewallHUD's token stream. Short, clean, fast attack + short exp decay.
// Pitched well above Cube's glassy chime (1320 Hz vs 880 Hz) so a rapid
// stream of passes doesn't smear into Cube territory in a mix.
export function playFirewallPass({ volume = 0.15 } = {}) {
  let ctx;
  try { ctx = getAudioContext(); } catch { return; }
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gainNode = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = clampFrequency(1320); // E6
  osc.connect(gainNode).connect(ctx.destination);
  gainNode.gain.setValueAtTime(0, now);
  gainNode.gain.linearRampToValueAtTime(volume, now + 0.005);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
  osc.start(now);
  osc.stop(now + 0.2);
}

// Hot-Swap morph — two-stage transformation audio. Stage 1: bandpass-
// filtered noise burst with slow attack + sustain reads as "whispered
// swarm" during particle dispersal. Stage 2: delayed sine harmonic stack
// at +0.70s reads as "condense chime" when particles arrive at the
// target palm. Together they sell the disperse-and-reform identity-shift
// moment. Pitched a third above the Cube's glassy chime (660 Hz root vs
// 880 Hz) so the two palettes are distinguishable in a crowded mix.
export function playHotSwapMorph({ volume = 0.22 } = {}) {
  let ctx;
  try { ctx = getAudioContext(); } catch { return; }
  const now = ctx.currentTime;

  // Stage 1: granular swarm-noise burst. Bandpass-filtered white noise,
  // slow attack + flat sustain + tail decay = "whispered swarm" texture.
  const swarmDur = 0.85;
  const swarmBuf = ctx.createBuffer(1, ctx.sampleRate * swarmDur, ctx.sampleRate);
  const data = swarmBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1);
  const swarmSrc = ctx.createBufferSource();
  swarmSrc.buffer = swarmBuf;
  const swarmGain = ctx.createGain();
  const swarmFilter = ctx.createBiquadFilter();
  swarmFilter.type = 'bandpass';
  swarmFilter.frequency.value = 1800;
  swarmFilter.Q.value = 2.5;
  swarmSrc.connect(swarmFilter).connect(swarmGain).connect(ctx.destination);
  swarmGain.gain.setValueAtTime(0, now);
  swarmGain.gain.linearRampToValueAtTime(volume * 0.45, now + 0.08);
  swarmGain.gain.linearRampToValueAtTime(volume * 0.4, now + 0.55);
  swarmGain.gain.exponentialRampToValueAtTime(0.0001, now + swarmDur);
  swarmSrc.start(now);
  swarmSrc.stop(now + swarmDur + 0.02);

  // Stage 2: condense chime — sine harmonic stack at +0.70s. Three pitches
  // (root + fifth + octave), short attack + exp decay. Crystallizes out of
  // the tail of the swarm noise.
  const chimeStart = now + 0.7;
  const base = 660; // E5
  const harmonics = [
    { freq: base, gain: volume * 0.7 },
    { freq: base * 1.5, gain: volume * 0.4 },
    { freq: base * 2.0, gain: volume * 0.25 },
  ];
  const chimeAttack = 0.01;
  const chimeDecay = 0.4;
  for (const h of harmonics) {
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = clampFrequency(h.freq);
    osc.connect(gainNode).connect(ctx.destination);
    gainNode.gain.setValueAtTime(0, chimeStart);
    gainNode.gain.linearRampToValueAtTime(h.gain, chimeStart + chimeAttack);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, chimeStart + chimeAttack + chimeDecay);
    osc.start(chimeStart);
    osc.stop(chimeStart + chimeAttack + chimeDecay + 0.05);
  }
}

// Stretch Tile grab — short cyan pluck when a corner dot is grabbed. Sine
// root + triangle octave, very fast attack + ~0.18s decay. Reads as a
// confident "I have it" punctuation without overwhelming the drag itself
// (which is silent — the visual latch carries the continuous feedback).
export function playStretchGrab({ volume = 0.15 } = {}) {
  let ctx;
  try { ctx = getAudioContext(); } catch { return; }
  const now = ctx.currentTime;
  const layers = [
    { freq: 1100, type: 'sine', g: volume * 0.85 },
    { freq: 550,  type: 'triangle', g: volume * 0.35 },
  ];
  for (const l of layers) {
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    osc.type = l.type;
    osc.frequency.value = clampFrequency(l.freq);
    osc.connect(gainNode).connect(ctx.destination);
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(l.g, now + 0.005);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    osc.start(now);
    osc.stop(now + 0.2);
  }
}

// Stretch Tile release — gentle descending sine sigh on pinch release.
// Pitches down 600 → 380 Hz over ~0.22s. Softer than grab so the drop
// feels like setting something down, not throwing it.
export function playStretchRelease({ volume = 0.12 } = {}) {
  let ctx;
  try { ctx = getAudioContext(); } catch { return; }
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gainNode = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(600, now);
  osc.frequency.exponentialRampToValueAtTime(380, now + 0.22);
  osc.connect(gainNode).connect(ctx.destination);
  gainNode.gain.setValueAtTime(0, now);
  gainNode.gain.linearRampToValueAtTime(volume, now + 0.01);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
  osc.start(now);
  osc.stop(now + 0.26);
}

// Oracle adjudicate — cyan-deterministic chime fired when the Oracle Lattice
// pulses corner-to-corner. High sine root (1760 Hz / A6) + triangle octave-down
// for warmth. Short attack, ~0.5s exponential decay. Sells "math doesn't
// think — it just answers."
export function playOracleAdjudicate({ volume = 0.2 } = {}) {
  let ctx;
  try { ctx = getAudioContext(); } catch { return; }
  const now = ctx.currentTime;
  const attack = 0.008;
  const decay = 0.52;
  const layers = [
    { freq: 1760, type: 'sine', g: volume * 0.8 },
    { freq: 880, type: 'triangle', g: volume * 0.35 },
    { freq: 2640, type: 'sine', g: volume * 0.22 },
  ];
  for (const l of layers) {
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    osc.type = l.type;
    osc.frequency.value = clampFrequency(l.freq);
    osc.connect(gainNode).connect(ctx.destination);
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(l.g, now + attack);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);
    osc.start(now);
    osc.stop(now + attack + decay + 0.05);
  }
}

// Light Skeptic tick — single sine pip fired per rule-dot hit. Pitch climbs
// per rule in the sequence (pitch=1 → 1.18 → 1.36 → 1.54) so the four
// touches read as an ascending "R1 → R2 → R3 → R4" rhythm.
export function playLightSkepticTick({ pitch = 1, volume = 0.16 } = {}) {
  let ctx;
  try { ctx = getAudioContext(); } catch { return; }
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gainNode = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = clampFrequency(1100 * pitch);
  osc.connect(gainNode).connect(ctx.destination);
  gainNode.gain.setValueAtTime(0, now);
  gainNode.gain.linearRampToValueAtTime(volume, now + 0.004);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
  osc.start(now);
  osc.stop(now + 0.15);
}

// Light Skeptic verdict — fires after all four rules touched in order.
// Stacked sine harmonics (root + fifth + octave) — cleaner than wire
// snap, brighter than Oracle adjudicate. Sells "0.8400 — exact decimal."
export function playLightSkepticVerdict({ volume = 0.22 } = {}) {
  let ctx;
  try { ctx = getAudioContext(); } catch { return; }
  const now = ctx.currentTime;
  const base = 1320; // E6
  const harmonics = [
    { freq: base, g: volume * 0.85 },
    { freq: base * 1.5, g: volume * 0.5 },
    { freq: base * 2.0, g: volume * 0.32 },
  ];
  const attack = 0.006;
  const decay = 0.55;
  for (const h of harmonics) {
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = clampFrequency(h.freq);
    osc.connect(gainNode).connect(ctx.destination);
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(h.g, now + attack);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);
    osc.start(now);
    osc.stop(now + attack + decay + 0.05);
  }
}

// Evidence valid — short cyan chime for "claim points at a real Fact."
// Slightly lower than Oracle adjudicate (1320 Hz) so a rapid stream of
// validations doesn't smear into the verdict pitch.
export function playEvidenceValid({ volume = 0.18 } = {}) {
  let ctx;
  try { ctx = getAudioContext(); } catch { return; }
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gainNode = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = clampFrequency(1320);
  osc.connect(gainNode).connect(ctx.destination);
  gainNode.gain.setValueAtTime(0, now);
  gainNode.gain.linearRampToValueAtTime(volume, now + 0.005);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
  osc.start(now);
  osc.stop(now + 0.24);
}

// Evidence reject — schema-violation flash. Sawtooth pitch-down + bandpass
// noise hit (similar to FirewallSnap but louder + faster). Fires on
// hallucinated-citation detection ("the void rejected what didn't belong").
export function playEvidenceReject({ volume = 0.24 } = {}) {
  let ctx;
  try { ctx = getAudioContext(); } catch { return; }
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const oscGain = ctx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(900, now);
  osc.frequency.exponentialRampToValueAtTime(180, now + 0.18);
  osc.connect(oscGain).connect(ctx.destination);
  oscGain.gain.setValueAtTime(0, now);
  oscGain.gain.linearRampToValueAtTime(volume, now + 0.004);
  oscGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
  osc.start(now);
  osc.stop(now + 0.25);

  const noiseDur = 0.14;
  const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * noiseDur, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1);
  const noiseSrc = ctx.createBufferSource();
  noiseSrc.buffer = noiseBuf;
  const noiseGain = ctx.createGain();
  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = 'bandpass';
  noiseFilter.frequency.value = 1200;
  noiseFilter.Q.value = 0.9;
  noiseSrc.connect(noiseFilter).connect(noiseGain).connect(ctx.destination);
  noiseGain.gain.setValueAtTime(0, now);
  noiseGain.gain.linearRampToValueAtTime(volume * 0.5, now + 0.003);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + noiseDur);
  noiseSrc.start(now);
  noiseSrc.stop(now + noiseDur + 0.02);
}

// Firewall shatter — particle-impacts-plane sound. Bright crystal-glass break
// with a triangle hit + filtered noise. Slightly higher pitched than the
// Cube's glassy chime so the firewall reads sharper than evidence-box pulses.
export function playFirewallShatter({ volume = 0.18 } = {}) {
  let ctx;
  try { ctx = getAudioContext(); } catch { return; }
  const now = ctx.currentTime;
  // Tone hit.
  const osc = ctx.createOscillator();
  const oscGain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(2400, now);
  osc.frequency.exponentialRampToValueAtTime(700, now + 0.18);
  osc.connect(oscGain).connect(ctx.destination);
  oscGain.gain.setValueAtTime(0, now);
  oscGain.gain.linearRampToValueAtTime(volume * 0.9, now + 0.004);
  oscGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
  osc.start(now);
  osc.stop(now + 0.18);

  // Noise crackle for the shatter texture.
  const noiseDur = 0.09;
  const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * noiseDur, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1);
  const noiseSrc = ctx.createBufferSource();
  noiseSrc.buffer = noiseBuf;
  const noiseGain = ctx.createGain();
  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = 'highpass';
  noiseFilter.frequency.value = 1800;
  noiseSrc.connect(noiseFilter).connect(noiseGain).connect(ctx.destination);
  noiseGain.gain.setValueAtTime(0, now);
  noiseGain.gain.linearRampToValueAtTime(volume * 0.4, now + 0.003);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + noiseDur);
  noiseSrc.start(now);
  noiseSrc.stop(now + noiseDur + 0.02);
}

// Firewall slip — near-silent breath for "particle slid through the plane."
// The choreography wants white framing particles to feel UNREMARKABLE — the
// wall doesn't even notice them. A very quiet filtered whoosh sells that.
export function playFirewallSlip({ volume = 0.05 } = {}) {
  let ctx;
  try { ctx = getAudioContext(); } catch { return; }
  const now = ctx.currentTime;
  const noiseDur = 0.18;
  const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * noiseDur, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1);
  const noiseSrc = ctx.createBufferSource();
  noiseSrc.buffer = noiseBuf;
  const noiseGain = ctx.createGain();
  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = 'bandpass';
  noiseFilter.frequency.value = 600;
  noiseFilter.Q.value = 0.6;
  noiseSrc.connect(noiseFilter).connect(noiseGain).connect(ctx.destination);
  noiseGain.gain.setValueAtTime(0, now);
  noiseGain.gain.linearRampToValueAtTime(volume, now + 0.04);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + noiseDur);
  noiseSrc.start(now);
  noiseSrc.stop(now + noiseDur + 0.02);
}

// Drift convergence — fires when the Drift Dial reaches "wrong-and-confident"
// (both wisps deep red simultaneously held for 0.6s). Low ominous bell —
// sine root at 165 Hz (E3) with triangle 5th. Sells the failure-mode reveal
// from BEAT 4 ("the longer they argued, the more confidently wrong").
export function playDriftConvergence({ volume = 0.18 } = {}) {
  let ctx;
  try { ctx = getAudioContext(); } catch { return; }
  const now = ctx.currentTime;
  const attack = 0.025;
  const decay = 0.85;
  const layers = [
    { freq: 165, type: 'sine', g: volume * 0.9 },
    { freq: 247, type: 'triangle', g: volume * 0.45 },
    { freq: 330, type: 'sine', g: volume * 0.25 },
  ];
  for (const l of layers) {
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    osc.type = l.type;
    osc.frequency.value = clampFrequency(l.freq);
    osc.connect(gainNode).connect(ctx.destination);
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(l.g, now + attack);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);
    osc.start(now);
    osc.stop(now + attack + decay + 0.05);
  }
}

// Tribunal ambience — two continuous panned hums (Architect left, Skeptic
// right) + a tension-noise bed whose gain rides the palm-distance channel.
//
// Architect and Skeptic are pitched a minor seventh apart (110 Hz / 98 Hz)
// so their fundamentals beat against each other at ~12 Hz — a subliminal
// "they're arguing" wobble that's audible without being foreground.
//
// Unlike the other functions in this file (fire-and-forget one-shots),
// this one returns a control object. Callers MUST call .stop() when the
// glyph disposes — otherwise oscillators continue forever and the next
// prop mount stacks new ones on top.
//
//   const amb = createTribunalAmbience();
//   amb.setTension(0.0..1.0);    // call per-frame from glyph update()
//   amb.stop();                  // call from glyph dispose()
//
// Returns a no-op stub when Web Audio isn't available, so callers don't
// need to null-check.
export function createTribunalAmbience({ volume = 1 } = {}) {
  let ctx;
  try { ctx = getAudioContext(); } catch { return noOpTribunalAmbience(); }

  const now = ctx.currentTime;
  const FADE_IN = 0.4;

  // Master gain — fades the whole ambience in on start, out on stop. Saves
  // having to ramp every child node individually at teardown.
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);
  master.gain.linearRampToValueAtTime(volume, now + FADE_IN);

  // Architect hum (cyan): low sine, panned hard-left.
  const archOsc = ctx.createOscillator();
  const archGain = ctx.createGain();
  const archPan = ctx.createStereoPanner();
  archOsc.type = 'sine';
  archOsc.frequency.value = 110;       // A2
  archGain.gain.value = 0.05;
  archPan.pan.value = -0.85;
  archOsc.connect(archGain).connect(archPan).connect(master);
  archOsc.start(now);

  // Skeptic hum (red): G2, a minor seventh down from Architect. Detune
  // creates the slow beat that reads as "tension between them."
  const skepOsc = ctx.createOscillator();
  const skepGain = ctx.createGain();
  const skepPan = ctx.createStereoPanner();
  skepOsc.type = 'sine';
  skepOsc.frequency.value = 98;        // G2
  skepGain.gain.value = 0.05;
  skepPan.pan.value = 0.85;
  skepOsc.connect(skepGain).connect(skepPan).connect(master);
  skepOsc.start(now);

  // Tension friction: looping noise through narrow bandpass. Gain is the
  // continuous channel — setTargetAtTime smooths so per-frame calls don't
  // pile up automation points (which would glitch on a tight RAF loop).
  const noiseDur = 1.5;
  const noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * noiseDur), ctx.sampleRate);
  const noiseData = noiseBuf.getChannelData(0);
  for (let i = 0; i < noiseData.length; i++) noiseData[i] = (Math.random() * 2 - 1);
  const noiseSrc = ctx.createBufferSource();
  noiseSrc.buffer = noiseBuf;
  noiseSrc.loop = true;
  const noiseGain = ctx.createGain();
  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = 'bandpass';
  noiseFilter.frequency.value = 600;
  noiseFilter.Q.value = 1.5;
  noiseGain.gain.value = 0;
  noiseSrc.connect(noiseFilter).connect(noiseGain).connect(master);
  noiseSrc.start(now);

  let disposed = false;

  return {
    setTension(t) {
      if (disposed) return;
      const target = Math.max(0, Math.min(1, t)) * 0.06;
      noiseGain.gain.setTargetAtTime(target, ctx.currentTime, 0.1);
    },
    stop() {
      if (disposed) return;
      disposed = true;
      const fadeOut = 0.3;
      const t = ctx.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(master.gain.value, t);
      master.gain.linearRampToValueAtTime(0, t + fadeOut);
      const stopAt = t + fadeOut + 0.05;
      archOsc.stop(stopAt);
      skepOsc.stop(stopAt);
      noiseSrc.stop(stopAt);
    },
  };
}

function noOpTribunalAmbience() {
  return { setTension() {}, stop() {} };
}

// Glassy chime — three sine harmonics (root + perfect fifth + octave) with
// quick attack and exponential decay. Sells the "containment boundary just
// got tapped" feel for the Sealed Lattice Cube push event. Fire-and-forget;
// callers don't await.
export function playGlassyChime({ pitch = 1, volume = 0.22 } = {}) {
  let ctx;
  try {
    ctx = getAudioContext();
  } catch {
    // Browser without Web Audio support — silent no-op so the glyph doesn't
    // tear down on systems that can't make sound.
    return;
  }
  const base = 880 * pitch; // A5 baseline
  // Frequencies: root, fifth (×1.5), octave (×2). Volume tapers per harmonic.
  const harmonics = [
    { freq: base, gain: volume },
    { freq: base * 1.5, gain: volume * 0.55 },
    { freq: base * 2.0, gain: volume * 0.35 },
  ];
  const now = ctx.currentTime;
  const attack = 0.005;
  const decay = 0.45;
  for (const h of harmonics) {
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = clampFrequency(h.freq);
    osc.connect(gainNode).connect(ctx.destination);
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(h.gain, now + attack);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);
    osc.start(now);
    osc.stop(now + attack + decay + 0.05);
  }
}
