/**
 * A zero-enemy healing run is a legitimate scenario: nothing shoots back, so every heal is
 * overheal and the report shows pure output. The adapter represents "no enemies" as an inert
 * PRACTICE TARGET rather than letting the run fall to the engine's vestigial dummy — whose
 * 10,000 defence rebased every `basis:'damage-dealt'` rider (measured: totalDirectHeal 3,876
 * with one real enemy at defence 1,000 -> 1,290 with none).
 *
 * The kit here carries a damage clause AND a `basis:'damage-dealt'` repair rider, which is what
 * makes the LAST case (the parametrized stat-basis one) non-vacuous: the healer's own output is
 * SENSITIVE to the opponent's defence, so pinning "zero enemies == one 0-attack default card"
 * actually pins the stat basis. A pure `basis:'hp'` heal would pass that assertion at any defence,
 * including 0. That case runs at healer crit 0, 50 and 100 — see its own comment for why.
 */
import { describe, it, expect } from 'vitest';
import {
    simulateHealing,
    PRACTICE_TARGET_ID,
    HealingSimulationInput,
    HealerStats,
    EnemyAttackerInput,
} from '../healingEngineAdapter';
import { setupKeyedTestRng } from '../rateAccumulator';
import {
    DEFAULT_ENEMY_DEFENCE,
    DEFAULT_ENEMY_HP,
    DEFAULT_ENEMY_SECURITY,
    DEFAULT_ENEMY_SPEED,
} from '../healingDefaultEnemy';
import { Ability, ShipSkills } from '../../../types/abilities';
import { parsePattern, parseTarget } from '../../targetingParser';

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `pt_${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

const HEALER: HealerStats = {
    hp: 50_000,
    attack: 10_000,
    defence: 1_000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    healModifier: 0,
    hacking: 200,
    speed: 300,
};

/** A cast that damages the opponent AND repairs 50% of the damage it dealt — the F7 rider path,
 *  i.e. the one shape whose healing numbers move when the opponent's defence moves. */
const damageWithRider = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                ab({
                    type: 'damage',
                    target: 'enemy',
                    config: { type: 'damage', multiplier: 100 },
                }),
                ab({
                    type: 'heal',
                    target: 'self',
                    config: { type: 'heal', pct: 50, basis: 'damage-dealt' },
                }),
            ],
        },
    ],
});

/** `crit`/`critDamage` are knobs for the parametrized stat-basis case below; every other case
 *  leaves both at the HEALER defaults of 0. */
const BASE = (
    enemies: EnemyAttackerInput[],
    crit = HEALER.crit,
    critDamage = HEALER.critDamage
): HealingSimulationInput => ({
    healer: { ...HEALER, crit, critDamage },
    chargeCount: 0,
    shipSkills: damageWithRider(),
    selfBuffs: [],
    healTargetId: 'healer',
    enemies,
    rounds: 3,
    healerPosition: 'M3',
    healerTargeting: {
        active: { target: parseTarget('front'), pattern: parsePattern('Pattern-Base') },
    },
});

describe('healing with no enemies — the practice target', () => {
    it('runs, and the opponent is the practice target rather than the dummy', () => {
        idc = 0;
        setupKeyedTestRng(12345);
        const result = simulateHealing(BASE([]));
        // PRESENCE, not value: a `> 0`-guarded display regression shows up as a vanished row,
        // never as a wrong number.
        expect(result.rounds).toHaveLength(3);
        expect(result.rounds.some((r) => r.directHeal > 0)).toBe(true);
        // `perTargetDealt` is the only non-silent proof of WHICH opponent the cast landed on: it is
        // populated exclusively by the per-victim positional apply, and the dummy — being
        // position-less — never appears in it (engine.ts:4174's `roundPerTargetDealt` stays empty on
        // a non-positional round, and RoundData omits the field entirely). Naming the victim
        // is therefore what distinguishes "the practice target took the hit" from "the run quietly
        // fell through to the sink".
        expect(Object.keys(result.rounds[0].perTargetDealt?.attacker ?? {})).toContain(
            PRACTICE_TARGET_ID
        );
    });

    it('the practice target never attacks, so every heal is overheal on a full-HP target', () => {
        idc = 0;
        setupKeyedTestRng(12345);
        const result = simulateHealing(BASE([]));
        expect(result.summary.totalEffectiveHealing).toBe(0);
        expect(result.summary.totalOverheal).toBeGreaterThan(0);
        // The healer took nothing: that is what "nothing shoots back" means, and it is the reason
        // every point landed as overheal rather than the healer simply never casting.
        expect(result.rounds.every((r) => r.incomingDamage === 0)).toBe(true);
    });

    // PARAMETRIZED OVER THE HEALER'S CRIT on purpose (final-review Minor 5): the
    // `healingEngineAdapter` doc block cites equality "at healer crit 0, 50 and 100", and this is
    // the case that makes that citation true.
    //
    // ⚠️ `CRIT_DAMAGE` IS WHAT MAKES THE SWEEP MEAN ANYTHING, and it is 100 rather than the HEALER
    // default of 0 for exactly that reason. Measured: with `critDamage: 0` a crit multiplies by
    // `1 + 0/100` = 1, so all three arms produce the identical 6,248 / [2083, 2083, 2083] and the
    // sweep degenerates into three copies of the crit-0 case. At `critDamage: 100` the three arms
    // separate — crit 0 → 6,248 / [2083, 2083, 2083] (no crit fires), crit 50 → 16,662 /
    // [4166, 4166, 8331] (a gate that both misses and hits inside one window), crit 100 → 24,994 /
    // [8331, 8331, 8331] (always) — so the equality is being asserted across three genuinely
    // different magnitude profiles, including a MIXED one. `makeRateGate` draws at every rate
    // (rateAccumulator.ts), so what varies across the arms is which branch is TAKEN, not whether
    // the stream is touched; without a live critDamage that difference is invisible in the output.
    // Both runs are re-seeded identically before each call, so a divergence here would mean the
    // practice target and the 0-attack card really do drive the simulation differently.
    it.each([0, 50, 100])(
        'carries the default enemy card stats at healer crit %i, so removing every enemy changes only incoming damage',
        (crit) => {
            /** See the block comment above: 0 would make the crit sweep inert. */
            const CRIT_DAMAGE = 100;
            /** The card a user adds on a fresh page, minus its attack — id is the only difference. */
            const inertDefaultCard: EnemyAttackerInput = {
                id: 'e1',
                stats: {
                    attack: 0,
                    crit: 0,
                    critDamage: 0,
                    speed: DEFAULT_ENEMY_SPEED,
                    defence: DEFAULT_ENEMY_DEFENCE,
                    hp: DEFAULT_ENEMY_HP,
                    security: DEFAULT_ENEMY_SECURITY,
                },
                chargeCount: 0,
                startCharged: false,
            };

            idc = 0;
            setupKeyedTestRng(12345);
            const zero = simulateHealing(BASE([], crit, CRIT_DAMAGE));
            idc = 0;
            setupKeyedTestRng(12345);
            const one = simulateHealing(BASE([inertDefaultCard], crit, CRIT_DAMAGE));

            // A 0-attack default card and the practice target differ only by id, so the healer's own
            // output must be identical. This is what pins the stat basis.
            expect(zero.summary.totalDirectHeal).toBe(one.summary.totalDirectHeal);
            // ...and not just in the total: the PER-ROUND series has to match too, or a run that
            // front-loads and a run that back-loads the same sum would read as equal.
            expect(zero.rounds.map((r) => r.directHeal)).toEqual(
                one.rounds.map((r) => r.directHeal)
            );

            // ⚠️ ANTI-VACUITY, load-bearing. The assertion above is only worth anything if this
            // fixture's healing is actually SENSITIVE to the opponent's defence — otherwise it would
            // pass with the practice target at defence 0, which is precisely the silent
            // damage-maximising drift the shared stat block exists to prevent.
            idc = 0;
            setupKeyedTestRng(12345);
            const softer = simulateHealing(
                BASE(
                    [{ ...inertDefaultCard, stats: { ...inertDefaultCard.stats, defence: 0 } }],
                    crit,
                    CRIT_DAMAGE
                )
            );
            expect(softer.summary.totalDirectHeal).toBeGreaterThan(zero.summary.totalDirectHeal);
        }
    );
});
