import { describe, it, expect, beforeAll } from 'vitest';
import {
    CALIBRATION_RESIDUAL_TOLERANCE,
    MIN_FILLER_POOL,
    baselineFillerPool,
    calibrationVerdict,
    minimizeDifferential,
    playerDifferential,
    runCalibration,
    scaleSubjectHp,
    SUBJECT_HP_SCALE,
} from '../interactionOracle';
import { buildTraceShip } from '../traceShipFactory';
import { loadShipSkillRecords, csvAvailable } from '../shipSkillCsv';
import { loadShipDataByName, shipDataAvailable } from '../shipDataSnapshot';
import { reachesAllies, tagShip } from '../../../src/utils/combat/audit/classes';
import { composeBattle, type TaggedShip } from '../../../src/utils/combat/audit/compose';
import { canonicalPlacement } from '../../../src/utils/combat/audit/fixtures';
import {
    EXCLUDED_KINDS,
    oracleFingerprint,
    oracleKind,
    restrictDiff,
} from '../../../src/utils/combat/audit/oracleKinds';
import { runSeededBattle } from '../../../src/utils/simulator/seededRuns';
import type {
    BattleResult,
    BattleSimulationInput,
} from '../../../src/utils/calculators/battleSimulator';
import type { CombatLogEntry, CombatLogEntryKind } from '../../../src/utils/combat/log/types';
import type { BattleRunner, FingerprintDiff } from '../../../src/utils/combat/audit/types';
import type { Ship } from '../../../src/types/ship';

const haveCorpus = csvAvailable() && shipDataAvailable();

let corpusCache: TaggedShip[] | null = null;
function corpus(): TaggedShip[] {
    if (corpusCache) return corpusCache;
    const namesByUpper = new Map<string, string>();
    for (const r of loadShipSkillRecords()) namesByUpper.set(r.name.toUpperCase(), r.name);
    for (const [upper, data] of loadShipDataByName()) {
        if (!namesByUpper.has(upper)) namesByUpper.set(upper, data.name);
    }
    const tagged: TaggedShip[] = [];
    for (const name of namesByUpper.values()) {
        const ship = buildTraceShip(name);
        if (ship) tagged.push({ ship, classes: tagShip(ship) });
    }
    corpusCache = tagged;
    return tagged;
}
const inertPool = (): Ship[] => baselineFillerPool(corpus());

/** A runner that records each arm's result. `playerDifferential` runs the composition arm
 *  first, then the baseline. */
function recordingRunner(): { run: BattleRunner; results: BattleResult[] } {
    const results: BattleResult[] = [];
    return {
        results,
        run: (input, seed) => {
            const r = runSeededBattle(input, seed);
            results.push(r);
            return r;
        },
    };
}

function mapEntries(
    entries: CombatLogEntry[],
    f: (e: CombatLogEntry) => CombatLogEntry | null
): CombatLogEntry[] {
    const out: CombatLogEntry[] = [];
    for (const e of entries) {
        const kept = f(e);
        if (kept) out.push({ ...kept, reactions: mapEntries(kept.reactions ?? [], f) });
    }
    return out;
}

/** `result` with every entry booked to `actorId` that the oracle reads as `kind` removed (a
 *  resisted attempt included), as if the engine never ran that part of its kit. */
function dropKind(result: BattleResult, actorId: string, kind: CombatLogEntryKind): BattleResult {
    const f = (e: CombatLogEntry) => (e.actorId === actorId && oracleKind(e) === kind ? null : e);
    return {
        ...result,
        combatLog: result.combatLog.map((round) => ({
            ...round,
            startOfRound: mapEntries(round.startOfRound, f),
            turns: round.turns.map((t) => ({ ...t, entries: mapEntries(t.entries, f) })),
            endOfRound: mapEntries(round.endOfRound, f),
        })),
    };
}

const playerId = (r: BattleResult, position: string) =>
    r.roster.find((x) => x.side === 'player' && x.position === position)!.actorId;

describe('scaleSubjectHp', () => {
    const ship = (id: string, hp: number): Ship =>
        ({ id, name: id, baseStats: { hp } }) as unknown as Ship;
    const input: BattleSimulationInput = {
        playerTeam: [
            canonicalPlacement(ship('a', 1000), 'T1'),
            canonicalPlacement(ship('b', 2000), 'T2'),
        ],
        enemyTeam: [canonicalPlacement(ship('e', 3000), 'M2')],
    };

    it('scales only the subject at the given index', () => {
        const scaled = scaleSubjectHp(input, 1);
        expect(scaled.playerTeam[1].statOverrides?.hp).toBe(2000 * SUBJECT_HP_SCALE);
        expect(scaled.playerTeam[0]).toBe(input.playerTeam[0]);
        expect(scaled.enemyTeam).toBe(input.enemyTeam);
    });
});

describe('minimizeDifferential', () => {
    const ship = (id: string): Ship => ({ id, name: id, baseStats: { hp: 1 } }) as unknown as Ship;
    const input: BattleSimulationInput = {
        playerTeam: ['subject', 'cause', 'bystander-1', 'bystander-2'].map((id, i) =>
            canonicalPlacement(ship(id), (['T1', 'T2', 'T3', 'T4'] as const)[i])
        ),
        enemyTeam: [canonicalPlacement(ship('enemy'), 'M2')],
    };
    const diffOf = (missing: CombatLogEntryKind[]): FingerprintDiff => ({
        actorId: 'x',
        shipName: 'subject',
        missingInComposition: missing,
        extraInComposition: [],
    });
    const original = diffOf(['heal']);

    it('keeps the ally the ORIGINAL finding depends on, even when dropping it leaves some other diff', () => {
        // Without `cause` the subject still differs, but on a different kind: a different
        // finding, so ddmin must not accept that reduction.
        const differentialOf = (candidate: BattleSimulationInput) =>
            candidate.playerTeam.some((p) => p.ship.id === 'cause')
                ? diffOf(['heal'])
                : diffOf(['buff']);
        const min = minimizeDifferential(input, 'subject', original, differentialOf);
        expect(min.playerTeam.map((p) => p.ship.id).sort()).toEqual(['cause', 'subject']);
    });
});

describe.skipIf(!haveCorpus)('playerDifferential on the real corpus', () => {
    beforeAll(() => {
        expect(inertPool().length).toBeGreaterThan(3);
    });

    it('scales the subject HP in BOTH arms and nobody else', () => {
        const compInput = composeBattle(1, corpus());
        const idx = compInput.playerTeam.length - 1;
        const { boards } = playerDifferential(idx, compInput, 1, inertPool());
        const original = compInput.playerTeam[idx].statOverrides!.hp!;
        expect(boards.comp.playerTeam[idx].statOverrides?.hp).toBe(original * SUBJECT_HP_SCALE);
        expect(boards.baseline.playerTeam[idx].statOverrides?.hp).toBe(original * SUBJECT_HP_SCALE);
        for (let i = 0; i < idx; i++) {
            expect(boards.comp.playerTeam[i]).toBe(compInput.playerTeam[i]);
        }
    });

    // The rate-gate RNG is keyed by actor id. Every slot — subject and stand-ins — must mint the
    // same id in both arms, so an ally's crit and landing rolls are the same dice in both.
    it('gives every player slot the same actor id in both arms', () => {
        let checked = 0;
        for (let seed = 1; seed <= 10; seed++) {
            const compInput = composeBattle(seed, corpus());
            if (compInput.playerTeam.length < 2) continue;
            const rec = recordingRunner();
            const { boards } = playerDifferential(0, compInput, seed, inertPool(), rec.run);
            const [comp, base] = rec.results;
            for (const p of boards.comp.playerTeam) {
                expect(playerId(base, p.position)).toBe(playerId(comp, p.position));
            }
            expect(boards.baseline.playerTeam[1].ship.name).not.toBe(
                compInput.playerTeam[1].ship.name
            );
            checked++;
        }
        expect(checked).toBeGreaterThan(0);
    });

    // Liveness for the test above: the stand-in's id is not cosmetic. Re-minting it from the
    // filler's OWN id changes which of its hits crit, on a real board.
    it('a stand-in rolling under its own id would crit on different hits', () => {
        const critTrail = (r: BattleResult, position: string): string => {
            const id = playerId(r, position);
            const out: string[] = [];
            const walkRows = (es: CombatLogEntry[]) => {
                for (const e of es) {
                    if (e.actorId === id && e.kind === 'attack') {
                        out.push(e.targets.map((t) => (t.didCrit ? 'C' : '.')).join(''));
                    }
                    walkRows(e.reactions ?? []);
                }
            };
            for (const round of r.combatLog) {
                walkRows(round.startOfRound);
                for (const t of round.turns) walkRows(t.entries);
                walkRows(round.endOfRound);
            }
            return out.join('|');
        };
        let differs = false;
        for (let seed = 1; seed <= 20 && !differs; seed++) {
            const compInput = composeBattle(seed, corpus());
            if (compInput.playerTeam.length < 2) continue;
            const { boards } = playerDifferential(0, compInput, seed, inertPool());
            const ownIds: BattleSimulationInput = {
                ...boards.baseline,
                playerTeam: boards.baseline.playerTeam.map((p, i) =>
                    i === 0 ? p : { ...p, ship: { ...p.ship, id: `own:${p.ship.name}` } }
                ),
            };
            const inherited = runSeededBattle(boards.baseline, seed);
            const own = runSeededBattle(ownIds, seed);
            const pos = boards.baseline.playerTeam[1].position;
            differs = critTrail(inherited, pos) !== critTrail(own, pos);
        }
        expect(differs).toBe(true);
    });

    // Derived, not pinned: the first placement whose two arms last a DIFFERENT number of rounds
    // and that reads a diff over all rounds but none inside the alive window. That is the false
    // positive the window exists to remove; asserting both halves keeps it from passing vacuously.
    it('reads only the alive window: a diff that lives past the shorter arm is not reported', () => {
        let found = false;
        for (let seed = 1; seed <= 60 && !found; seed++) {
            const compInput = composeBattle(seed, corpus());
            for (let idx = 0; idx < compInput.playerTeam.length && !found; idx++) {
                const rec = recordingRunner();
                const d = playerDifferential(idx, compInput, seed, inertPool(), rec.run);
                const [comp, base] = rec.results;
                if (!d.comparable || comp.rounds.length === base.rounds.length) continue;
                const pos = compInput.playerTeam[idx].position;
                const allComp = oracleFingerprint(comp, playerId(comp, pos));
                const allBase = oracleFingerprint(base, playerId(base, pos));
                const allRounds = restrictDiff({
                    actorId: 'x',
                    shipName: 'x',
                    missingInComposition: [...allBase].filter((k) => !allComp.has(k)),
                    extraInComposition: [...allComp].filter((k) => !allBase.has(k)),
                });
                if (allRounds === null || d.restricted !== null) continue;
                found = true;
                expect(d.window).toBeLessThan(Math.max(comp.rounds.length, base.rounds.length));
            }
        }
        expect(found).toBe(true);
    });

    // The instrument must still report a POSITIVE after the false-positive suppression. Plant a
    // defect in the composition arm only — the subject's own entries of one kind vanish, as if an
    // ally's presence stopped the engine running that part of its kit — and the oracle must see it.
    // The same plant on an EXCLUDED kind must stay silent, which shows the suppression is
    // selective rather than blind.
    it('reports a planted defect, and stays silent when the plant is an excluded kind', () => {
        let checked = false;
        for (let seed = 1; seed <= 60 && !checked; seed++) {
            const compInput = composeBattle(seed, corpus());
            // One player ship: the baseline IS the composition, so the plant would hit both arms.
            if (compInput.playerTeam.length < 2) continue;
            for (let idx = 0; idx < compInput.playerTeam.length && !checked; idx++) {
                const rec = recordingRunner();
                const clean = playerDifferential(idx, compInput, seed, inertPool(), rec.run);
                if (!clean.comparable || clean.restricted !== null) continue;
                const [comp, base] = rec.results;
                const subjectId = playerId(comp, compInput.playerTeam[idx].position);
                const inBase = oracleFingerprint(base, subjectId, clean.window);
                // Kinds the subject shows in BOTH arms, so removing one from the composition
                // arm is guaranteed to open a diff.
                const kinds = [...oracleFingerprint(comp, subjectId, clean.window)].filter((k) =>
                    inBase.has(k)
                );
                const own = kinds.find((k) => k !== 'attack' && !EXCLUDED_KINDS.has(k));
                const excluded = kinds.find((k) => EXCLUDED_KINDS.has(k));
                if (!own || !excluded) continue;

                const plant =
                    (kind: CombatLogEntryKind): BattleRunner =>
                    (input, s) => {
                        const r = runSeededBattle(input, s);
                        const isComp = input.playerTeam.every(
                            (p, i) => p.ship.name === compInput.playerTeam[i].ship.name
                        );
                        return isComp ? dropKind(r, subjectId, kind) : r;
                    };

                const planted = playerDifferential(idx, compInput, seed, inertPool(), plant(own));
                expect(planted.restricted?.missingInComposition).toContain(own);
                // Neither drift rule may swallow it: the kind is gone from the composition arm
                // for good, and both baselines show it.
                expect(planted.reported?.missingInComposition).toContain(own);
                expect(planted.demoted).toEqual([]);

                const plantedExcluded = playerDifferential(
                    idx,
                    compInput,
                    seed,
                    inertPool(),
                    plant(excluded)
                );
                expect(plantedExcluded.raw?.missingInComposition).toContain(excluded);
                expect(plantedExcluded.restricted).toBeNull();
                checked = true;
            }
        }
        expect(checked).toBe(true);
    });
});

describe.skipIf(!haveCorpus)('playerDifferential: second filler draw', () => {
    const names = (input: BattleSimulationInput) =>
        input.playerTeam.map((p) => p.ship.name).join('|');
    /** A fake `steal` row booked to the subject in round 1, added to the arms `pick` selects. */
    const plantStealIn =
        (pick: (input: BattleSimulationInput) => boolean, subjectPosition: string): BattleRunner =>
        (input, s) => {
            const r = runSeededBattle(input, s);
            if (!pick(input)) return r;
            const fake: CombatLogEntry = {
                kind: 'steal',
                actorId: playerId(r, subjectPosition),
                targets: [],
                reactions: [],
            };
            return {
                ...r,
                combatLog: r.combatLog.map((round, i) =>
                    i === 0 ? { ...round, startOfRound: [...round.startOfRound, fake] } : round
                ),
            };
        };

    /** The first placement that compares cleanly, has a distinct second draw, and never steals. */
    function cleanPlacement() {
        for (let seed = 1; seed <= 60; seed++) {
            const compInput = composeBattle(seed, corpus());
            if (compInput.playerTeam.length < 2) continue;
            for (let idx = 0; idx < compInput.playerTeam.length; idx++) {
                const rec = recordingRunner();
                const d = playerDifferential(idx, compInput, seed, inertPool(), rec.run);
                if (!d.comparable || d.restricted !== null || !d.boards.secondBaseline) continue;
                const subjectPosition = compInput.playerTeam[idx].position;
                const [comp] = rec.results;
                if (oracleFingerprint(comp, playerId(comp, subjectPosition)).has('steal')) continue;
                return { seed, idx, compInput, d, subjectPosition };
            }
        }
        throw new Error('no clean placement with a distinct second draw in seeds 1-60');
    }

    it('draws different stand-ins for the second baseline, keeping the subject and the enemies', () => {
        const { d, idx } = cleanPlacement();
        const second = d.boards.secondBaseline!;
        expect(names(second)).not.toBe(names(d.boards.baseline));
        expect(second.playerTeam[idx]).toBe(d.boards.baseline.playerTeam[idx]);
        expect(second.enemyTeam).toEqual(d.boards.baseline.enemyTeam);
    });

    it('demotes a kind only the FIRST draw of stand-ins produces', () => {
        const { seed, idx, compInput, d, subjectPosition } = cleanPlacement();
        const firstOnly = names(d.boards.baseline);
        const r = playerDifferential(
            idx,
            compInput,
            seed,
            inertPool(),
            plantStealIn((input) => names(input) === firstOnly, subjectPosition)
        );
        expect(r.restricted?.missingInComposition).toEqual(['steal']);
        expect(r.demoted).toEqual([{ kind: 'steal', sign: '-', reason: 'filler' }]);
        expect(r.reported).toBeNull();
    });

    it('keeps a kind BOTH draws produce and the composition does not', () => {
        const { seed, idx, compInput, d, subjectPosition } = cleanPlacement();
        const baselines = new Set([names(d.boards.baseline), names(d.boards.secondBaseline!)]);
        const r = playerDifferential(
            idx,
            compInput,
            seed,
            inertPool(),
            plantStealIn((input) => baselines.has(names(input)), subjectPosition)
        );
        expect(r.reported?.missingInComposition).toEqual(['steal']);
        expect(r.demoted).toEqual([]);
    });
});

describe.skipIf(!haveCorpus)('baselineFillerPool', () => {
    const named = (name: string): TaggedShip => {
        const t = corpus().find((c) => c.ship.name === name);
        if (!t) throw new Error(`${name} missing from the corpus`);
        return t;
    };
    const pad = (n: number): TaggedShip[] =>
        corpus()
            .filter((t) => t.classes.size === 0 && !reachesAllies(t.ship))
            .slice(0, n);

    it('rejects a supportive filler: Tormenter is class-inert but buffs adjacent allies', () => {
        const tormenter = named('Tormenter');
        expect(tormenter.classes.size).toBe(0);
        expect(reachesAllies(tormenter.ship)).toBe(true);
        const pool = baselineFillerPool([tormenter, ...corpus()]);
        expect(pool.some((s) => s.id === tormenter.ship.id)).toBe(false);
    });

    it('keeps a plain attacker', () => {
        expect(baselineFillerPool(corpus()).some((s) => s.name === 'Bedrock')).toBe(true);
    });

    it('never offers an ally-reaching or class-tagged ship over the real corpus', () => {
        const ids = new Set(baselineFillerPool(corpus()).map((s) => s.id));
        for (const t of corpus()) {
            if (t.classes.size > 0 || reachesAllies(t.ship)) expect(ids.has(t.ship.id)).toBe(false);
        }
    });

    it('keeps a usable minimum size over the real corpus', () => {
        expect(baselineFillerPool(corpus()).length).toBeGreaterThanOrEqual(MIN_FILLER_POOL);
    });

    it('throws when too few fillers remain', () => {
        expect(() => baselineFillerPool(pad(MIN_FILLER_POOL - 1))).toThrow(/need at least/);
        expect(baselineFillerPool(pad(MIN_FILLER_POOL))).toHaveLength(MIN_FILLER_POOL);
    });
});

describe('calibrationVerdict', () => {
    const residualDiff: FingerprintDiff = {
        actorId: 'x',
        shipName: 'Rys',
        missingInComposition: [],
        extraInComposition: ['buff'],
    };
    const excludedOnly: FingerprintDiff = { ...residualDiff, extraInComposition: ['buff-expired'] };
    const diffs = (n: number) => Array.from({ length: n }, () => residualDiff);

    it('passes at the tolerance: 1 residual in 100 comparable placements is 1%', () => {
        const v = calibrationVerdict(diffs(1), 100);
        expect(v.rate).toBeCloseTo(0.01);
        expect(v.passed).toBe(true);
    });

    it('fails just above it: 2 residuals in 100 comparable placements', () => {
        expect(calibrationVerdict(diffs(2), 100).passed).toBe(false);
    });

    it('does not count a diff the exclusion set empties', () => {
        const v = calibrationVerdict([...diffs(1), excludedOnly, excludedOnly], 100);
        expect(v.residual).toHaveLength(1);
        expect(v.passed).toBe(true);
    });

    it('defaults to CALIBRATION_RESIDUAL_TOLERANCE', () => {
        expect(CALIBRATION_RESIDUAL_TOLERANCE).toBe(0.01);
    });
});

describe.skipIf(!haveCorpus)('runCalibration', () => {
    it('passes on the inert battery, and compares most placements', () => {
        const r = runCalibration(corpus(), 1, 3);
        expect(r.passed).toBe(true);
        expect(r.tolerance).toBe(CALIBRATION_RESIDUAL_TOLERANCE);
        expect(r.comparablePlacements).toBeGreaterThan(r.placementsChecked / 2);
    });

    // An inert battery where every placement shows a non-excluded diff is far over tolerance: the
    // gate must fail and name the residual. The exclusion set is never widened to absorb it.
    it('fails loudly on a residual over tolerance instead of widening the exclusion set', () => {
        const before = [...EXCLUDED_KINDS];
        // A stand-in keeps the id of the ship it replaces, so only the composition arm has every
        // player ship under its own id. Both baselines stay untouched.
        const idByName = new Map(corpus().map((t) => [t.ship.name, t.ship.id] as const));
        const plantSteal: BattleRunner = (input, s) => {
            const r = runSeededBattle(input, s);
            const isComp = input.playerTeam.every((p) => idByName.get(p.ship.name) === p.ship.id);
            if (!isComp) return r;
            const players = r.roster.filter((x) => x.side === 'player').map((x) => x.actorId);
            const fake: CombatLogEntry[] = players.map((actorId) => ({
                kind: 'steal',
                actorId,
                targets: [],
                reactions: [],
            }));
            return {
                ...r,
                combatLog: r.combatLog.map((round, i) =>
                    i === 0 ? { ...round, startOfRound: [...round.startOfRound, ...fake] } : round
                ),
            };
        };
        const r = runCalibration(corpus(), 1, 2, plantSteal);
        expect(r.passed).toBe(false);
        expect(r.residualRate).toBeGreaterThan(CALIBRATION_RESIDUAL_TOLERANCE);
        expect(r.residual.length).toBeGreaterThan(0);
        expect(r.residual.every((d) => d.extraInComposition.includes('steal'))).toBe(true);
        expect(r.detail).toContain('+steal');
        expect([...EXCLUDED_KINDS]).toEqual(before);
    });

    it('fails when no inert placement was comparable, instead of passing on a 0% rate', () => {
        const r = runCalibration(corpus(), 1, 0);
        expect(r.comparablePlacements).toBe(0);
        expect(r.passed).toBe(false);
        expect(r.detail).toContain('measured nothing');
    });
});
