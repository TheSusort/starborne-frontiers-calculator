import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Seo from '../components/seo/Seo';
import { Button } from '../components/ui';
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

export default function ClassifiedPage() {
    const navigate = useNavigate();
    const [unlocked, setUnlocked] = useState<string[]>(() => readUnlocked());
    const [inputs, setInputs] = useState<Record<string, string>>({});
    const [errors, setErrors] = useState<Record<string, boolean>>({});
    const [decrypting, setDecrypting] = useState<Record<string, boolean>>({});
    const [barProgress, setBarProgress] = useState<Record<string, number>>({});

    const unlockedCount = unlocked.length;
    const allUnlocked = unlockedCount === CLASSIFIED_FRAGMENTS.length;
    const staticOpacity = OPACITY_BY_UNLOCKED[Math.min(unlockedCount, 4)];

    function handleSubmit(fragmentId: string, authCode: string) {
        const input = (inputs[fragmentId] ?? '').trim().toUpperCase();
        if (input !== authCode.trim().toUpperCase()) {
            setErrors((e) => ({ ...e, [fragmentId]: true }));
            setTimeout(() => setErrors((e) => ({ ...e, [fragmentId]: false })), 800);
            return;
        }

        // Start decrypt bar animation
        setDecrypting((d) => ({ ...d, [fragmentId]: true }));
        let count = 0;
        const interval = setInterval(() => {
            count++;
            setBarProgress((p) => ({ ...p, [fragmentId]: count }));
            if (count >= BAR_TOTAL) {
                clearInterval(interval);
                const next = [...unlocked, fragmentId];
                setUnlocked(next);
                writeUnlocked(next);
                setDecrypting((d) => ({ ...d, [fragmentId]: false }));
            }
        }, 40);
    }

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
                <div className="relative z-10 flex flex-col items-center min-h-full p-4 py-12 gap-6">
                    {/* Header */}
                    <div className="max-w-2xl w-full card backdrop-blur-sm space-y-3">
                        <div className="text-[0.65rem] text-primary uppercase tracking-[0.3em]">
                            {'// STARBORNE PLANNER'}
                        </div>
                        <p className="classified-title-glitch font-mono text-sm font-bold tracking-[0.3em] uppercase text-primary">
                            {'> ABYSS INCIDENT — CLASSIFIED ARCHIVE'}
                        </p>
                        <p className="font-mono text-xs text-gray-500 tracking-widest">
                            {`[${unlockedCount}/${CLASSIFIED_FRAGMENTS.length} FRAGMENTS DECRYPTED]`}
                        </p>
                    </div>

                    {/* Fragment slots */}
                    {CLASSIFIED_FRAGMENTS.map((fragment) => {
                        const isUnlocked = unlocked.includes(fragment.id);
                        const isDecrypting = decrypting[fragment.id] ?? false;
                        const progress = barProgress[fragment.id] ?? 0;
                        const hasError = errors[fragment.id] ?? false;

                        return (
                            <div
                                key={fragment.id}
                                className="max-w-2xl w-full card backdrop-blur-sm relative overflow-hidden"
                            >
                                {/* Noise overlay on locked fragments */}
                                {!isUnlocked && !isDecrypting && (
                                    <div className="classified-fragment-noise absolute inset-0 z-0" />
                                )}

                                <div className="relative z-10 space-y-4">
                                    {isDecrypting ? (
                                        <div className="space-y-2 font-mono text-sm">
                                            <p className="text-green-400">{'> DECRYPTING...'}</p>
                                            <p className={fragment.barColorClass}>
                                                {`> ${'█'.repeat(progress)}${'░'.repeat(BAR_TOTAL - progress)}`}
                                            </p>
                                        </div>
                                    ) : isUnlocked ? (
                                        <div className="classified-decode space-y-4">
                                            <div className="flex items-center justify-between">
                                                <p
                                                    className={`font-mono text-xs font-bold tracking-widest uppercase ${fragment.barColorClass}`}
                                                >
                                                    {`> ${'█'.repeat(BAR_TOTAL)} [DECRYPTED]`}
                                                </p>
                                            </div>
                                            <div className="space-y-1">
                                                <p className="text-base font-bold tracking-widest uppercase text-primary">
                                                    {fragment.title}
                                                </p>
                                            </div>
                                            <div className="text-sm text-gray-400 space-y-3 font-mono">
                                                {fragment.body.split('\n\n').map((para, i) => (
                                                    <p key={i}>{para}</p>
                                                ))}
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="space-y-4">
                                            <p className="font-mono text-xs text-gray-600 tracking-widest uppercase">
                                                {`> ORIGIN FILE: ${fragment.hintLine} — FIELD AGENTS ONLY`}
                                            </p>
                                            <p
                                                className={`font-mono text-xs ${hasError ? 'text-red-400' : 'text-gray-600'} tracking-widest`}
                                            >
                                                {hasError
                                                    ? '> [AUTHORIZATION FAILED]'
                                                    : '> ENTER AUTH CODE TO DECRYPT'}
                                            </p>
                                            <div className="flex gap-2 items-center font-mono text-sm">
                                                <span className="text-green-400 shrink-0">
                                                    {'>'}
                                                </span>
                                                <input
                                                    type="text"
                                                    maxLength={12}
                                                    placeholder="_ _ _ _ _ _"
                                                    value={inputs[fragment.id] ?? ''}
                                                    onChange={(e) =>
                                                        setInputs((i) => ({
                                                            ...i,
                                                            [fragment.id]: e.target.value,
                                                        }))
                                                    }
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter')
                                                            handleSubmit(
                                                                fragment.id,
                                                                fragment.authCode
                                                            );
                                                    }}
                                                    className={`bg-transparent border-b ${hasError ? 'border-red-500 text-red-400' : 'border-gray-600 text-green-400'} outline-none uppercase tracking-widest w-40 placeholder-gray-700 text-sm`}
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                />
                                                <Button
                                                    variant="secondary"
                                                    size="xs"
                                                    onClick={() =>
                                                        handleSubmit(fragment.id, fragment.authCode)
                                                    }
                                                >
                                                    SUBMIT
                                                </Button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}

                    {/* Final transmission — 4/4 only */}
                    {allUnlocked && (
                        <div className="max-w-2xl w-full card backdrop-blur-sm classified-decode space-y-4">
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

                    {/* Footer nav */}
                    <div className="max-w-2xl w-full flex justify-center">
                        <Button variant="secondary" onClick={() => void navigate('/')}>
                            Return to Base
                        </Button>
                    </div>
                </div>
            </div>
        </>
    );
}
