import { readMusicPref } from './musicPref';

/**
 * The crash sound: one of three original sounds synthesized with the Web Audio API (no audio
 * files), picked at random on every death and timed to the death sequence (see
 * `deathSequence`): each starts on the crash and is over well before the game-over panel.
 * - `trombone`: a sad wah-wah-wah-waaah, four falling notes on a detuned brass-like pair through
 *   a lowpass that opens and closes on each note, the last held long with vibrato;
 * - `spiral`: an early arcade death, a square-wave blip warbling down in fast steps into a short
 *   burst of noise;
 * - `gameOver`: a synthwave boom (falling noise and a sine thump), then a falling minor
 *   arpeggio on a detuned saw lead with an echo.
 * Where Web Audio is unavailable (tests, old browsers) nothing plays and nothing throws.
 */

export const DEATH_SOUNDS = ['trombone', 'spiral', 'gameOver'] as const;
export type DeathSoundId = (typeof DEATH_SOUNDS)[number];

const MASTER_VOLUME = 0.45;
/** Scheduling slack so a sound's first events are never in the past. */
const LEAD_SECONDS = 0.02;

export function pickDeathSound(random: () => number = Math.random): DeathSoundId {
    const i = Math.floor(random() * DEATH_SOUNDS.length);
    return DEATH_SOUNDS[Math.min(DEATH_SOUNDS.length - 1, Math.max(0, i))];
}

/** A context and the master gain every sound plays through. */
export interface DeathAudio {
    ctx: AudioContext;
    master: GainNode;
}

type ContextFactory = () => AudioContext | null;

const browserContext: ContextFactory = () => {
    if (typeof window === 'undefined') return null;
    const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    return Ctor ? new Ctor() : null;
};

/** Builds a context and its master gain, or `null` when Web Audio is unavailable. */
export function createDeathAudio(makeContext: ContextFactory = browserContext): DeathAudio | null {
    try {
        const ctx = makeContext();
        if (!ctx) return null;
        const master = ctx.createGain();
        master.gain.value = MASTER_VOLUME;
        master.connect(ctx.destination);
        return { ctx, master };
    } catch {
        return null;
    }
}

let shared: DeathAudio | null | undefined;

/** The app-wide crash audio, created on first use. */
function sharedAudio(): DeathAudio | null {
    if (shared === undefined) shared = createDeathAudio();
    return shared;
}

/**
 * Creates and unlocks the crash audio. A crash is detected in the animation-frame loop, outside
 * any user gesture, and Safari keeps a context suspended unless it is resumed inside one, so this
 * runs from the arcade's own key, pointer and touch handlers.
 */
export function primeDeathAudio(): void {
    const audio = sharedAudio();
    if (audio?.ctx.state === 'suspended') void audio.ctx.resume().catch(() => undefined);
}

const noiseBuffers = new WeakMap<AudioContext, AudioBuffer>();

/** A second of white noise, made once per context. */
function noiseBuffer(ctx: AudioContext): AudioBuffer {
    let buffer = noiseBuffers.get(ctx);
    if (!buffer) {
        buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        noiseBuffers.set(ctx, buffer);
    }
    return buffer;
}

/** A gain node at 0, connected to `out`. */
function silentGain(ctx: AudioContext, out: AudioNode): GainNode {
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.connect(out);
    return gain;
}

/** Plays noise into `out` from `t` for `seconds`. */
function noise(ctx: AudioContext, out: AudioNode, t: number, seconds: number): void {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    src.connect(out);
    src.start(t);
    src.stop(t + seconds);
}

const midi = (note: number): number => 440 * Math.pow(2, (note - 69) / 12);

/** The sad trombone: D4, C#4, C4, then a long B3 with vibrato. */
function trombone(ctx: AudioContext, out: AudioNode, t0: number): number {
    const notes = [62, 61, 60, 59];
    const lengths = [0.32, 0.32, 0.32, 1.1];
    let t = t0;
    for (let n = 0; n < notes.length; n++) {
        const last = n === notes.length - 1;
        const len = lengths[n];
        const f = midi(notes[n]);
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.Q.value = 7;
        // The wah: the lowpass opens as the note speaks and closes as it ends; the held note
        // closes slowly, opening once more on the way.
        filter.frequency.setValueAtTime(350, t);
        filter.frequency.linearRampToValueAtTime(1700, t + 0.11);
        if (last) {
            filter.frequency.linearRampToValueAtTime(800, t + len * 0.3);
            filter.frequency.linearRampToValueAtTime(1300, t + len * 0.5);
            filter.frequency.linearRampToValueAtTime(380, t + len * 0.95);
        } else {
            filter.frequency.linearRampToValueAtTime(450, t + len * 0.9);
        }
        const amp = silentGain(ctx, out);
        amp.gain.setValueAtTime(0, t);
        amp.gain.linearRampToValueAtTime(0.32, t + 0.04);
        amp.gain.setValueAtTime(0.32, t + len * 0.7);
        amp.gain.linearRampToValueAtTime(0, t + len);
        filter.connect(amp);
        const vibrato = last ? ctx.createOscillator() : null;
        const depth = last ? ctx.createGain() : null;
        if (vibrato && depth) {
            vibrato.frequency.value = 5.5;
            depth.gain.setValueAtTime(0, t);
            depth.gain.linearRampToValueAtTime(f * 0.03, t + 0.35);
            vibrato.connect(depth);
            vibrato.start(t);
            vibrato.stop(t + len);
        }
        for (const [type, cents] of [
            ['sawtooth', -9],
            ['square', 9],
        ] as const) {
            const osc = ctx.createOscillator();
            osc.type = type;
            osc.frequency.setValueAtTime(f, t);
            // The held note sags a little as it dies.
            if (last) osc.frequency.linearRampToValueAtTime(f * 0.94, t + len);
            osc.detune.value = cents;
            if (depth) depth.connect(osc.frequency);
            osc.connect(filter);
            osc.start(t);
            osc.stop(t + len + 0.02);
        }
        t += len + (last ? 0 : 0.04);
    }
    return t - t0;
}

/** The arcade spiral-down: a warbling fall in 30 ms steps, then a burst of noise. */
function spiral(ctx: AudioContext, out: AudioNode, t0: number): number {
    const STEPS = 34;
    const STEP = 0.03;
    const fall = STEPS * STEP;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    for (let i = 0; i < STEPS; i++) {
        // Down a little per step, alternately up a fifth of the way back, so it spirals.
        const base = 1100 * Math.pow(0.92, i);
        const f = i % 2 === 0 ? base : base * 1.18;
        osc.frequency.setValueAtTime(f, t0 + i * STEP);
    }
    const warble = ctx.createOscillator();
    warble.frequency.value = 18;
    const warbleDepth = ctx.createGain();
    warbleDepth.gain.setValueAtTime(40, t0);
    warbleDepth.gain.linearRampToValueAtTime(6, t0 + fall);
    warble.connect(warbleDepth);
    warbleDepth.connect(osc.frequency);
    const amp = silentGain(ctx, out);
    amp.gain.setValueAtTime(0.22, t0);
    amp.gain.setValueAtTime(0.22, t0 + fall * 0.7);
    amp.gain.linearRampToValueAtTime(0, t0 + fall);
    osc.connect(amp);
    osc.start(t0);
    osc.stop(t0 + fall + 0.02);
    warble.start(t0);
    warble.stop(t0 + fall + 0.02);

    const burst = 0.32;
    const tb = t0 + fall;
    const crush = ctx.createBiquadFilter();
    crush.type = 'lowpass';
    crush.frequency.setValueAtTime(3200, tb);
    crush.frequency.exponentialRampToValueAtTime(300, tb + burst);
    const burstAmp = silentGain(ctx, out);
    burstAmp.gain.setValueAtTime(0.4, tb);
    burstAmp.gain.exponentialRampToValueAtTime(0.001, tb + burst);
    crush.connect(burstAmp);
    noise(ctx, crush, tb, burst);
    return fall + burst;
}

/** The synthwave game over: a boom, then A4, E4, C4 and a held A3 with an echo. */
function gameOver(ctx: AudioContext, out: AudioNode, t0: number): number {
    const boom = 0.9;
    const rumble = ctx.createBiquadFilter();
    rumble.type = 'lowpass';
    rumble.frequency.setValueAtTime(1400, t0);
    rumble.frequency.exponentialRampToValueAtTime(90, t0 + boom);
    const rumbleAmp = silentGain(ctx, out);
    rumbleAmp.gain.setValueAtTime(0.7, t0);
    rumbleAmp.gain.exponentialRampToValueAtTime(0.001, t0 + boom);
    rumble.connect(rumbleAmp);
    noise(ctx, rumble, t0, boom);
    const thump = ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(140, t0);
    thump.frequency.exponentialRampToValueAtTime(38, t0 + 0.45);
    const thumpAmp = silentGain(ctx, out);
    thumpAmp.gain.setValueAtTime(0.9, t0);
    thumpAmp.gain.exponentialRampToValueAtTime(0.001, t0 + 0.5);
    thump.connect(thumpAmp);
    thump.start(t0);
    thump.stop(t0 + 0.52);

    // The lead runs through a lowpass and an echo that dies away.
    const lead = ctx.createBiquadFilter();
    lead.type = 'lowpass';
    lead.frequency.value = 2200;
    lead.Q.value = 2;
    lead.connect(out);
    const echo = ctx.createDelay(1);
    echo.delayTime.value = 0.19;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.32;
    const wet = ctx.createGain();
    wet.gain.value = 0.45;
    lead.connect(echo);
    echo.connect(feedback);
    feedback.connect(echo);
    echo.connect(wet);
    wet.connect(out);

    const notes = [69, 64, 60, 57];
    const lengths = [0.15, 0.15, 0.15, 0.62];
    let t = t0 + 0.5;
    let lastOsc: OscillatorNode | null = null;
    for (let n = 0; n < notes.length; n++) {
        const len = lengths[n];
        const amp = silentGain(ctx, lead);
        amp.gain.setValueAtTime(0, t);
        amp.gain.linearRampToValueAtTime(0.2, t + 0.012);
        amp.gain.exponentialRampToValueAtTime(0.06, t + len * 0.6);
        amp.gain.exponentialRampToValueAtTime(0.001, t + len);
        for (const cents of [-11, 11]) {
            const osc = ctx.createOscillator();
            osc.type = 'sawtooth';
            osc.frequency.value = midi(notes[n]);
            osc.detune.value = cents;
            osc.connect(amp);
            osc.start(t);
            osc.stop(t + len + 0.02);
            lastOsc = osc;
        }
        t += len;
    }
    // The echo dies away, then its loop is taken off the master.
    feedback.gain.setValueAtTime(0.32, t);
    feedback.gain.linearRampToValueAtTime(0, t + 0.8);
    if (lastOsc) {
        lastOsc.onended = () =>
            window.setTimeout(() => {
                for (const node of [lead, echo, feedback, wet]) node.disconnect();
            }, 900);
    }
    return t + 0.8 - t0;
}

const SYNTHS: Record<DeathSoundId, (ctx: AudioContext, out: AudioNode, t0: number) => number> = {
    trombone,
    spiral,
    gameOver,
};

/**
 * Plays the crash sound `id` on `audio` (the shared crash audio by default), resuming the
 * context if the browser suspended it. Returns how long it plays, in seconds, or 0 when nothing
 * plays.
 */
export function playDeathSound(id: DeathSoundId, audio: DeathAudio | null = sharedAudio()): number {
    if (!audio) return 0;
    const { ctx, master } = audio;
    try {
        if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
        return SYNTHS[id](ctx, master, ctx.currentTime + LEAD_SECONDS);
    } catch {
        return 0;
    }
}

export interface DeathCueOptions {
    /** Whether the arcade's sound is on; read at each crash. */
    enabled?: () => boolean;
    play?: (id: DeathSoundId) => void;
    random?: () => number;
}

/**
 * The crash cue: `crash(run)` plays one randomly picked crash sound for the run object `run`
 * (the run's game state), once, however often it is called for that run, and only while the
 * arcade's sound toggle is on (`readMusicPref`). Returns the sound played, or `null`.
 */
export function createDeathCue({
    enabled = readMusicPref,
    play = (id) => void playDeathSound(id),
    random = Math.random,
}: DeathCueOptions = {}) {
    const sounded = new WeakSet<object>();
    return {
        crash(run: object): DeathSoundId | null {
            if (sounded.has(run)) return null;
            sounded.add(run);
            if (!enabled()) return null;
            const id = pickDeathSound(random);
            play(id);
            return id;
        },
    };
}
