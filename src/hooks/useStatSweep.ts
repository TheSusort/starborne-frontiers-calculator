import { useCallback, useEffect, useRef, useState } from 'react';
import type { GearPiece } from '../types/gear';
import type { BattleSimulationInput } from '../utils/calculators/battleSimulator';
import { runStatSweepAsync, sweepSteps, type SweepTarget } from '../utils/simulator/statSweep';
import { analyseSweep, type SweepPoint } from '../utils/simulator/sweepAnalysis';
import type { OverridableStat } from '../utils/simulator/statOverrides';

export interface UseStatSweepArgs {
    buildInput: () => BattleSimulationInput;
    getGearPiece?: (id: string) => GearPiece | undefined;
}

export interface RunSweepArgs {
    target: SweepTarget;
    stat: OverridableStat;
    from: number;
    to: number;
    step: number;
    /** The target's currently resolved value for `stat` — gear, refits, engineering AND any
     *  override already on the placement. Always becomes one of the steps, and every other step
     *  is measured against it. */
    resolved: number;
    baseSeed: number;
    count: number;
}

/** What produced the displayed `points`, frozen at the moment that sweep started. Read this
 *  rather than the live panel selections: a sweep result outlives every control that produced it,
 *  and a chart captioned from live state describes a configuration that never ran. */
export interface SweepProvenance {
    stat: OverridableStat;
    target: SweepTarget;
    baseSeed: number;
    count: number;
}

export interface UseStatSweepResult {
    points: SweepPoint[] | null;
    provenance: SweepProvenance | null;
    isSweeping: boolean;
    progress: { completed: number; total: number } | null;
    error: string | null;
    runSweep: (args: RunSweepArgs) => void;
    cancelSweep: () => void;
    clearSweep: () => void;
}

/**
 * Owns a stat sweep and nothing else.
 *
 * This hook writes none of the ordinary run state (`battleResult`, `aggregate`, `provenance`,
 * `baseline`, `divergence`). `useSimulatorRuns` supersedes runs through a generation ref, and a
 * sweep sharing that machinery would let either cancel the other's result — while a sweep is not
 * a run whose result can be pinned or replayed in the first place.
 *
 * It also ignores any pinned baseline: a sweep owns its seed set by construction, and its
 * reference is its own resolved-value step.
 */
export function useStatSweep({ buildInput, getGearPiece }: UseStatSweepArgs): UseStatSweepResult {
    const [points, setPoints] = useState<SweepPoint[] | null>(null);
    const [provenance, setProvenance] = useState<SweepProvenance | null>(null);
    const [isSweeping, setIsSweeping] = useState(false);
    const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);
    const [error, setError] = useState<string | null>(null);

    const abortRef = useRef<AbortController | null>(null);
    // Bumped at the start of every sweep and on unmount. A sweep in flight only writes state
    // while its generation is still current, so starting another sweep or unmounting supersedes
    // it.
    const generationRef = useRef(0);

    useEffect(
        () => () => {
            generationRef.current++;
            abortRef.current?.abort();
        },
        []
    );

    const runSweep = useCallback(
        (args: RunSweepArgs) => {
            setError(null);

            let steps;
            try {
                steps = sweepSteps(args.stat, args.from, args.to, args.step, args.resolved);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Invalid sweep range');
                return;
            }

            const input = buildInput();

            abortRef.current?.abort();
            const generation = ++generationRef.current;
            const isCurrent = () => generation === generationRef.current;

            const controller = new AbortController();
            abortRef.current = controller;

            setIsSweeping(true);
            setProgress({ completed: 0, total: steps.length * args.count });

            void runStatSweepAsync(
                input,
                args.target,
                args.stat,
                steps,
                args.baseSeed,
                args.count,
                {
                    getGearPiece,
                    signal: controller.signal,
                    onProgress: (completed, total) => {
                        if (!isCurrent()) return;
                        setProgress({ completed, total });
                    },
                }
            )
                .then((result) => {
                    if (!isCurrent()) return;
                    setIsSweeping(false);
                    setProgress(null);
                    // A cancelled sweep resolves null and produced nothing, so it must not blank
                    // whatever result is currently being read.
                    if (result === null) return;
                    setPoints(analyseSweep(result));
                    setProvenance({
                        stat: result.stat,
                        target: result.target,
                        baseSeed: result.baseSeed,
                        count: result.count,
                    });
                })
                .catch((err) => {
                    if (!isCurrent()) return;
                    setIsSweeping(false);
                    setProgress(null);
                    setError(err instanceof Error ? err.message : 'Sweep failed');
                });
        },
        [buildInput, getGearPiece]
    );

    const cancelSweep = useCallback(() => abortRef.current?.abort(), []);

    const clearSweep = useCallback(() => {
        abortRef.current?.abort();
        generationRef.current++;
        setPoints(null);
        setProvenance(null);
        setIsSweeping(false);
        setProgress(null);
        setError(null);
    }, []);

    return { points, provenance, isSweeping, progress, error, runSweep, cancelSweep, clearSweep };
}
