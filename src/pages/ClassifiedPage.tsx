import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Seo from '../components/seo/Seo';
import { CLASSIFIED_FRAGMENTS, readUnlocked, writeUnlocked } from '../constants/classifiedArchive';

const BAR_TOTAL = 22;

const OPACITY_BY_UNLOCKED: Record<number, string> = {
    0: 'opacity-60',
    1: 'opacity-40',
    2: 'opacity-25',
    3: 'opacity-10',
    4: 'opacity-0',
};

// Stored as +1 Caesar shift — each letter incremented by one
const FINAL_TRANSMISSION_ENCODED = `[QMBDFIPMEFS — bxbjujoh efw mpsf]\n\nUif nfdibojtnt. Uif Cmvehfpo. Uif cmpdlbef. Uif tjhobm.\n\nGpvs qjfdft. Pof botxfs.\n\nJu dbnf uispvhi cfgpsf uif cmpdlbef xbt ftubcmjtife.\n\nJu ibt cffo ifsf uif xipmf ujnf.\n\nJu jt qbujfou.`;

function decipherTransmission(text: string): string {
    return text.replace(/[a-zA-Z]/g, (c) => {
        const base = c >= 'a' ? 97 : 65;
        return String.fromCharCode(((c.charCodeAt(0) - base - 1 + 26) % 26) + base);
    });
}

const FINAL_TRANSMISSION = decipherTransmission(FINAL_TRANSMISSION_ENCODED);

type Mode = 'index' | 'detail';

export default function ClassifiedPage() {
    const navigate = useNavigate();
    const [unlocked, setUnlocked] = useState<string[]>(() => readUnlocked());
    const [inputs, setInputs] = useState<Record<string, string>>({});
    const [errors, setErrors] = useState<Record<string, boolean>>({});
    const [decrypting, setDecrypting] = useState<Record<string, boolean>>({});
    const [barProgress, setBarProgress] = useState<Record<string, number>>({});

    const intervalsRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});
    const flickerRef = useRef<HTMLDivElement>(null);

    // New state — two-screen model
    const [mode, setMode] = useState<Mode>('index');
    const [cursorIndex, setCursorIndex] = useState(0);
    const [activeFragmentId, setActiveFragmentId] = useState<string | null>(null);

    useEffect(() => {
        const intervals = intervalsRef.current;
        return () => {
            Object.values(intervals).forEach(clearInterval);
        };
    }, []);

    useEffect(() => {
        const flicker = flickerRef.current;
        const triggerBurst = () => {
            if (!flicker) return;
            flicker.classList.remove('not-found-burst-active');
            void flicker.offsetWidth;
            flicker.classList.add('not-found-burst-active');
        };
        const schedule = (): ReturnType<typeof setTimeout> =>
            setTimeout(
                () => {
                    triggerBurst();
                    timeoutRef = schedule();
                },
                3000 + Math.random() * 3000
            );
        const initialTimer = setTimeout(triggerBurst, 600);
        let timeoutRef = schedule();
        return () => {
            clearTimeout(initialTimer);
            clearTimeout(timeoutRef);
        };
    }, []);

    const unlockedCount = unlocked.length;
    const allUnlocked = unlockedCount === CLASSIFIED_FRAGMENTS.length;
    const staticOpacity = OPACITY_BY_UNLOCKED[Math.min(unlockedCount, 4)];

    const handleSubmit = useCallback(
        (fragmentId: string, authCode: string) => {
            const input = (inputs[fragmentId] ?? '').trim().toUpperCase();
            if (input !== authCode.trim().toUpperCase()) {
                setErrors((e) => ({ ...e, [fragmentId]: true }));
                setTimeout(() => setErrors((e) => ({ ...e, [fragmentId]: false })), 800);
                return;
            }
            setDecrypting((d) => ({ ...d, [fragmentId]: true }));
            let count = 0;
            const interval = setInterval(() => {
                count++;
                setBarProgress((p) => ({ ...p, [fragmentId]: count }));
                if (count >= BAR_TOTAL) {
                    clearInterval(interval);
                    setUnlocked((prev) => {
                        const next = [...prev, fragmentId];
                        writeUnlocked(next);
                        return next;
                    });
                    setDecrypting((d) => ({ ...d, [fragmentId]: false }));
                }
            }, 40);
            intervalsRef.current[fragmentId] = interval;
        },
        [inputs]
    );

    const navigateToFragment = useCallback((index: number) => {
        const fragment = CLASSIFIED_FRAGMENTS[index];
        setCursorIndex(index);
        setActiveFragmentId(fragment.id);
        setMode('detail');
    }, []);

    const navigateToIndex = useCallback(() => {
        setMode('index');
        setActiveFragmentId(null);
    }, []);

    useEffect(() => {
        function onKeyDown(e: KeyboardEvent) {
            if (mode === 'index') {
                if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setCursorIndex(
                        (i) => (i - 1 + CLASSIFIED_FRAGMENTS.length) % CLASSIFIED_FRAGMENTS.length
                    );
                } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setCursorIndex((i) => (i + 1) % CLASSIFIED_FRAGMENTS.length);
                } else if (e.key === 'Enter') {
                    navigateToFragment(cursorIndex);
                } else if (e.key === 'Escape') {
                    void navigate('/');
                }
            } else if (mode === 'detail' && activeFragmentId) {
                if (e.key === 'Escape') {
                    if (decrypting[activeFragmentId]) return;
                    navigateToIndex();
                } else if (e.key === 'Enter' && document.activeElement?.tagName !== 'INPUT') {
                    const fragment = CLASSIFIED_FRAGMENTS.find((f) => f.id === activeFragmentId);
                    if (
                        fragment &&
                        !unlocked.includes(activeFragmentId) &&
                        !decrypting[activeFragmentId]
                    ) {
                        handleSubmit(activeFragmentId, fragment.authCode);
                    }
                }
            }
        }
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [
        mode,
        cursorIndex,
        activeFragmentId,
        decrypting,
        unlocked,
        navigate,
        navigateToFragment,
        navigateToIndex,
        handleSubmit,
    ]);

    const activeFragment = activeFragmentId
        ? (CLASSIFIED_FRAGMENTS.find((f) => f.id === activeFragmentId) ?? null)
        : null;

    const detailIsUnlocked = activeFragmentId ? unlocked.includes(activeFragmentId) : false;
    const detailIsDecrypting = activeFragmentId ? (decrypting[activeFragmentId] ?? false) : false;
    const detailProgress = activeFragmentId ? (barProgress[activeFragmentId] ?? 0) : 0;
    const detailHasError = activeFragmentId ? (errors[activeFragmentId] ?? false) : false;

    return (
        <>
            <Seo title="CLASSIFIED" description="Abyss Incident — Classified Archive" noIndex />
            <div className="not-found-scanlines fixed inset-0 z-[110] font-secondary overflow-y-auto">
                {/* Background layers */}
                <div className="absolute inset-0 bg-[url('/images/Deep_crevasse_01_extended.webp')] bg-cover bg-top" />
                <div className="absolute inset-0 bg-[url('/images/BG2.png')] bg-cover opacity-[0.15] mix-blend-screen" />
                <div className="absolute inset-0 bg-black/60" />

                {/* VHS glitch burst */}
                <div
                    ref={flickerRef}
                    className="not-found-burst absolute inset-0 pointer-events-none bg-[url('/images/transition.webp')] bg-cover mix-blend-darken"
                />

                {/* Corruption static overlay */}
                <div
                    className={`classified-static absolute inset-0 mix-blend-overlay ${staticOpacity}`}
                />

                {/* Content */}
                <div className="relative z-10 flex items-center justify-center min-h-full p-4">
                    <div className="max-w-2xl w-full card backdrop-blur-sm">
                        {/* INDEX SCREEN */}
                        {mode === 'index' && (
                            <div key="index" className="classified-decode">
                                {/* Header */}
                                <div className="text-[0.65rem] text-gray-500 uppercase tracking-[0.3em]">
                                    {'// STARBORNE PLANNER'}
                                </div>
                                <p className="classified-title-glitch font-mono text-sm font-bold tracking-[0.3em] uppercase text-primary mt-1">
                                    {'> ABYSS INCIDENT — CLASSIFIED ARCHIVE'}
                                </p>
                                <p className="font-mono text-xs text-gray-500 tracking-widest mt-1 mb-3">
                                    {`[${unlockedCount}/${CLASSIFIED_FRAGMENTS.length} FRAGMENTS DECRYPTED]`}
                                </p>

                                <hr className="border-gray-800 mb-3" />

                                {/* Instruction hint */}
                                <p className="font-mono text-[0.65rem] text-gray-600 tracking-widest mb-3">
                                    {'USE ↑↓ TO NAVIGATE · ENTER OR CLICK TO ACCESS'}
                                </p>

                                {/* Fragment rows */}
                                <div>
                                    {CLASSIFIED_FRAGMENTS.map((fragment, i) => {
                                        const isFocused = cursorIndex === i;
                                        const isRowUnlocked = unlocked.includes(fragment.id);
                                        return (
                                            <div
                                                key={fragment.id}
                                                className={`flex items-center justify-between py-0.5 cursor-pointer ${isFocused ? 'bg-green-950/30' : ''}`}
                                                onMouseEnter={() => setCursorIndex(i)}
                                                onClick={() => navigateToFragment(i)}
                                            >
                                                <span className="font-mono text-xs tracking-widest flex items-center gap-2">
                                                    <span
                                                        className={`w-3 shrink-0 text-green-400 ${isFocused ? '' : 'invisible'}`}
                                                    >
                                                        {'>'}
                                                    </span>
                                                    <span className={fragment.barColorClass}>
                                                        {fragment.title.toUpperCase()}
                                                    </span>
                                                </span>
                                                <span
                                                    className={`font-mono text-[0.6rem] font-bold tracking-widest px-1 border ml-2 shrink-0 ${
                                                        isRowUnlocked
                                                            ? 'text-green-400 border-green-900 bg-green-950/50'
                                                            : 'text-red-400 border-red-900 bg-red-950/30'
                                                    }`}
                                                >
                                                    {isRowUnlocked ? 'DECRYPTED' : 'LOCKED'}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>

                                {/* Final transmission — 4/4 only, index mode only */}
                                {allUnlocked && (
                                    <div className="classified-decode mt-4 space-y-3">
                                        <hr className="border-gray-800" />
                                        <p className="font-mono text-xs text-red-500 tracking-widest uppercase font-bold">
                                            {'> FINAL TRANSMISSION — DECRYPTED'}
                                        </p>
                                        <p className="text-base font-bold tracking-widest uppercase text-primary">
                                            ARCHIVE COMPLETE
                                        </p>
                                        <div className="text-sm text-gray-400 space-y-3 font-mono">
                                            {FINAL_TRANSMISSION.split('\n\n').map((para, i) => (
                                                <p key={i}>{para}</p>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                <hr className="border-gray-800 mt-4 mb-2" />

                                {/* Footer key legend */}
                                <p className="font-mono text-[0.65rem] text-gray-600 tracking-widest">
                                    <span className="inline-block bg-black border border-gray-700 text-gray-500 text-[0.6rem] px-1 mr-0.5">
                                        ↑
                                    </span>
                                    <span className="inline-block bg-black border border-gray-700 text-gray-500 text-[0.6rem] px-1 mr-2">
                                        ↓
                                    </span>
                                    {'move · '}
                                    <span className="inline-block bg-black border border-gray-700 text-gray-500 text-[0.6rem] px-1 mx-1">
                                        ↵
                                    </span>
                                    {'open · '}
                                    <span className="inline-block bg-black border border-gray-700 text-gray-500 text-[0.6rem] px-1 mx-1">
                                        ESC
                                    </span>
                                    base
                                </p>
                            </div>
                        )}

                        {/* DETAIL SCREEN */}
                        {mode === 'detail' && activeFragment && (
                            <div key={activeFragmentId} className="classified-decode">
                                <div className="text-[0.65rem] text-gray-500 uppercase tracking-[0.3em]">
                                    {'// FRAGMENT ACCESS'}
                                </div>
                                <p
                                    className={`font-mono text-sm font-bold tracking-[0.3em] uppercase ${activeFragment.barColorClass} mt-1 mb-3`}
                                >
                                    {activeFragment.title.toUpperCase()}
                                </p>

                                {/* DECRYPTING STATE */}
                                {detailIsDecrypting && (
                                    <div className="space-y-1 font-mono text-xs">
                                        <p className="text-gray-500 tracking-widest">
                                            {'> STATUS: '}
                                            <span className="text-green-400">DECRYPTING...</span>
                                        </p>
                                        <hr className="border-gray-800 my-2" />
                                        <p className={activeFragment.barColorClass}>
                                            {`> ${'█'.repeat(detailProgress)}${'░'.repeat(BAR_TOTAL - detailProgress)} ${Math.round((detailProgress / BAR_TOTAL) * 100)}%`}
                                        </p>
                                        <hr className="border-gray-800 mt-3 mb-2" />
                                        <p className="text-gray-600 tracking-widest">{'— — —'}</p>
                                    </div>
                                )}

                                {/* UNLOCKED STATE */}
                                {!detailIsDecrypting && detailIsUnlocked && (
                                    <div>
                                        <p
                                            className={`font-mono text-xs tracking-widest ${activeFragment.barColorClass} mb-3`}
                                        >
                                            {`> ${'█'.repeat(BAR_TOTAL)} [DECRYPTED]`}
                                        </p>
                                        <hr className="border-gray-800 mb-3" />
                                        <div className="classified-decode text-sm text-gray-400 space-y-3 font-mono">
                                            {activeFragment.body.split('\n\n').map((para, i) => (
                                                <p key={i}>{para}</p>
                                            ))}
                                        </div>
                                        <hr className="border-gray-800 mt-3 mb-2" />
                                        <p className="font-mono text-[0.65rem] text-gray-600 tracking-widest">
                                            <span className="inline-block bg-black border border-gray-700 text-gray-500 text-[0.6rem] px-1 mr-1">
                                                ESC
                                            </span>
                                            back to index
                                        </p>
                                    </div>
                                )}

                                {/* LOCKED STATE */}
                                {!detailIsDecrypting && !detailIsUnlocked && (
                                    <div>
                                        <p className="font-mono text-xs text-gray-600 tracking-widest">
                                            {`> ORIGIN FILE: ${activeFragment.hintLine} — FIELD AGENTS ONLY`}
                                        </p>
                                        <p className="font-mono text-xs text-gray-600 tracking-widest mt-1">
                                            {'> STATUS: '}
                                            <span className="text-red-400">
                                                LOCKED — AUTH REQUIRED
                                            </span>
                                        </p>
                                        <hr className="border-gray-800 my-3" />
                                        <p
                                            className={`font-mono text-xs tracking-widest ${
                                                detailHasError ? 'text-red-400' : 'text-gray-500'
                                            }`}
                                        >
                                            {detailHasError
                                                ? '> [AUTHORIZATION FAILED]'
                                                : '> ENTER AUTH CODE TO DECRYPT'}
                                        </p>
                                        <div className="flex items-center gap-2 font-mono text-sm mt-2">
                                            <span className="text-green-400">{'>'}</span>
                                            <input
                                                type="text"
                                                maxLength={12}
                                                placeholder="_ _ _ _ _ _"
                                                value={inputs[activeFragment.id] ?? ''}
                                                onChange={(e) =>
                                                    setInputs((p) => ({
                                                        ...p,
                                                        [activeFragment.id]: e.target.value,
                                                    }))
                                                }
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter')
                                                        handleSubmit(
                                                            activeFragment.id,
                                                            activeFragment.authCode
                                                        );
                                                }}
                                                className={`bg-transparent border-b ${
                                                    detailHasError
                                                        ? 'border-red-500 text-red-400'
                                                        : 'border-gray-600 text-green-400'
                                                } outline-none uppercase tracking-widest w-40 placeholder-gray-700 text-sm`}
                                                autoComplete="off"
                                                spellCheck={false}
                                                autoFocus
                                            />
                                        </div>
                                        <hr className="border-gray-800 mt-3 mb-2" />
                                        <p className="font-mono text-[0.65rem] text-gray-600 tracking-widest">
                                            <span className="inline-block bg-black border border-gray-700 text-gray-500 text-[0.6rem] px-1 mr-0.5">
                                                ↵
                                            </span>
                                            {'submit · '}
                                            <span className="inline-block bg-black border border-gray-700 text-gray-500 text-[0.6rem] px-1 mx-1">
                                                ESC
                                            </span>
                                            back to index
                                        </p>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}
