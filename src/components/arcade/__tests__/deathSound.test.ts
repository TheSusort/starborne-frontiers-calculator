import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    createDeathAudio,
    createDeathCue,
    DEATH_SOUNDS,
    DeathSoundId,
    pickDeathSound,
    playDeathSound,
} from '../deathSound';
import { DEATH_TIMING } from '../deathSequence';
import { writeMusicPref } from '../musicPref';

/** An `AudioParam` that accepts every automation call. */
const param = () => ({
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
});

/** A Web Audio context that records the sources it starts. */
function fakeContext(state: AudioContextState = 'running') {
    const starts: { kind: string; at: number }[] = [];
    const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
    const source = (kind: string) => ({
        ...node(),
        start: vi.fn((at: number) => starts.push({ kind, at })),
        stop: vi.fn(),
    });
    const ctx = {
        state,
        currentTime: 10,
        sampleRate: 8000,
        destination: node(),
        resume: vi.fn(() => Promise.resolve()),
        createGain: () => ({ ...node(), gain: param() }),
        createBiquadFilter: () => ({ ...node(), type: '', frequency: param(), Q: param() }),
        createDelay: () => ({ ...node(), delayTime: param() }),
        createOscillator: () => ({
            ...source('oscillator'),
            type: '',
            frequency: param(),
            detune: param(),
        }),
        createBufferSource: () => ({ ...source('noise'), buffer: null }),
        createBuffer: (_channels: number, length: number) => {
            const data = new Float32Array(length);
            return { getChannelData: () => data };
        },
    };
    return { ctx: ctx as unknown as AudioContext, raw: ctx, starts };
}

describe('pickDeathSound', () => {
    it('picks each sound across the random range', () => {
        expect(pickDeathSound(() => 0)).toBe(DEATH_SOUNDS[0]);
        expect(pickDeathSound(() => 0.5)).toBe(DEATH_SOUNDS[1]);
        expect(pickDeathSound(() => 0.999)).toBe(DEATH_SOUNDS[2]);
        expect(pickDeathSound(() => 1)).toBe(DEATH_SOUNDS[2]);
    });
});

describe('playDeathSound', () => {
    for (const id of DEATH_SOUNDS) {
        it(`schedules ${id} from now and ends it before the game-over panel`, () => {
            const { ctx, starts } = fakeContext();
            const audio = createDeathAudio(() => ctx);
            const seconds = playDeathSound(id, audio);
            expect(seconds).toBeGreaterThan(1);
            expect(seconds).toBeLessThan(2.5);
            expect(seconds).toBeLessThan(DEATH_TIMING.panelAt);
            expect(starts.length).toBeGreaterThan(0);
            for (const { at } of starts) expect(at).toBeGreaterThanOrEqual(ctx.currentTime);
        });
    }

    it('opens with a burst of noise for the boom and the spiral, not for the trombone', () => {
        const kinds = (id: DeathSoundId) => {
            const { ctx, starts } = fakeContext();
            playDeathSound(
                id,
                createDeathAudio(() => ctx)
            );
            return new Set(starts.map((s) => s.kind));
        };
        expect(kinds('trombone').has('noise')).toBe(false);
        expect(kinds('spiral').has('noise')).toBe(true);
        expect(kinds('gameOver').has('noise')).toBe(true);
    });

    it('resumes a context the browser suspended', () => {
        const { ctx, raw } = fakeContext('suspended');
        playDeathSound(
            'spiral',
            createDeathAudio(() => ctx)
        );
        expect(raw.resume).toHaveBeenCalled();
    });

    it('plays nothing, and does not throw, without Web Audio', () => {
        expect(createDeathAudio(() => null)).toBeNull();
        expect(
            createDeathAudio(() => {
                throw new Error('no audio');
            })
        ).toBeNull();
        expect(playDeathSound('trombone', null)).toBe(0);
        // jsdom has no AudioContext, so the shared audio is absent too.
        expect(playDeathSound('gameOver')).toBe(0);
    });
});

describe('createDeathCue', () => {
    afterEach(() => localStorage.clear());

    it('plays one picked sound per run, however often the run crashes', () => {
        const play = vi.fn();
        const cue = createDeathCue({ enabled: () => true, play, random: () => 0.5 });
        const run = {};
        expect(cue.crash(run)).toBe(DEATH_SOUNDS[1]);
        expect(cue.crash(run)).toBeNull();
        expect(play).toHaveBeenCalledTimes(1);
        expect(play).toHaveBeenCalledWith(DEATH_SOUNDS[1]);
        expect(cue.crash({})).toBe(DEATH_SOUNDS[1]);
        expect(play).toHaveBeenCalledTimes(2);
    });

    it('picks afresh at every death', () => {
        const draws = [0, 0.4, 0.9];
        const play = vi.fn();
        const cue = createDeathCue({ enabled: () => true, play, random: () => draws.shift() ?? 0 });
        for (let i = 0; i < 3; i++) cue.crash({});
        expect(play.mock.calls.map(([id]) => id)).toEqual([...DEATH_SOUNDS]);
    });

    it('stays silent while the arcade sound is off, read at each crash', () => {
        const play = vi.fn();
        const cue = createDeathCue({ play, random: () => 0 });
        writeMusicPref(false);
        expect(cue.crash({})).toBeNull();
        writeMusicPref(true);
        expect(cue.crash({})).toBe(DEATH_SOUNDS[0]);
        expect(play).toHaveBeenCalledTimes(1);
    });

    it('does not play a run that crashed while the sound was off once it is turned on', () => {
        const play = vi.fn();
        let on = false;
        const cue = createDeathCue({ enabled: () => on, play });
        const run = {};
        cue.crash(run);
        on = true;
        expect(cue.crash(run)).toBeNull();
        expect(play).not.toHaveBeenCalled();
    });
});
