import { describe, it, expect, afterEach, vi } from 'vitest';
import {
    scorePieceForRole,
    computePriority,
    competitionRank,
    TIE_EPSILON,
    buildCoverageMatrix,
    mainStatTypesForSlot,
    getIdealMarginal,
    getIdealMaxGuard,
    describeIdealPiece,
    COVERAGE_MIN_LEVEL,
    COVERAGE_SAMPLE_SIZE,
    resetIdealPieceCachesForTests,
} from '../roleSlotCoverage';
import { GearPiece } from '../../../types/gear';
import { calculateRoleScore } from '../../autogear/priorityScore';
import { ROLE_BASE_STATS } from '../../../constants/roleBaseStats';
import { SHIP_TYPES, ShipTypeName } from '../../../constants/shipTypes';
import { GEAR_SLOT_ORDER, GEAR_SLOTS, GearSlotName } from '../../../constants/gearTypes';
import { SUBSTAT_RANGES } from '../../../constants/statValues';
import { calculateMainStatValue } from '../mainStatValueFetcher';
import { GEAR_SETS, GearSetName } from '../../../constants/gearSets';
import type { Stat, StatName, StatType } from '../../../types/stats';

/** Minimal level-16 legendary piece. Override what a test cares about. */
function makeGear(overrides: Partial<GearPiece> = {}): GearPiece {
    return {
        id: 'gear-1',
        slot: 'weapon',
        level: COVERAGE_MIN_LEVEL,
        stars: 6,
        rarity: 'legendary',
        mainStat: { name: 'attack', value: 1000, type: 'flat' },
        subStats: [],
        setBonus: null,
        ...overrides,
    };
}

describe('constants', () => {
    it('samples the top 20 level-16 pieces', () => {
        expect(COVERAGE_SAMPLE_SIZE).toBe(20);
        expect(COVERAGE_MIN_LEVEL).toBe(16);
    });
});

describe('mainStatTypesForSlot', () => {
    it('is always flat-only for hacking, security and speed, even on percentage slots', () => {
        // Real imported game data never shows a percentage-typed one, and
        // `SUBSTAT_RANGES` (the same table the substat search reads) has no
        // `percentage` key for any of the three — `calculateMainStatValue`
        // would route a fabricated percentage variant through the wrong
        // magnitude table entirely.
        for (const slot of ['sensor', 'software', 'thrusters'] as const) {
            expect(mainStatTypesForSlot(slot, 'hacking')).toEqual(['flat']);
            expect(mainStatTypesForSlot(slot, 'security')).toEqual(['flat']);
            expect(mainStatTypesForSlot(slot, 'speed')).toEqual(['flat']);
        }
        for (const slot of ['weapon', 'hull', 'generator'] as const) {
            expect(mainStatTypesForSlot(slot, 'hacking')).toEqual(['flat']);
            expect(mainStatTypesForSlot(slot, 'security')).toEqual(['flat']);
            expect(mainStatTypesForSlot(slot, 'speed')).toEqual(['flat']);
        }
    });

    it('is percentage-only for crit/critDamage regardless of slot', () => {
        expect(mainStatTypesForSlot('weapon', 'crit')).toEqual(['percentage']);
        expect(mainStatTypesForSlot('software', 'critDamage')).toEqual(['percentage']);
    });

    it('is flat-only for hp, attack and defence on the fixed slots (weapon, hull, generator)', () => {
        // Real inventories never show a percentage main stat on these three
        // slots — each offers only its own single stat name.
        for (const slot of ['weapon', 'hull', 'generator'] as const) {
            expect(mainStatTypesForSlot(slot, 'hp')).toEqual(['flat']);
            expect(mainStatTypesForSlot(slot, 'attack')).toEqual(['flat']);
            expect(mainStatTypesForSlot(slot, 'defence')).toEqual(['flat']);
        }
    });

    it('allows BOTH flat and percentage for hp, attack and defence on the flexible slots', () => {
        // Real inventories show both: e.g. a software hp:percentage piece
        // (max 50) AND a software hp:flat piece (max 3000) both exist.
        for (const slot of ['sensor', 'software', 'thrusters'] as const) {
            expect(mainStatTypesForSlot(slot, 'hp')).toEqual(['flat', 'percentage']);
            expect(mainStatTypesForSlot(slot, 'attack')).toEqual(['flat', 'percentage']);
            expect(mainStatTypesForSlot(slot, 'defence')).toEqual(['flat', 'percentage']);
        }
    });
});

describe('scorePieceForRole', () => {
    it('returns a positive marginal for a piece that helps the role', () => {
        expect(scorePieceForRole(makeGear(), 'ATTACKER')).toBeGreaterThan(0);
    });

    it('gives an attacker nothing for a stat the attacker score never reads', () => {
        // calculateAttackerScore is calculateDPS plus stat bonuses, and
        // calculateDPS reads only attack, crit, critDamage and
        // defensePenetration (priorityScore.ts:53, :127). healModifier is
        // therefore provably inert for this role, so the marginal is exactly 0.
        const healPiece = makeGear({
            id: 'heal',
            slot: 'sensor',
            mainStat: { name: 'healModifier', value: 30, type: 'percentage' },
        });
        expect(scorePieceForRole(healPiece, 'ATTACKER')).toBe(0);
    });

    it('scores a role-relevant piece above an inert one', () => {
        const critPiece = makeGear({
            id: 'crit',
            slot: 'sensor',
            mainStat: { name: 'crit', value: 30, type: 'percentage' },
        });
        const healPiece = makeGear({
            id: 'heal',
            slot: 'sensor',
            mainStat: { name: 'healModifier', value: 30, type: 'percentage' },
        });
        expect(scorePieceForRole(critPiece, 'ATTACKER')).toBeGreaterThan(
            scorePieceForRole(healPiece, 'ATTACKER')
        );
    });

    it('treats a percentage flexible stat as a share of the role baseline', () => {
        // ATTACKER baseline attack is 6250, so +10% attack must beat a flat +100.
        const percentPiece = makeGear({
            id: 'pct',
            mainStat: { name: 'attack', value: 10, type: 'percentage' },
        });
        const flatPiece = makeGear({
            id: 'flat',
            mainStat: { name: 'attack', value: 100, type: 'flat' },
        });
        expect(scorePieceForRole(percentPiece, 'ATTACKER')).toBeGreaterThan(
            scorePieceForRole(flatPiece, 'ATTACKER')
        );
    });

    it('adds a percentage-only stat directly, not as a share of the baseline', () => {
        // ATTACKER's baseline crit is 20 and crit is stored as an integer
        // percentage, so a +20 crit piece must land the block at crit 40.
        // Scaling it as a share of the baseline instead would land it at 24 —
        // the second assertion is what makes this test able to fail.
        const piece = makeGear({ mainStat: { name: 'crit', value: 20, type: 'percentage' } });
        const baselineScore = calculateRoleScore('ATTACKER', ROLE_BASE_STATS.ATTACKER);
        const direct =
            calculateRoleScore('ATTACKER', { ...ROLE_BASE_STATS.ATTACKER, crit: 40 }) -
            baselineScore;
        const scaledShare =
            calculateRoleScore('ATTACKER', { ...ROLE_BASE_STATS.ATTACKER, crit: 24 }) -
            baselineScore;

        expect(scorePieceForRole(piece, 'ATTACKER')).toBeCloseTo(direct, 10);
        expect(scorePieceForRole(piece, 'ATTACKER')).not.toBeCloseTo(scaledShare, 10);
    });

    it('counts substats as well as the main stat', () => {
        const bare = makeGear({ id: 'bare' });
        const loaded = makeGear({
            id: 'loaded',
            subStats: [
                { name: 'crit', value: 15, type: 'percentage' },
                { name: 'critDamage', value: 20, type: 'percentage' },
            ],
        });
        expect(scorePieceForRole(loaded, 'ATTACKER')).toBeGreaterThan(
            scorePieceForRole(bare, 'ATTACKER')
        );
    });

    describe('set bonus credit', () => {
        it('outscores an identical setless piece by exactly its amortised share', () => {
            // ATTACK: attack 15%, no minPieces on the entry -> defaults to 2,
            // so each piece is credited half: attack 7.5%. Derived
            // independently of scorePieceForRole (a bare toBeGreaterThan
            // would also pass for the OLD full-credit or wrong-fraction
            // heuristics; matching this exact figure is what rules those out).
            const plain = makeGear({ id: 'plain', setBonus: null });
            const withSet = makeGear({ id: 'set', setBonus: 'ATTACK' });
            const baseline = ROLE_BASE_STATS.ATTACKER;
            const creditedShare =
                calculateRoleScore('ATTACKER', { ...baseline, attack: baseline.attack * 1.075 }) -
                calculateRoleScore('ATTACKER', baseline);

            expect(scorePieceForRole(withSet, 'ATTACKER')).toBeGreaterThan(
                scorePieceForRole(plain, 'ATTACKER')
            );
            expect(
                scorePieceForRole(withSet, 'ATTACKER') - scorePieceForRole(plain, 'ATTACKER')
            ).toBeCloseTo(creditedShare, 8);
        });

        it('credits a 2-piece set half its stats and a 4-piece set a quarter', () => {
            // ATTACK (minPieces absent -> 2): half of attack 15% is 7.5%.
            // BURNER (minPieces 4): a quarter of attack 15% is 3.75%. Both
            // sets carry only `attack`, so the two shares are directly
            // comparable without any other stat's contribution in the way.
            const plain = makeGear({ id: 'plain' });
            const twoPiece = makeGear({ id: 'two-piece', setBonus: 'ATTACK' });
            const fourPiece = makeGear({ id: 'four-piece', setBonus: 'BURNER' });
            const baseline = ROLE_BASE_STATS.ATTACKER;
            const halfShare =
                calculateRoleScore('ATTACKER', { ...baseline, attack: baseline.attack * 1.075 }) -
                calculateRoleScore('ATTACKER', baseline);
            const quarterShare =
                calculateRoleScore('ATTACKER', { ...baseline, attack: baseline.attack * 1.0375 }) -
                calculateRoleScore('ATTACKER', baseline);

            expect(
                scorePieceForRole(twoPiece, 'ATTACKER') - scorePieceForRole(plain, 'ATTACKER')
            ).toBeCloseTo(halfShare, 8);
            expect(
                scorePieceForRole(fourPiece, 'ATTACKER') - scorePieceForRole(plain, 'ATTACKER')
            ).toBeCloseTo(quarterShare, 8);
        });

        it('credits nothing for a set with no stats', () => {
            // DECIMATION describes a pure proc ("10% extra DoT damage") with
            // an empty `stats` array — nothing for scorePieceForRole to add.
            expect(GEAR_SETS.DECIMATION.stats).toHaveLength(0);
            const plain = makeGear({ id: 'plain', setBonus: null });
            const decimation = makeGear({ id: 'decimation', setBonus: 'DECIMATION' });
            expect(scorePieceForRole(decimation, 'ATTACKER')).toBe(
                scorePieceForRole(plain, 'ATTACKER')
            );
        });

        it('never credits an implant-slotted piece, even when its name collides with a real GEAR_SETS key', () => {
            // AMBUSH is a key in BOTH GEAR_SETS (attack 10%, speed 5%) and
            // IMPLANTS (an unrelated implant). A piece in an implant slot
            // must not pick up the gear-set stats just because the name
            // resolves in GEAR_SETS — the credit is gated on the piece
            // actually sitting in a real gear slot.
            expect(GEAR_SETS.AMBUSH).toBeDefined();
            const implantPlain = makeGear({
                id: 'implant-plain',
                slot: 'implant_major',
                setBonus: null,
            });
            const implantWithAmbush = makeGear({
                id: 'implant-ambush',
                slot: 'implant_major',
                setBonus: 'AMBUSH',
            });
            expect(scorePieceForRole(implantWithAmbush, 'ATTACKER')).toBe(
                scorePieceForRole(implantPlain, 'ATTACKER')
            );
        });
    });

    it('ignores calibration, which is bound to one ship', () => {
        const plain = makeGear({ id: 'plain' });
        const calibrated = makeGear({ id: 'cal', calibration: { shipId: 'ship-1' } });
        expect(scorePieceForRole(calibrated, 'ATTACKER')).toBe(
            scorePieceForRole(plain, 'ATTACKER')
        );
    });

    it('scores the same piece differently for different roles', () => {
        const hacking = makeGear({
            id: 'hack',
            slot: 'software',
            mainStat: { name: 'hacking', value: 300, type: 'flat' },
        });
        expect(scorePieceForRole(hacking, 'DEBUFFER')).toBeGreaterThan(
            scorePieceForRole(hacking, 'DEFENDER')
        );
    });

    it('tolerates a piece with no main stat', () => {
        expect(() => scorePieceForRole(makeGear({ mainStat: null }), 'ATTACKER')).not.toThrow();
    });
});

describe('computePriority', () => {
    it('is 1 when you own nothing in the slot', () => {
        expect(computePriority([], 100)).toBe(1);
    });

    it('is 0 when idealMarginal is exactly 0 — nothing this slot can carry helps the role', () => {
        // Distinguishes this from the empty-inventory case above: an empty
        // sample alone must NOT be enough to return 1.
        expect(computePriority([], 0)).toBe(0);
        expect(computePriority([50, 60], 0)).toBe(0);
    });

    it('is 0 when idealMarginal is negative', () => {
        expect(computePriority([], -5)).toBe(0);
    });

    it('is 0 when 20 or more owned pieces already match the ideal', () => {
        const ideal = 100;
        expect(computePriority(Array<number>(20).fill(ideal), ideal)).toBe(0);
        expect(computePriority(Array<number>(25).fill(ideal), ideal)).toBe(0);
    });

    describe('a real marginal above the max-allocation guard', () => {
        // `idealMaxGuard` (which defaults to `idealMarginal` when the caller
        // does not pass one — the case exercised here) is supposed to be a
        // TRUE ceiling; a real marginal above it (whether from an ideal-model
        // shortfall or from imported data simply not being bound by the roll
        // tables) means the search failed to try some legal allocation, not
        // that the slot is saturated. Non-production throws so the defect is
        // loud; production only logs and clamps, matching
        // `scorePieceUpgrade.ts`'s missing-baseline pattern. A real marginal
        // above `idealMarginal` (the MEAN) alone is normal and must NOT throw
        // — see "the mean ceiling" below for that half of the contract.
        afterEach(() => {
            vi.unstubAllEnvs();
        });

        it('throws outside production', () => {
            expect(() => computePriority(Array<number>(20).fill(150), 100)).toThrow(
                /exceeds the max-allocation guard/
            );
        });

        it('names the offending role and slot when a context is given', () => {
            expect(() =>
                computePriority(Array<number>(20).fill(150), 100, COVERAGE_SAMPLE_SIZE, {
                    role: 'ATTACKER',
                    slot: 'weapon',
                })
            ).toThrow(/ATTACKER\/weapon/);
        });

        it('includes the ideal composition in the message when a context is given', () => {
            // Built from the real describeIdealPiece result rather than a
            // hardcoded string, so this stays valid if the ideal-piece search
            // ever changes what it finds for ATTACKER/weapon.
            const ideal = describeIdealPiece('ATTACKER', 'weapon');
            let thrown: Error | undefined;
            try {
                computePriority(Array<number>(20).fill(150), 100, COVERAGE_SAMPLE_SIZE, {
                    role: 'ATTACKER',
                    slot: 'weapon',
                });
            } catch (error) {
                thrown = error as Error;
            }
            expect(thrown).toBeDefined();
            const message = thrown!.message;
            expect(message).toContain(`main ${ideal.mainStat!.name} ${ideal.mainStat!.value}`);
            expect(message).toContain(ideal.setBonus ?? 'set none');
            for (const sub of ideal.subStats) {
                expect(message).toContain(`${sub.name} ${sub.value}`);
            }
        });

        it('clamps to 0 in production instead of throwing', () => {
            vi.stubEnv('NODE_ENV', 'production');
            expect(computePriority(Array<number>(20).fill(150), 100)).toBe(0);
        });
    });

    it('never exceeds 1, even with marginals worse than the role baseline', () => {
        // A negative marginal pulls the mean below 0, which would push
        // coverage negative and 1 - coverage above 1 without the clamp.
        expect(computePriority([-1000], 100)).toBe(1);
    });

    it('zero-pads up to COVERAGE_SAMPLE_SIZE rather than dividing by the sample length', () => {
        // One ideal piece: mean = idealMarginal / 20, so coverage is a bare
        // 5% and priority is correspondingly still very high. Twenty ideal
        // pieces: mean = idealMarginal, fully covered, priority 0. Dividing
        // by `sample.length` instead of the fixed 20 would report both as
        // fully covered (mean == idealMarginal either way).
        const ideal = 100;
        const onePiece = computePriority([ideal], ideal);
        const twentyPieces = computePriority(Array<number>(20).fill(ideal), ideal);
        expect(onePiece).toBeCloseTo(0.95, 10);
        expect(twentyPieces).toBe(0);
        expect(onePiece).toBeGreaterThan(twentyPieces);
    });

    it('does not let a sample past COVERAGE_SAMPLE_SIZE affect the mean', () => {
        const ideal = 100;
        const withoutTail = computePriority(Array<number>(20).fill(ideal), ideal);
        const withTail = computePriority(
            [...Array<number>(20).fill(ideal), ...Array<number>(50).fill(0)],
            ideal
        );
        expect(withTail).toBe(withoutTail);
    });

    it('samples the top entries, not the first ones it is given', () => {
        const ideal = 100;
        const marginals = [...Array<number>(20).fill(1), ...Array<number>(5).fill(ideal)];
        // Sorting before truncating keeps the five ideal-scoring pieces;
        // truncating first would keep only the 1s.
        const sortedFirst = computePriority(marginals, ideal);
        const truncatedFirst = computePriority(marginals.slice(0, 20), ideal);
        expect(sortedFirst).not.toBe(truncatedFirst);
    });

    it('does not need sorted input', () => {
        expect(computePriority([1, 100, 1], 100)).toBe(computePriority([100, 1, 1], 100));
    });

    it('does not mutate its argument', () => {
        const marginals = [10, 50, 20];
        computePriority(marginals, 100);
        expect(marginals).toEqual([10, 50, 20]);
    });

    it('normalises by the given idealMarginal, not a fixed constant', () => {
        // Same marginals (40), two different ideals: coverage must track
        // whichever idealMarginal is passed in, not a hardcoded reference.
        expect(computePriority(Array<number>(20).fill(40), 200)).toBeCloseTo(0.8, 10);
        expect(computePriority(Array<number>(20).fill(40), 40)).toBe(0);
    });

    it('scores 20 uniformly mediocre pieces at a higher priority than 20 max-roll pieces', () => {
        // Priority is relative to idealMarginal, not to the spread within the
        // owned sample, so uniformly mediocre supply reads as needing MORE
        // farming than uniformly max-roll supply, never the same.
        const ideal = 100;
        const mediocre = computePriority(Array<number>(20).fill(20), ideal);
        const maxRoll = computePriority(Array<number>(20).fill(ideal), ideal);
        expect(mediocre).toBeGreaterThan(maxRoll);
        expect(maxRoll).toBe(0);
    });

    describe('configurable sample size', () => {
        // 30 mixed-quality marginals: 20 at the ideal ceiling, 10 at half of
        // it. A slot holding more than 20 pieces but fewer than a larger N
        // must read a HIGHER priority at that larger N — the top-20 window
        // alone is fully covered (mean == ideal, priority 0), but widening
        // the window to 50 (zero-padded) pulls in the weaker 10 and 20 more
        // unfarmed zero-pad slots, dragging the mean down and priority up.
        const ideal = 100;
        const mixedQuality = [...Array<number>(20).fill(ideal), ...Array<number>(10).fill(50)];

        it('reaches the sampleSize argument: N=50 reads a higher priority than the default N=20', () => {
            const atDefault = computePriority(mixedQuality, ideal);
            const atFifty = computePriority(mixedQuality, ideal, 50);
            expect(atDefault).toBe(0);
            expect(atFifty).toBeGreaterThan(atDefault);
            // mean over 50 = (20*100 + 10*50 + 20*0) / 50 = 50, coverage 0.5, priority 0.5
            expect(atFifty).toBeCloseTo(0.5, 10);
        });

        it('zero-pads to the passed sampleSize, not the default', () => {
            // One ideal piece: at N=10, mean = ideal/10 (priority 0.9); at
            // N=200, mean = ideal/200 (priority 0.995). Both must read as
            // near-total priority, and the larger N must read closer to 1.
            const onePiece = [ideal];
            const atTen = computePriority(onePiece, ideal, 10);
            const atTwoHundred = computePriority(onePiece, ideal, 200);
            expect(atTen).toBeCloseTo(0.9, 10);
            expect(atTwoHundred).toBeCloseTo(0.995, 10);
            expect(atTwoHundred).toBeGreaterThan(atTen);
        });

        it('defaults to COVERAGE_SAMPLE_SIZE when no sampleSize argument is given', () => {
            expect(computePriority(mixedQuality, ideal)).toBe(
                computePriority(mixedQuality, ideal, COVERAGE_SAMPLE_SIZE)
            );
        });
    });

    describe('a separate idealMaxGuard', () => {
        it('does not throw for a marginal above idealMarginal but at or below the guard', () => {
            // The exact ATTACKER/weapon max-allocation replica: its marginal
            // legitimately exceeds the MEAN idealMarginal (895.95... at time
            // of writing) but never the MAX guard it was built to equal.
            const idealMarginal = getIdealMarginal('ATTACKER', 'weapon');
            const idealMaxGuard = getIdealMaxGuard('ATTACKER', 'weapon');
            expect(idealMaxGuard).toBeGreaterThan(idealMarginal);
            expect(() =>
                computePriority(
                    [idealMaxGuard],
                    idealMarginal,
                    COVERAGE_SAMPLE_SIZE,
                    { role: 'ATTACKER', slot: 'weapon' },
                    idealMaxGuard
                )
            ).not.toThrow();
        });

        it('still throws for a marginal that beats even the guard — a true impossibility', () => {
            const idealMarginal = getIdealMarginal('ATTACKER', 'weapon');
            const idealMaxGuard = getIdealMaxGuard('ATTACKER', 'weapon');
            expect(() =>
                computePriority(
                    [idealMaxGuard + 1],
                    idealMarginal,
                    COVERAGE_SAMPLE_SIZE,
                    { role: 'ATTACKER', slot: 'weapon' },
                    idealMaxGuard
                )
            ).toThrow(/exceeds the max-allocation guard/);
        });

        it('sabotage check: omitting the guard (guard defaults to the mean) spuriously fires on this same ordinary piece', () => {
            // Demonstrates why the guard must be threaded through explicitly
            // at the production call site (`buildCoverageMatrix`): a caller
            // that forgets it and lets the guard default back to the mean
            // reproduces the exact false positive #473 exists to prevent.
            const idealMarginal = getIdealMarginal('ATTACKER', 'weapon');
            const idealMaxGuard = getIdealMaxGuard('ATTACKER', 'weapon');
            expect(() =>
                computePriority(
                    [idealMaxGuard],
                    idealMarginal,
                    COVERAGE_SAMPLE_SIZE,
                    { role: 'ATTACKER', slot: 'weapon' }
                    // idealMaxGuard omitted -> defaults to idealMarginal (the mean)
                )
            ).toThrow(/exceeds the max-allocation guard/);
        });
    });
});

describe('the mean ceiling', () => {
    // Required non-vacuity checks for the mean-based redefinition (see #473):
    // these fail if the metric silently reverted to a max, or to averaging
    // over allocations the role's score formula does not read.

    it('lands strictly between two differently-scoring preferred allocations, not at the max', () => {
        // ATTACKER/weapon's 3 preferred pairs (attack%, crit%, critDamage%)
        // admit 15 legal roll distributions across them; two hand-built
        // real pieces at opposite ends of that space — all 4 extra rolls
        // into critDamage vs. all 4 into crit+attack (the true max, per
        // `describeIdealPiece`) — score very differently. The MEAN the
        // metric actually divides by must sit strictly inside that range,
        // never collapse back onto the max end of it.
        const allCritDamage = makeGear({
            id: 'all-critdamage',
            mainStat: { name: 'attack', value: 1000, type: 'flat' },
            subStats: [
                { name: 'attack', value: 7, type: 'percentage' },
                { name: 'crit', value: 8, type: 'percentage' },
                { name: 'critDamage', value: 40, type: 'percentage' },
            ],
            setBonus: 'ABYSSAL_ASSAULT',
        });
        const maxAllocation = describeIdealPiece('ATTACKER', 'weapon');
        const maxPiece = makeGear({
            id: 'max-allocation',
            mainStat: maxAllocation.mainStat,
            subStats: maxAllocation.subStats,
            setBonus: maxAllocation.setBonus,
        });

        const low = scorePieceForRole(allCritDamage, 'ATTACKER');
        const high = scorePieceForRole(maxPiece, 'ATTACKER');
        expect(low).toBeLessThan(high);

        const idealMarginal = getIdealMarginal('ATTACKER', 'weapon');
        expect(idealMarginal).toBeGreaterThan(low);
        expect(idealMarginal).toBeLessThan(high);
    });

    it('is not dragged down by allocations into stats ATTACKER never reads', () => {
        // A broader (WRONG) mean that lets rolls land on a non-preferred
        // stat (hp, which calculateAttackerScore never reads) alongside the
        // 3 real preferred ones: every roll spent on hp is wasted relative
        // to spending it on attack%/crit%/critDamage%, so this broader
        // average is strictly lower than the real metric. If the ideal-piece
        // search ever stopped restricting to preferred pairs, the real
        // metric would collapse onto this same, lower number.
        function distribute(total: number, slots: number): number[][] {
            if (slots === 1) return [[total]];
            const result: number[][] = [];
            for (let take = 0; take <= total; take++) {
                for (const rest of distribute(total - take, slots - 1)) {
                    result.push([take, ...rest]);
                }
            }
            return result;
        }
        let sum = 0;
        let count = 0;
        for (const [a, c, cd, hp] of distribute(4, 4)) {
            const piece = makeGear({
                id: `broad-${a}-${c}-${cd}-${hp}`,
                mainStat: { name: 'attack', value: 1000, type: 'flat' },
                subStats: [
                    { name: 'attack', value: (1 + a) * 7, type: 'percentage' },
                    { name: 'crit', value: (1 + c) * 8, type: 'percentage' },
                    { name: 'critDamage', value: (1 + cd) * 8, type: 'percentage' },
                    { name: 'hp', value: (1 + hp) * 600, type: 'flat' },
                ],
                setBonus: 'ABYSSAL_ASSAULT',
            });
            sum += scorePieceForRole(piece, 'ATTACKER');
            count += 1;
        }
        const broaderMeanIncludingNonPreferred = sum / count;
        const idealMarginal = getIdealMarginal('ATTACKER', 'weapon');
        expect(idealMarginal).toBeGreaterThan(broaderMeanIncludingNonPreferred);
    });
});

describe('competitionRank', () => {
    it('gives every item rank 1 when all values tie', () => {
        const ranks = competitionRank(['a', 'b', 'c'], () => 5, ['a', 'b', 'c']);
        expect(ranks.get('a')).toBe(1);
        expect(ranks.get('b')).toBe(1);
        expect(ranks.get('c')).toBe(1);
    });

    it('gives equal rank to equal values, and skips the next rank by the tie count', () => {
        // a, b, c tie for first (rank 1); d is strictly lower and, with 3
        // entries tied ahead of it, lands on rank 4 -- not rank 2, the way
        // an unconditional index+1 ranking would place it.
        const values: Record<string, number> = { a: 10, b: 10, c: 10, d: 1 };
        const ranks = competitionRank(Object.keys(values), (item) => values[item], [
            'a',
            'b',
            'c',
            'd',
        ]);
        expect(ranks.get('a')).toBe(1);
        expect(ranks.get('b')).toBe(1);
        expect(ranks.get('c')).toBe(1);
        expect(ranks.get('d')).toBe(4);
    });

    it('gives the highest value rank 1, descending', () => {
        const values: Record<string, number> = { low: 1, mid: 5, high: 9 };
        const ranks = competitionRank(Object.keys(values), (item) => values[item], [
            'low',
            'mid',
            'high',
        ]);
        expect(ranks.get('high')).toBe(1);
        expect(ranks.get('mid')).toBe(2);
        expect(ranks.get('low')).toBe(3);
    });

    it('breaks ties among equally-ranked items using `order`, without changing the rank number', () => {
        const ranks = competitionRank(['b', 'a'], () => 1, ['a', 'b']);
        // Both tie for rank 1 regardless of which one `order` treats as first.
        expect(ranks.get('a')).toBe(1);
        expect(ranks.get('b')).toBe(1);
    });

    it('treats values within floating-point noise of each other as tied', () => {
        // Different role scoring formulas run different arithmetic paths
        // over bit-identical input, so a conceptual tie can come back as
        // e.g. 5 and 5 + 2.9e-16 instead of two exact 5s.
        const values: Record<string, number> = { a: 5, b: 5 + 1e-13 };
        const ranks = competitionRank(Object.keys(values), (item) => values[item], ['a', 'b']);
        expect(ranks.get('a')).toBe(1);
        expect(ranks.get('b')).toBe(1);
    });

    it('does not treat a real gap as a tie just because it is small', () => {
        const values: Record<string, number> = { a: 5, b: 5.001 };
        const ranks = competitionRank(Object.keys(values), (item) => values[item], ['a', 'b']);
        expect(ranks.get('b')).toBe(1);
        expect(ranks.get('a')).toBe(2);
    });

    it('does not let a chain of sub-epsilon steps merge the highest and lowest values', () => {
        // Ranking sorts by descending value, so the tie group opens at c
        // (the largest) and extends to b (within TIE_EPSILON of c) -- but a
        // is 1.5 * TIE_EPSILON below c, more than the allowed gap. Comparing
        // each item only against its immediate predecessor would chain all
        // three into one tie group (a is also within TIE_EPSILON of b);
        // comparing against the value that opened the group keeps a out of
        // it once it drifts past the epsilon from c.
        const values: Record<string, number> = {
            a: 5,
            b: 5 + 0.75 * TIE_EPSILON,
            c: 5 + 1.5 * TIE_EPSILON,
        };
        const ranks = competitionRank(Object.keys(values), (item) => values[item], ['a', 'b', 'c']);
        expect(ranks.get('c')).toBe(1);
        expect(ranks.get('b')).toBe(1);
        expect(ranks.get('a')).toBe(3);
    });
});

describe('buildCoverageMatrix', () => {
    it('covers every role and every gear slot', () => {
        // Exercises the full (role x slot) ideal-piece search — each pair is
        // computed once and module-cached, so only the first test to touch a
        // given (role, slot) pays that cost. See "cold ideal-piece build
        // performance" below for the actual budget a genuinely cold run is
        // expected to stay under.
        const matrix = buildCoverageMatrix([]);
        const roles = Object.keys(SHIP_TYPES);
        expect(matrix.roleOrder).toHaveLength(roles.length);
        expect(Object.keys(matrix.cells)).toHaveLength(roles.length);
        for (const role of roles) {
            expect(Object.keys(matrix.cells[role])).toEqual(GEAR_SLOT_ORDER);
            expect(matrix.slotOrderByRole[role]).toHaveLength(GEAR_SLOT_ORDER.length);
        }
    }, 20000);

    it('reports an empty inventory in the static role order, priority 1 everywhere', () => {
        const matrix = buildCoverageMatrix([]);
        expect(matrix.roleOrder).toEqual(Object.keys(SHIP_TYPES));
        expect(matrix.cells.ATTACKER.weapon.count).toBe(0);
        expect(matrix.cells.ATTACKER.weapon.priority).toBe(1);
    });

    it('counts only level-16 pieces', () => {
        const inventory = [
            makeGear({ id: 'a', level: 16 }),
            makeGear({ id: 'b', level: 15 }),
            makeGear({ id: 'c', level: 1 }),
        ];
        const matrix = buildCoverageMatrix(inventory);
        expect(matrix.cells.ATTACKER.weapon.count).toBe(1);
    });

    it('counts equipped pieces, which are still supply', () => {
        const matrix = buildCoverageMatrix([makeGear({ id: 'a', shipId: 'ship-1' })]);
        expect(matrix.cells.ATTACKER.weapon.count).toBe(1);
    });

    it('files each piece under its own slot only', () => {
        const matrix = buildCoverageMatrix([makeGear({ id: 'a', slot: 'hull' })]);
        expect(matrix.cells.ATTACKER.hull.count).toBe(1);
        expect(matrix.cells.ATTACKER.weapon.count).toBe(0);
    });

    it('ignores implant slots', () => {
        const matrix = buildCoverageMatrix([makeGear({ id: 'a', slot: 'implant_major' })]);
        for (const slot of GEAR_SLOT_ORDER) {
            expect(matrix.cells.ATTACKER[slot].count).toBe(0);
        }
    });

    it('gives every cell rank 1 when the whole slot column ties', () => {
        // No gear at all: every cell in every column is priority 1, a full
        // tie. Competition ranking gives every tied entry the SAME rank, so
        // this must not reproduce 1..12 the way an unconditional index+1
        // ranking would.
        const matrix = buildCoverageMatrix([]);
        for (const slot of GEAR_SLOT_ORDER) {
            for (const role of Object.keys(SHIP_TYPES)) {
                expect(matrix.cells[role][slot].rank).toBe(1);
            }
        }
    });

    /**
     * A real level-16, 6-star legendary software piece whose marginal for
     * DEBUFFER exactly equals `getIdealMaxGuard('DEBUFFER', 'software')` (the
     * MAX allocation — see `IdealPieceComposition`'s doc for why the mean
     * `getIdealMarginal` divides by has no single matching composition) —
     * confirmed against the exhaustive search, not guessed: main stat
     * `hacking` (flat, the only legal type), subs `attack` flat once,
     * `attack` percentage stacked through all 4 upgrade rolls, `crit` and
     * `critDamage` once each, and the EXPLOIT set (`hacking` flat 20,
     * `attack` percentage 10, minPieces absent -> credited half: `hacking`
     * flat 10, `attack` percentage 5) — the best-for-DEBUFFER set for this
     * (main stat, substat) combination. `calculateDebufferScore` reads
     * hacking multiplicatively against dps (priorityScore.ts) and
     * `calculateDefenderScore` never reads hacking or attack, so this same
     * piece scores 0 for DEFENDER — a real, legal saturating stack for one
     * role and an inert one for the other, without an illegal stat value.
     */
    const debufferIdealSoftwarePiece = () =>
        makeGear({
            slot: 'software',
            mainStat: { name: 'hacking', value: 100, type: 'flat' },
            subStats: [
                { name: 'attack', value: 140, type: 'flat' },
                { name: 'attack', value: 35, type: 'percentage' },
                { name: 'crit', value: 8, type: 'percentage' },
                { name: 'critDamage', value: 8, type: 'percentage' },
            ],
            setBonus: 'EXPLOIT',
        });

    it('gives an untouched role a strictly better software rank than a saturated one', () => {
        const stack = Array.from({ length: 20 }, (_, i) => ({
            ...debufferIdealSoftwarePiece(),
            id: `sw-${i}`,
        }));
        const matrix = buildCoverageMatrix(stack);
        expect(matrix.cells.DEFENDER.software.priority).toBe(1);
        expect(matrix.cells.DEFENDER.software.rank).toBe(1);
        // Not toBe(0): the marginal is recomputed on two different paths (the
        // owned pieces vs. the cached ideal), so float arithmetic over
        // bit-identical stats is not guaranteed bit-exact — see the "internal
        // ideal piece" tests' own note on this.
        expect(matrix.cells.DEBUFFER.software.priority).toBeLessThan(1e-9);
        expect(matrix.cells.DEBUFFER.software.rank).toBeGreaterThan(
            matrix.cells.DEFENDER.software.rank
        );
    });

    it("puts a role's saturated slot last in its own slot order", () => {
        // Same ideal-matching software stack: DEBUFFER's software column is
        // fully covered (priority ~0) while its other five slot columns are
        // untouched (priority 1, tied with every other role), so software
        // must sort to the back of DEBUFFER's own slot order.
        const stack = Array.from({ length: 20 }, (_, i) => ({
            ...debufferIdealSoftwarePiece(),
            id: `sw-${i}`,
        }));
        const matrix = buildCoverageMatrix(stack);
        expect(matrix.cells.DEBUFFER.software.priority).toBeLessThan(1e-9);
        expect(matrix.slotOrderByRole.DEBUFFER[matrix.slotOrderByRole.DEBUFFER.length - 1]).toBe(
            'software'
        );
    });

    it('orders roles by mean column rank, not by the static order', () => {
        // Same ideal-matching software stack. DEBUFFER's mean rank across
        // the 6 slot columns is worse than an untouched role's (one column
        // at a high rank number, five at rank 1, versus rank 1 everywhere),
        // so DEBUFFER must sort behind an untouched role regardless of
        // SHIP_TYPES's static index order.
        const stack = Array.from({ length: 20 }, (_, i) => ({
            ...debufferIdealSoftwarePiece(),
            id: `sw-${i}`,
        }));
        const matrix = buildCoverageMatrix(stack);
        const debufferIndex = matrix.roleOrder.indexOf('DEBUFFER');
        const defenderIndex = matrix.roleOrder.indexOf('DEFENDER');
        expect(defenderIndex).toBeLessThan(debufferIndex);
        expect(matrix.roleOrder).not.toEqual(Object.keys(SHIP_TYPES));
    });

    it("falls back to GEAR_SLOT_ORDER when a role's slots all tie", () => {
        const matrix = buildCoverageMatrix([]);
        for (const role of Object.keys(SHIP_TYPES)) {
            expect(matrix.slotOrderByRole[role]).toEqual(GEAR_SLOT_ORDER);
        }
    });

    it("orders a role's slots by that role's column ranks", () => {
        const matrix = buildCoverageMatrix([makeGear({ id: 'a' })]);
        const order = matrix.slotOrderByRole.ATTACKER;
        for (let i = 1; i < order.length; i++) {
            expect(matrix.cells.ATTACKER[order[i - 1]].rank).toBeLessThanOrEqual(
                matrix.cells.ATTACKER[order[i]].rank
            );
        }
    });

    it('a stronger single piece for a role never yields a higher priority than a weaker one', () => {
        // Monotonicity check against the real, code-computed ideal piece
        // (not a synthetic idealMarginal): a piece with better substats must
        // not leave the slot reading as MORE in need of farming.
        const strong = buildCoverageMatrix([
            makeGear({
                id: 'strong',
                mainStat: { name: 'attack', value: 140, type: 'flat' },
                subStats: [
                    { name: 'attack', value: 100, type: 'flat' },
                    { name: 'crit', value: 8, type: 'percentage' },
                    { name: 'critDamage', value: 8, type: 'percentage' },
                    { name: 'hp', value: 600, type: 'flat' },
                ],
            }),
        ]);
        const weak = buildCoverageMatrix([
            makeGear({
                id: 'weak',
                mainStat: { name: 'attack', value: 70, type: 'flat' },
                subStats: [],
            }),
        ]);
        // A single piece, however strong, cannot saturate a 20-slot sample,
        // so a strictly better piece must read a strictly lower priority.
        expect(strong.cells.ATTACKER.weapon.priority).toBeLessThan(
            weak.cells.ATTACKER.weapon.priority
        );
    });

    describe('the internal ideal piece', () => {
        // pickIdealPiece/pickIdealSubstats are not exported (getIdealMarginal,
        // getIdealMaxGuard and describeIdealPiece are — see the "ideal is a
        // true ceiling" tests below), so these pin the FULL MAX-allocation
        // composition indirectly: a hand-built replica of the level-16,
        // 6-star legendary piece the search should find is fed through
        // buildCoverageMatrix as the only owned piece. If the replica's
        // stats truly are what the search finds, its own marginal (scored by
        // the same scorePieceForRole the ideal piece is scored by) IS
        // getIdealMaxGuard for this (role, slot). The priority it reads is
        // then derived from the real getIdealMarginal (the MEAN, which has
        // no single matching composition — see `IdealPieceComposition`'s
        // doc) via the documented `1 - (marginal / sampleSize) /
        // idealMarginal` formula, not a hardcoded constant: the mean moves
        // whenever the substat search space does, so a hardcoded number
        // would go stale silently. A wrong main stat, a wrong substat, a
        // wrong flat/percentage variant, or a wrong upgrade-roll split
        // changes the real getIdealMaxGuard without changing the replica's
        // marginal, so the `toBeCloseTo(idealMaxGuard, ...)` check below
        // stops holding.

        // The weapon slot only ever offers `attack` as a main stat, so this
        // main stat is not what distinguishes the two replicas below; the
        // substat (and now set) composition is. Substat slots carry the 4
        // upgrade rolls a level-16 legendary piece actually gets (increases,
        // not new substats — see LEGENDARY_SUBSTAT_INCREASES's doc), so a
        // slot can sit above its own single-roll legendary max.
        it('reads the ATTACKER weapon ideal as attack main, hp/attack%/crit%/critDamage% subs + Abyssal Assault', () => {
            // Best-for-ATTACKER set: Abyssal Assault (attack 15%, critDamage
            // 5%, minPieces absent -> credited half: attack 7.5%, critDamage
            // 2.5%) beats every other live set for this exact substat combo —
            // confirmed against an independent exhaustive (mainStat x set x
            // substat-combo) search, not guessed.
            const attackerIdeal = makeGear({
                id: 'attacker-ideal-replica',
                mainStat: { name: 'attack', value: 1000, type: 'flat' },
                subStats: [
                    { name: 'hp', value: 600, type: 'flat' }, // 1 roll (no increases landed here)
                    { name: 'attack', value: 14, type: 'percentage' }, // 2 rolls (+1 increase)
                    { name: 'crit', value: 32, type: 'percentage' }, // 4 rolls (+3 increases)
                    { name: 'critDamage', value: 8, type: 'percentage' }, // 1 roll
                ],
                setBonus: 'ABYSSAL_ASSAULT',
            });

            const idealMaxGuard = getIdealMaxGuard('ATTACKER', 'weapon');
            const idealMarginal = getIdealMarginal('ATTACKER', 'weapon');
            const replicaMarginal = scorePieceForRole(attackerIdeal, 'ATTACKER');
            expect(replicaMarginal).toBeCloseTo(idealMaxGuard, 6);

            const one = buildCoverageMatrix([attackerIdeal]);
            expect(one.cells.ATTACKER.weapon.priority).toBeCloseTo(
                1 - replicaMarginal / COVERAGE_SAMPLE_SIZE / idealMarginal,
                10
            );

            // Threading a non-default sampleSize through buildCoverageMatrix
            // itself (not just computePriority) — a hardcoded 20 at this call
            // site would fail this assertion even with computePriority fixed.
            const oneAtFifty = buildCoverageMatrix([attackerIdeal], 50);
            expect(oneAtFifty.cells.ATTACKER.weapon.priority).toBeCloseTo(
                1 - replicaMarginal / 50 / idealMarginal,
                10
            );

            const twenty = buildCoverageMatrix(
                Array.from({ length: COVERAGE_SAMPLE_SIZE }, (_, i) =>
                    makeGear({
                        id: `attacker-ideal-replica-${i}`,
                        mainStat: { name: 'attack', value: 1000, type: 'flat' },
                        subStats: [
                            { name: 'hp', value: 600, type: 'flat' },
                            { name: 'attack', value: 14, type: 'percentage' },
                            { name: 'crit', value: 32, type: 'percentage' },
                            { name: 'critDamage', value: 8, type: 'percentage' },
                        ],
                        setBonus: 'ABYSSAL_ASSAULT',
                    })
                )
            );
            // 20 copies at the MAX allocation legitimately exceed the MEAN
            // idealMarginal by a wide margin (coverage well above 1), so the
            // clamp lands on exactly 0 — see computePriority's doc on why
            // that clamp is load-bearing, not a guard against model error.
            expect(twenty.cells.ATTACKER.weapon.priority).toBe(0);
        });

        it('reads the DEFENDER_SECURITY weapon ideal as attack main, hp/hp%/defence%/security subs + Protection', () => {
            // calculateDefenderSecurityScore multiplies effective-HP survival
            // by security, so security is still worth stacking most upgrade
            // rolls — but Protection (defence 10%, security 20 flat,
            // minPieces absent -> credited half: defence 5%, security 10)
            // beats every other live set here, and claims one of the 4
            // upgrade-roll increases for `hp%` instead of all 4 landing on
            // `security` the way the setless ideal did.
            const securityIdeal = makeGear({
                id: 'security-ideal-replica',
                mainStat: { name: 'attack', value: 1000, type: 'flat' },
                subStats: [
                    { name: 'hp', value: 600, type: 'flat' }, // 1 roll
                    { name: 'hp', value: 14, type: 'percentage' }, // 2 rolls (+1 increase)
                    { name: 'defence', value: 7, type: 'percentage' }, // 1 roll
                    { name: 'security', value: 32, type: 'flat' }, // 4 rolls (+3 increases)
                ],
                setBonus: 'PROTECTION',
            });

            const idealMaxGuard = getIdealMaxGuard('DEFENDER_SECURITY', 'weapon');
            const idealMarginal = getIdealMarginal('DEFENDER_SECURITY', 'weapon');
            const replicaMarginal = scorePieceForRole(securityIdeal, 'DEFENDER_SECURITY');
            expect(replicaMarginal).toBeCloseTo(idealMaxGuard, 6);

            const one = buildCoverageMatrix([securityIdeal]);
            expect(one.cells.DEFENDER_SECURITY.weapon.priority).toBeCloseTo(
                1 - replicaMarginal / COVERAGE_SAMPLE_SIZE / idealMarginal,
                10
            );
        });
    });
});

describe('the ideal is a true ceiling', () => {
    // Fix 1's bug (excluding a substat by NAME instead of (name, type)) made
    // the ideal under-count a legal roll; this section proves the ceiling
    // property directly, independent of `roleSlotCoverage.ts`'s own search —
    // these helpers are a SEPARATE implementation, not a call into
    // `pickIdealSubstats`, so a bug shared between the two would have to be
    // coincidental rather than a single point of failure.

    /** Every k-element subset of `items`. */
    function combinations<T>(items: T[], k: number): T[][] {
        if (k === 0) return [[]];
        if (items.length < k) return [];
        const [first, ...rest] = items;
        return [
            ...combinations(rest, k - 1).map((combo) => [first, ...combo]),
            ...combinations(rest, k),
        ];
    }

    /** Every way to split `total` indistinguishable upgrade rolls across `slots` buckets. */
    function distributeRolls(total: number, slots: number): number[][] {
        if (slots === 1) return [[total]];
        const result: number[][] = [];
        for (let take = 0; take <= total; take++) {
            for (const rest of distributeRolls(total - take, slots - 1)) {
                result.push([take, ...rest]);
            }
        }
        return result;
    }

    const LEGENDARY_SUBSTAT_SLOTS = 4;
    const LEGENDARY_UPGRADE_INCREASES = 4;

    /**
     * `null` (no set) plus every `GEAR_SETS` name, including the empty-stats
     * ones (a no-op set is a legal real piece too) and `AMBUSH` (the name
     * that collides with an implant — irrelevant here since every piece this
     * function builds carries a real gear `slot`). Cycled across the
     * pieces below rather than crossed with every (mainStat, substat-combo)
     * pair: a full cross multiplies an already-large piece count by ~30 and
     * blows this file's default test timeout, whereas cycling gives every
     * set a wide, varied sample of substat combinations to pair with — for
     * any (role, slot), the search that actually finds the ideal
     * (`pickIdealPiece` in `roleSlotCoverage.ts`) already crosses sets with
     * substat combos exhaustively, so this ceiling check does not need to
     * repeat that in full to catch a regression in it.
     */
    const SET_CYCLE: (GearSetName | null)[] = [null, ...Object.keys(GEAR_SETS)];

    /**
     * Every realistic legal level-16, 6-star legendary piece `slot` can
     * carry: every legal main stat, in every legal type variant it can roll
     * as (see `mainStatTypesForSlot` — both flat and percentage for a
     * flexible stat on a flexible slot, e.g. software `hp:flat` AND
     * `hp:percentage`), crossed with every legal 4-of-N distinct (name, type)
     * substat combination (excluding only the main stat's own exact pair —
     * the `GearPieceForm` rule), crossed with every way the piece's 4 upgrade
     * rolls can land across those 4 slots (a slot can carry up to 5 rolls of
     * its own single-roll legendary max — see `potentialCalculator.ts`'s
     * `UPGRADE_LEVELS.legendary`), each also carrying a set bonus cycled from
     * `SET_CYCLE` (see its own doc for why cycled rather than crossed).
     */
    function realisticPiecesForSlot(slot: GearSlotName): GearPiece[] {
        const pieces: GearPiece[] = [];
        const rollDistributions = distributeRolls(
            LEGENDARY_UPGRADE_INCREASES,
            LEGENDARY_SUBSTAT_SLOTS
        );

        for (const name of GEAR_SLOTS[slot].availableMainStats) {
            for (const type of mainStatTypesForSlot(slot, name)) {
                const mainStat: Stat =
                    type === 'percentage'
                        ? {
                              name,
                              value: calculateMainStatValue(name, type, 6, COVERAGE_MIN_LEVEL),
                              type,
                          }
                        : ({
                              name,
                              value: calculateMainStatValue(name, type, 6, COVERAGE_MIN_LEVEL),
                              type,
                          } as Stat);

                const pairs: { name: StatName; type: StatType }[] = [];
                for (const subName of Object.keys(SUBSTAT_RANGES) as StatName[]) {
                    for (const subType of Object.keys(SUBSTAT_RANGES[subName]) as StatType[]) {
                        if (mainStat.name === subName && mainStat.type === subType) continue;
                        pairs.push({ name: subName, type: subType });
                    }
                }

                for (const combo of combinations(pairs, LEGENDARY_SUBSTAT_SLOTS)) {
                    for (const rolls of rollDistributions) {
                        const subStats: Stat[] = combo.map((pair, i) => {
                            const max = SUBSTAT_RANGES[pair.name][pair.type].legendary.max;
                            const value = (1 + rolls[i]) * max;
                            return pair.type === 'percentage'
                                ? { name: pair.name, value, type: 'percentage' }
                                : ({ name: pair.name, value, type: 'flat' } as Stat);
                        });
                        pieces.push({
                            id: `realistic-${slot}-${name}-${type}`,
                            slot,
                            level: COVERAGE_MIN_LEVEL,
                            stars: 6,
                            rarity: 'legendary',
                            mainStat,
                            subStats,
                            setBonus: SET_CYCLE[pieces.length % SET_CYCLE.length],
                        });
                    }
                }
            }
        }
        return pieces;
    }

    const roles = Object.keys(SHIP_TYPES);
    const piecesBySlot = new Map(
        GEAR_SLOT_ORDER.map((slot) => [slot, realisticPiecesForSlot(slot)] as const)
    );

    it('the user-reported real weapon (40% critDamage, stacked attack%) does not exceed the ATTACKER weapon max-allocation guard', () => {
        // The exact piece a player reported: 1000 attack flat main stat;
        // critDamage 40% (5 rolls at its 8% legendary max — every upgrade
        // roll landed here), crit 8%, attack 7%, attack ~150 flat. Checked
        // against getIdealMaxGuard (the TRUE ceiling), not getIdealMarginal
        // (the MEAN): a real piece routinely — and legitimately — beats the
        // mean under the mean-based redefinition (#473), so only the max
        // guard can never be exceeded.
        const reportedPiece: GearPiece = {
            id: 'user-reported-attacker-weapon',
            slot: 'weapon',
            level: COVERAGE_MIN_LEVEL,
            stars: 6,
            rarity: 'legendary',
            mainStat: { name: 'attack', value: 1000, type: 'flat' },
            subStats: [
                { name: 'critDamage', value: 40, type: 'percentage' },
                { name: 'crit', value: 8, type: 'percentage' },
                { name: 'attack', value: 7, type: 'percentage' },
                { name: 'attack', value: 150, type: 'flat' },
            ],
            setBonus: null,
        };
        const guard = getIdealMaxGuard('ATTACKER', 'weapon');
        const marginal = scorePieceForRole(reportedPiece, 'ATTACKER');
        expect(marginal).toBeLessThanOrEqual(guard + 1e-6);
    });

    it('a real security-main software piece does not exceed the DEFENDER_SECURITY/software max-allocation guard (#473 crash repro)', () => {
        // The exact shape that crashed the Upgrade Analysis tab against a
        // real 9,464-piece inventory: `GEAR_SLOTS.software.availableMainStats`
        // was missing `security` entirely, so the ideal search could never
        // build a software piece with a `security` main stat — the exact
        // stat DEFENDER_SECURITY's score multiplies against. A level-16,
        // 6-star legendary software piece with `security` flat at its 100
        // max, plus strong survival substats (hp flat/percentage, defence%,
        // a second security roll) beat the old under-built ideal by 7.5%.
        // Checked against getIdealMaxGuard — see the sibling test's note on
        // why the mean is the wrong thing to check this against.
        const softwareSecurityPiece: GearPiece = {
            id: 'crash-repro-security-software',
            slot: 'software',
            level: COVERAGE_MIN_LEVEL,
            stars: 6,
            rarity: 'legendary',
            mainStat: { name: 'security', value: 100, type: 'flat' },
            subStats: [
                { name: 'hp', value: 600, type: 'flat' },
                { name: 'hp', value: 14, type: 'percentage' },
                { name: 'defence', value: 7, type: 'percentage' },
                { name: 'security', value: 32, type: 'flat' },
            ],
            setBonus: 'PROTECTION',
        };
        const guard = getIdealMaxGuard('DEFENDER_SECURITY', 'software');
        const marginal = scorePieceForRole(softwareSecurityPiece, 'DEFENDER_SECURITY');
        expect(marginal).toBeLessThanOrEqual(guard + 1e-6);
    });

    it('no realistic legal piece, in any slot, exceeds its (role, slot) max-allocation guard for any role', () => {
        // A single assertion over the worst violation found, not one
        // `expect` per candidate piece x role x slot (well over a
        // million) — vitest's per-assertion bookkeeping dominates the
        // runtime at that count, dwarfing the actual arithmetic. Checked
        // against getIdealMaxGuard: a realistic piece is expected to, and
        // routinely does, exceed getIdealMarginal (the mean) — that is the
        // whole point of the mean-based redefinition, not a defect.
        let worst: { role: ShipTypeName; slot: GearSlotName; overshoot: number } | null = null;
        for (const role of roles) {
            for (const slot of GEAR_SLOT_ORDER) {
                const guard = getIdealMaxGuard(role, slot);
                for (const piece of piecesBySlot.get(slot) ?? []) {
                    const marginal = scorePieceForRole(piece, role);
                    const overshoot = marginal - guard;
                    if (overshoot > 1e-6 && (!worst || overshoot > worst.overshoot)) {
                        worst = { role, slot, overshoot };
                    }
                }
            }
        }
        expect(worst).toBeNull();
    }, 20000);

    it('feeding the same realistic pieces through buildCoverageMatrix never trips the tripwire', () => {
        // A companion to the direct assertion above: this exercises the
        // PRODUCTION path (buildCoverageMatrix -> computePriority), so a
        // regression shows up as a thrown tripwire here even if the direct
        // ceiling assertion above were somehow bypassed. Same order of
        // work as that test, so it gets the same explicit timeout rather
        // than relying on the default.
        for (const slot of GEAR_SLOT_ORDER) {
            const pieces = (piecesBySlot.get(slot) ?? []).map((piece, i) => ({
                ...piece,
                id: `${piece.id}-${i}`,
            }));
            expect(() => buildCoverageMatrix(pieces)).not.toThrow();
        }
    }, 20000);
});

describe('describeIdealPiece', () => {
    // The inspector exists to let a real player eyeball the ideal against
    // game knowledge, so the one property that keeps it honest is that its
    // score can never drift from the score the metric actually divides by —
    // both must read the exact same cached search result.
    it('agrees with getIdealMarginal on score for all 72 (role, slot) pairs', () => {
        // Pins the loop itself running all 72 iterations, not just passing
        // vacuously on an empty or short-circuited one.
        expect.assertions(72);
        for (const role of Object.keys(SHIP_TYPES)) {
            for (const slot of GEAR_SLOT_ORDER) {
                expect(describeIdealPiece(role, slot).score).toBe(getIdealMarginal(role, slot));
            }
        }
    });

    it('returns a composition that itself scores to the reported maxScore', () => {
        // Feeding the reported mainStat/subStats/setBonus back through the
        // same scoring path the search itself uses proves the composition
        // is genuinely what was found, not a coincidentally-matching stand-in.
        // The composition IS the MAX allocation (a mean has no single
        // composition to show — see `IdealPieceComposition`'s doc), so it
        // scores back to `maxScore`, not `score` (the mean `getIdealMarginal`
        // returns).
        const { mainStat, subStats, setBonus, maxScore } = describeIdealPiece('ATTACKER', 'weapon');
        const piece: GearPiece = {
            id: 'described-ideal-replica',
            slot: 'weapon',
            level: COVERAGE_MIN_LEVEL,
            stars: 6,
            rarity: 'legendary',
            mainStat,
            subStats,
            setBonus,
        };
        expect(scorePieceForRole(piece, 'ATTACKER')).toBeCloseTo(maxScore, 6);
    });
});

describe('cold ideal-piece build performance', () => {
    it('builds all 72 (role, slot) ideal pieces from a cold cache well under budget', () => {
        // Regression guard for the ~3s UI freeze the grid used to cause on
        // first paint (every ideal is built, and only then, cached). The
        // real budget for the whole matrix is 250ms; this asserts a much
        // more generous 1000ms so it isn't flaky on a loaded CI runner or a
        // slow dev machine — it exists to catch a regression back toward
        // an exhaustive (unpruned) search, not to enforce the tight budget.
        resetIdealPieceCachesForTests();
        const start = performance.now();
        buildCoverageMatrix([]);
        const elapsed = performance.now() - start;
        expect(elapsed).toBeLessThan(1000);
    });
});
