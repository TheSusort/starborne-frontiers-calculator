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

const FINAL_TRANSMISSION = `[PLACEHOLDER — awaiting dev lore]\n\nThe mechanisms. The Bludgeon. The blockade. The signal.\n\nFour pieces. One answer.\n\nIt came through before the blockade was established.\n\nIt has been here the whole time.\n\nIt is patient.`;

type Mode = 'index' | 'detail';

export default function ClassifiedPage() {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const navigate = useNavigate();
    const [unlocked, setUnlocked] = useState<string[]>(() => readUnlocked());
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [inputs, setInputs] = useState<Record<string, string>>({});
    const [errors, setErrors] = useState<Record<string, boolean>>({});
    const [decrypting, setDecrypting] = useState<Record<string, boolean>>({});
    const [barProgress, setBarProgress] = useState<Record<string, number>>({});

    const intervalsRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});

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

    const unlockedCount = unlocked.length;
    const allUnlocked = unlockedCount === CLASSIFIED_FRAGMENTS.length;
    const staticOpacity = OPACITY_BY_UNLOCKED[Math.min(unlockedCount, 4)];

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
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

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const navigateToIndex = useCallback(() => {
        setMode('index');
        setActiveFragmentId(null);
    }, []);

    const activeFragment = activeFragmentId
        ? (CLASSIFIED_FRAGMENTS.find((f) => f.id === activeFragmentId) ?? null)
        : null;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const detailIsUnlocked = activeFragmentId ? unlocked.includes(activeFragmentId) : false;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const detailIsDecrypting = activeFragmentId ? (decrypting[activeFragmentId] ?? false) : false;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const detailProgress = activeFragmentId ? (barProgress[activeFragmentId] ?? 0) : 0;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const detailHasError = activeFragmentId ? (errors[activeFragmentId] ?? false) : false;

    return (
        <>
            <Seo
                title="CLASSIFIED — STARBORNE PLANNER"
                description="Abyss Incident — Classified Archive"
                noIndex
            />
            <div className="not-found-scanlines fixed inset-0 z-[110] font-secondary overflow-y-auto">
                {/* Background layers */}
                <div className="absolute inset-0 bg-[url('/images/Deep_crevasse_01_extended.webp')] bg-cover bg-top" />
                <div className="absolute inset-0 bg-[url('/images/BG2.png')] bg-cover opacity-[0.15] mix-blend-screen" />
                <div className="absolute inset-0 bg-black/60" />

                {/* Corruption static overlay */}
                <div
                    className={`classified-static absolute inset-0 mix-blend-overlay ${staticOpacity}`}
                />

                {/* Content */}
                <div className="relative z-10 flex flex-col items-center min-h-full p-4 py-12">
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
                                                className={`flex items-center justify-between py-0.5 cursor-pointer ${
                                                    isFocused
                                                        ? 'bg-green-950/30 border-l-2 border-green-400 -mx-4 px-[14px]'
                                                        : 'pl-5'
                                                }`}
                                                onMouseEnter={() => setCursorIndex(i)}
                                                onClick={() => navigateToFragment(i)}
                                            >
                                                <span className="font-mono text-xs tracking-widest flex items-center gap-2">
                                                    <span
                                                        className={`w-3 shrink-0 text-green-400 ${isFocused ? '' : 'invisible'}`}
                                                    >
                                                        ▶
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

                        {/* DETAIL SCREEN — implemented in Task 4 */}
                        {mode === 'detail' && activeFragment && (
                            <div key={activeFragmentId} className="classified-decode">
                                <p className="font-mono text-xs text-gray-500">Loading fragment…</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}
