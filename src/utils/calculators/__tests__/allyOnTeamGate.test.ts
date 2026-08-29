/**
 * #426 — the `ally-on-team` gate must be a LIVE roster check on the calculator paths.
 *
 * Isha and Nayra are the corpus's only two instances ("If Nayra is on the same team, it also
 * gains Defensive Affinity Override", and the mirror). Before this fix no ship name reached the
 * engine's `nameByActorId` from either calculator, so `allyTeamNames` was undefined and
 * `evaluateCondition` took its assume-met branch — Nayra alone read as though Isha were beside
 * her.
 *
 * The gate is exercised through a +100% attack modifier rather than an Affinity Override buff
 * because a modifier's effect is a NUMBER in the result; an Override's is not.
 */
import { describe, expect, it } from 'vitest';
import { simulateDPS, DPSSimulationInput } from '../dpsSimulator';
import { setupKeyedTestRng } from '../rateAccumulator';
import { Ability, Condition, ShipSkills } from '../../../types/abilities';

let idCounter = 0;
const ab = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `a${++idCounter}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...partial,
});

const BASE: DPSSimulationInput = {
    attack: 15000,
    // Crit OFF. The suite seeds the RNG once per `it`, not per simulation, so several sims inside
    // one test walk a single stream and drift apart for reasons that have nothing to do with the
    // gate. `total()` re-seeds as well, but a crit-free run needs no luck to be comparable.
    crit: 0,
    critDamage: 150,
    defensePenetration: 10,
    chargeCount: 0,
    enemyDefense: 8000,
    // Large enough that the enemy survives the window in every arm — a kill would truncate the
    // run and make the totals incomparable for reasons unrelated to the gate.
    enemyHp: 4_000_000,
    rounds: 6,
    selfBuffs: [],
    enemyDebuffs: [],
    hacking: 250,
    enemySecurity: 100,
    defence: 6000,
    hp: 30000,
};

// The REAL kit shape: Isha/Nayra's gate sits on a passive-slot BUFF with a `start-of-round`
// trigger ("At the start of the round this Unit gains ..."). That is a live trigger, so the
// ability is reactive and its conditions are evaluated through the intent-drain context — which
// is the only context that carries `allyTeamNames`. A gate on an `on-cast` modifier resolves
// somewhere else entirely and would test nothing about this defect.
const skills = (conditions: Condition[]): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [ab({ type: 'damage', config: { type: 'damage', multiplier: 150 } })],
        },
        {
            slot: 'passive',
            abilities: [
                ab({
                    type: 'buff',
                    target: 'self',
                    trigger: 'start-of-round',
                    conditions,
                    config: {
                        type: 'buff',
                        buffName: 'Attack Up',
                        parsedEffects: { attack: 100 },
                        stacks: 1,
                        isStackable: false,
                        duration: 'recurring',
                    },
                }),
            ],
        },
    ],
});

const ALLY_GATE: Condition[] = [{ subject: 'ally-on-team', derivable: false, buffName: 'Isha' }];

const total = (conditions: Condition[], extra: Partial<DPSSimulationInput> = {}) => {
    idCounter = 0;
    setupKeyedTestRng(4242);
    return simulateDPS({ ...BASE, shipSkills: skills(conditions), ...extra }).summary.totalDamage;
};

/** A walked team actor. `stats`/`shipSkills` are what make it a real actor in the turn order;
 *  `name` is the field under test. */
const teamActor = (id: string, name?: string) => ({
    id,
    speed: 40,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    shipSkills: {
        slots: [
            {
                slot: 'active' as const,
                abilities: [ab({ type: 'damage', config: { type: 'damage', multiplier: 10 } })],
            },
        ],
    },
    stats: {
        attack: 1000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        hacking: 200,
        defence: 1000,
        hp: 20000,
    },
    ...(name ? { name } : {}),
});

describe('#426 ally-on-team gate on the DPS path', () => {
    // The instrument: `ungated` and `withheld` must differ, or every assertion below is vacuous.
    // `withheld` uses a gate independently known to read NOT-met in DPS mode (no live enemy-buff
    // data — the same fact golden scenario 23 locks).
    const ungated = () => total([]);
    const withheld = () => total([{ subject: 'enemy-buff', derivable: true, buffName: 'Stealth' }]);

    it('instrument: a not-met gate does move the total (else the rest proves nothing)', () => {
        expect(withheld()).toBeLessThan(ungated());
    });

    it('a NAMED focus whose required ally is absent reads the gate NOT-met', () => {
        // Nayra alone. Before #426 this returned `ungated` — the +100% applied to a solo ship
        // because the roster check could not be made and assumed the best.
        expect(total(ALLY_GATE, { name: 'Nayra' })).toBe(withheld());
    });

    it('a NAMED focus with the required ally on the team reads the gate MET', () => {
        expect(
            total(ALLY_GATE, { name: 'Nayra', teamActors: [teamActor('t1', 'Isha')] })
        ).toBeGreaterThan(withheld());
    });

    it('a team ally with a DIFFERENT name does not satisfy the gate', () => {
        expect(total(ALLY_GATE, { name: 'Nayra', teamActors: [teamActor('t1', 'Crocus')] })).toBe(
            total(ALLY_GATE, { name: 'Nayra', teamActors: [teamActor('t1', 'Crocus')] })
        );
        expect(
            total(ALLY_GATE, { name: 'Nayra', teamActors: [teamActor('t1', 'Crocus')] })
        ).toBeLessThan(total(ALLY_GATE, { name: 'Nayra', teamActors: [teamActor('t1', 'Isha')] }));
    });

    it('an UNNAMED focus keeps the assume-met fallback (manual config, unchanged)', () => {
        // The fallback exists for a config with no ship picked: "is X on the same team" cannot be
        // asked, so it is not answered NO. This arm is what makes the fix safe for manual configs.
        expect(total(ALLY_GATE)).toBe(ungated());
    });

    it('an unnamed TEAM actor cannot satisfy the gate once the focus is named', () => {
        // Mixed run: naming the focus switches the gate live, and a manual (unnamed) team slot
        // then cannot match a name gate. Conservative, and the same contract `role`/`faction`
        // already have for manual slots.
        expect(total(ALLY_GATE, { name: 'Nayra', teamActors: [teamActor('t1')] })).toBeLessThan(
            total(ALLY_GATE, { name: 'Nayra', teamActors: [teamActor('t1', 'Isha')] })
        );
    });
});
