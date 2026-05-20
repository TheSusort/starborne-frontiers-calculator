import { useState, useEffect, useRef, useCallback } from 'react';

export interface PlayItem {
    id: string;
    text: string;
    onStart?: () => void; // called when this item begins speaking (used for desktop reader pane auto-select)
}

export interface LoreAudioPlayer {
    supported: boolean;
    isPlaying: boolean;
    isPlayingAll: boolean;
    playingId: string | null;
    play: (id: string, text: string) => void;
    stop: () => void;
    playAll: (items: PlayItem[]) => void;
}

const NOOP_PLAYER: LoreAudioPlayer = {
    supported: false,
    isPlaying: false,
    isPlayingAll: false,
    playingId: null,
    play: () => {},
    stop: () => {},
    playAll: () => {},
};

function selectVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
    return (
        voices.find((v) => v.name.includes('Michelle Online (Natural)')) ??
        voices.find((v) => v.lang === 'en-US' && /female/i.test(v.name)) ??
        voices.find((v) => v.lang === 'en-US') ??
        null
    );
}

export function useLoreAudioPlayer(): LoreAudioPlayer {
    const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;

    const [isPlaying, setIsPlaying] = useState(false);
    const [isPlayingAll, setIsPlayingAll] = useState(false);
    const [playingId, setPlayingId] = useState<string | null>(null);

    const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
    const cancelledRef = useRef(false);
    const playingAllKeyRef = useRef('');

    useEffect(() => {
        if (!supported) return;

        const tryLoadVoice = () => {
            const voices = window.speechSynthesis.getVoices();
            if (voices.length > 0) voiceRef.current = selectVoice(voices);
        };

        tryLoadVoice(); // eager — works on Chrome
        window.speechSynthesis.onvoiceschanged = tryLoadVoice; // async — works on Firefox/Safari

        return () => {
            window.speechSynthesis.onvoiceschanged = null;
            cancelledRef.current = true;
            window.speechSynthesis.cancel();
        };
    }, [supported]);

    // Stable helper — no state deps, so never recreates after mount.
    // onChainNext is provided by playAll to continue the sequence;
    // omitted by play() for single-item playback.
    const speakItem = useCallback(
        (id: string, text: string, onChainNext?: () => void) => {
            cancelledRef.current = false;
            const utterance = new SpeechSynthesisUtterance(text);
            if (voiceRef.current) utterance.voice = voiceRef.current;

            utterance.onstart = () => {
                setIsPlaying(true);
                setPlayingId(id);
            };

            utterance.onend = () => {
                // cancel() also fires onend — guard against continuing the chain.
                if (cancelledRef.current) return;
                if (onChainNext) {
                    onChainNext();
                } else {
                    setIsPlaying(false);
                    setPlayingId(null);
                }
            };

            utterance.onerror = (e) => {
                if (e.error === 'canceled') return; // expected from stop()
                setIsPlaying(false);
                setIsPlayingAll(false);
                setPlayingId(null);
            };

            window.speechSynthesis.speak(utterance);
        },
        [] // intentionally empty — only uses refs and stable state setters
    );

    // Stable chain runner used by playAll.
    const chainPlay = useCallback(
        (items: PlayItem[], index: number) => {
            if (index >= items.length) {
                setIsPlaying(false);
                setIsPlayingAll(false);
                setPlayingId(null);
                playingAllKeyRef.current = '';
                return;
            }
            const item = items[index];
            item.onStart?.(); // e.g. auto-select in desktop reader pane
            speakItem(item.id, item.text, () => chainPlay(items, index + 1));
        },
        [speakItem]
    );

    const stop = useCallback(() => {
        if (!supported) return;
        cancelledRef.current = true;
        window.speechSynthesis.cancel();
        setIsPlaying(false);
        setIsPlayingAll(false);
        setPlayingId(null);
        playingAllKeyRef.current = '';
    }, [supported]);

    const play = useCallback(
        (id: string, text: string) => {
            if (!supported) return;
            // Toggle: clicking the same item again stops it.
            if (playingId === id && isPlaying) {
                stop();
                return;
            }
            cancelledRef.current = true;
            window.speechSynthesis.cancel();
            setIsPlayingAll(false);
            playingAllKeyRef.current = '';
            speakItem(id, text);
        },
        [supported, playingId, isPlaying, stop, speakItem]
    );

    const playAll = useCallback(
        (items: PlayItem[]) => {
            if (!supported || items.length === 0) return;
            const key = items.map((i) => i.id).join(',');
            // Toggle: clicking Play All while the same list is playing stops it.
            if (isPlayingAll && playingAllKeyRef.current === key) {
                stop();
                return;
            }
            cancelledRef.current = true;
            window.speechSynthesis.cancel();
            playingAllKeyRef.current = key;
            setIsPlayingAll(true);
            chainPlay(items, 0);
        },
        [supported, isPlayingAll, stop, chainPlay]
    );

    if (!supported) return NOOP_PLAYER;

    return { supported: true, isPlaying, isPlayingAll, playingId, play, stop, playAll };
}
