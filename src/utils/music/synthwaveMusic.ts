export const SYNTHWAVE_TRACKS = [
    '/audio/disco.mp3',
    '/audio/disco2.mp3',
    '/audio/disco3.mp3',
    '/audio/disco4.mp3',
] as const;

export type SynthwaveTrack = (typeof SYNTHWAVE_TRACKS)[number];

const VOLUME = 0.3;

/** The slice of `HTMLAudioElement` the controller drives; tests supply a fake. */
export interface AudioLike {
    src: string;
    volume: number;
    preload: string;
    currentTime: number;
    readonly paused: boolean;
    play(): Promise<void> | void;
    pause(): void;
    addEventListener(type: 'ended', listener: () => void): void;
    removeEventListener(type: 'ended', listener: () => void): void;
}

/** Where playback is: the current track, its position in seconds and whether it is audibly
 *  playing (requested and not paused by the browser). */
export interface MusicClock {
    track: SynthwaveTrack;
    time: number;
    playing: boolean;
}

export interface MusicSnapshot {
    isPlaying: boolean;
    trackTitle: string;
}

/** "/audio/disco2.mp3" -> "Disco 2". */
export function trackTitleOf(src: string): string {
    const name = (src.split('/').pop() ?? '').replace(/\.[^.]+$/, '');
    const m = /^([a-z]+?)(\d*)$/i.exec(name);
    if (!m) return name;
    const word = m[1].charAt(0).toUpperCase() + m[1].slice(1);
    return m[2] ? `${word} ${m[2]}` : word;
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

/** One shared playlist player: a shuffled loop of the soundtrack. `isPlaying` is the requested
 *  state, reverted when the browser refuses playback. */
export function createMusicController(
    makeAudio: () => AudioLike = () => new Audio(),
    random: () => number = Math.random
) {
    const tracks = shuffled(SYNTHWAVE_TRACKS, random);
    let index = 0;
    let audio: AudioLike | null = null;
    let snapshot: MusicSnapshot = { isPlaying: false, trackTitle: trackTitleOf(tracks[0]) };
    const listeners = new Set<() => void>();

    const publish = (next: Partial<MusicSnapshot>) => {
        snapshot = { ...snapshot, ...next };
        listeners.forEach((l) => l());
    };

    const start = (a: AudioLike) => {
        try {
            void Promise.resolve(a.play()).catch(() => publish({ isPlaying: false }));
        } catch {
            publish({ isPlaying: false });
        }
    };

    const advance = () => {
        index = (index + 1) % tracks.length;
        if (audio) audio.src = tracks[index];
        publish({ trackTitle: trackTitleOf(tracks[index]) });
    };

    const onEnded = () => {
        advance();
        if (audio) start(audio);
    };

    const ensureAudio = (): AudioLike => {
        if (!audio) {
            audio = makeAudio();
            audio.preload = 'none';
            audio.src = tracks[index];
            audio.volume = VOLUME;
            audio.addEventListener('ended', onEnded);
        }
        return audio;
    };

    return {
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        getSnapshot: () => snapshot,
        /** Writes the playback position into `out` and returns it; it reads the audio element
         *  directly, so a per-frame caller neither re-renders nor allocates. */
        clock(out: MusicClock): MusicClock {
            out.track = tracks[index];
            out.time = audio ? audio.currentTime : 0;
            out.playing = snapshot.isPlaying && !!audio && !audio.paused;
            return out;
        },
        play() {
            if (snapshot.isPlaying) return;
            publish({ isPlaying: true });
            start(ensureAudio());
        },
        pause() {
            if (!snapshot.isPlaying) return;
            audio?.pause();
            publish({ isPlaying: false });
        },
        toggle() {
            if (snapshot.isPlaying) this.pause();
            else this.play();
        },
        /** Skips to the next track, wrapping; keeps playing if it was playing. */
        next() {
            advance();
            if (snapshot.isPlaying && audio) start(audio);
        },
    };
}

export type MusicController = ReturnType<typeof createMusicController>;

let shared: MusicController | null = null;

/** The app-wide player; created on first use so importing this module never builds an `Audio`. */
export function getSynthwaveMusic(): MusicController {
    shared ??= createMusicController();
    return shared;
}
