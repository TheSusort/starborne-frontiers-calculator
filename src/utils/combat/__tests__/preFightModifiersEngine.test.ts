/**
 * Sub-project F, PR F3 — engine-level tests for the `CombatActor.preFight` modifier
 * baseline, exercising the fold sites the battle-sim integration tests cannot isolate:
 *
 *   1. createActor shield seeding (`startingShieldPctOfHp` → shieldPool; absent → 0).
 *   2. Victim-side `incomingDamage` riding the per-victim D-PR12 channel, observed
 *      through `__testTapVictimEnemyModifiers`.
 *   3. Heal channels: caster `outgoingHeal` and recipient `incomingHeal` (incl. the
 *      PRE-FIRST-TURN receipt via the engine's recipientIncomingHealPct fallback, and
 *      the no-double-count proof once the recipient has a turn ctx).
 *   4. The AGGREGATE (non-positional, legacy healing path) crit-family mirror for
 *      `outgoingCritDamage` (attacker-side) and `incomingCritDamage` (victim-side).
 *
 * Harness patterns: shieldGrantBattleSim.test.ts (heal/team walk + __testTapActors) and
 * victimEnemyModifiers.test.ts (modifier tap).
 */
import { describe, it, expect } from 'vitest';
import { CombatActor, createActor } from '../state';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus } from '../events';
import { deriveTeamEngineActors } from '../../calculators/dpsSimulator';
import { emptyPreFightModifiers } from '../preFight';
import type { PreFightCombatModifiers } from '../preFight';
import { ShipSkills } from '../../../types/abilities';
import { TeamActorInput } from '../../../types/calculator';
import { bareEnemy as inertOpponent, BARE_ENEMY_ID } from '../__testutils__/bareRosterFixture';

const preFight = (overrides: Partial<PreFightCombatModifiers>): PreFightCombatModifiers => ({
    ...emptyPreFightModifiers(),
    ...overrides,
});

const BASE_STATS = {
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    shieldPenetration: 0,
    defence: 0,
    hp: 40_000,
    speed: 100,
};

describe('F3 — createActor pre-fight shield seeding', () => {
    it('seeds shieldPool = startingShieldPctOfHp% of max HP', () => {
        const actor = createActor({
            id: 'x',
            side: 'player',
            kind: 'attacker',
            stats: { ...BASE_STATS },
            preFight: preFight({ startingShieldPctOfHp: 20 }),
        });
        expect(actor.shieldPool).toBe(8_000);
    });

    it('absent preFight (and an all-zero block) → shieldPool 0 (byte-identical seeding)', () => {
        const bare = createActor({
            id: 'x',
            side: 'player',
            kind: 'attacker',
            stats: { ...BASE_STATS },
        });
        expect(bare.shieldPool).toBe(0);
        expect(bare.preFight).toBeUndefined();
        const zeroed = createActor({
            id: 'y',
            side: 'enemy',
            kind: 'enemy',
            stats: { ...BASE_STATS },
            preFight: emptyPreFightModifiers(),
        });
        expect(zeroed.shieldPool).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Shared runCombat harness
// ---------------------------------------------------------------------------

const emptySkills = (): ShipSkills => ({ slots: [{ slot: 'active', abilities: [] }] });

const BASE_INPUT = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    // SP-4b-2b: a run needs an opponent. Imported ALIASED — this file already owns a local
    // `bareEnemy(crit, pf)` further down with a different signature (the crit-family mirror's
    // attacker), and shadowing it would silently retarget those four cases.
    enemyAttackers: inertOpponent(),
    attack: 1000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: emptySkills(),
    numRounds: 1,
    selfBuffs: [],
    enemyDebuffs: [],
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: 40_000,
    ...overrides,
});

describe('F3 — victim-side incomingDamage rides the per-victim modifier channel', () => {
    it('folds the actor’s preFight.incomingDamage into victimIncomingModifiers (its own id only)', () => {
        let captured:
            | ((victimId: string) => {
                  enemyDefenseModifier: number;
                  incomingDamageModifier: number;
              })
            | undefined;
        runCombat(
            BASE_INPUT({
                preFight: preFight({ incomingDamage: -5 }),
                __testTapVictimEnemyModifiers: (fn) => {
                    captured = fn;
                },
            })
        );
        expect(captured).toBeDefined();
        // The focus actor's own per-victim read carries its pre-fight protection…
        expect(captured!('attacker')).toEqual({
            enemyDefenseModifier: 0,
            incomingDamageModifier: -5,
        });
        // …and does NOT bleed onto other actors: neither the vestigial dummy sink nor the real
        // positioned opponent has any preFight of its own.
        expect(captured!('enemy')).toEqual({
            enemyDefenseModifier: 0,
            incomingDamageModifier: 0,
        });
        expect(captured!(BARE_ENEMY_ID)).toEqual({
            enemyDefenseModifier: 0,
            incomingDamageModifier: 0,
        });
    });

    // The no-bleed control above is weak ON ITS OWN: `victimIncomingModifiers` returns {0,0} for
    // ANY id it does not know, so `captured!(BARE_ENEMY_ID)` reading zeros is equally consistent
    // with "the roster entry has no preFight" and with "the reader has never heard of that id".
    // This case supplies the discriminator by giving the ROSTER ENTRY its own preFight: if the
    // reader resolves the id at all, it must report -9 here. Together the two cases say what the
    // first alone could not — the read is id-scoped, not merely quiet.
    it('resolves a ROSTER member’s own preFight by id (discriminates the no-bleed control above)', () => {
        let captured:
            | ((victimId: string) => {
                  enemyDefenseModifier: number;
                  incomingDamageModifier: number;
              })
            | undefined;
        runCombat(
            BASE_INPUT({
                enemyAttackers: inertOpponent({ preFight: preFight({ incomingDamage: -9 }) }),
                __testTapVictimEnemyModifiers: (fn) => {
                    captured = fn;
                },
            })
        );
        expect(captured).toBeDefined();
        expect(captured!(BARE_ENEMY_ID)).toEqual({
            enemyDefenseModifier: 0,
            incomingDamageModifier: -9,
        });
        // …and the focus, which supplied no preFight of its own this time, still reads zeros — so
        // the -9 is scoped to the roster entry rather than being a fight-wide fold.
        expect(captured!('attacker')).toEqual({
            enemyDefenseModifier: 0,
            incomingDamageModifier: 0,
        });
    });
});

// ---------------------------------------------------------------------------
// Heal channels (healing mode: focus = heal target; a fast team healer casts an
// ally-targeted 25%-of-own-HP repair each round → base heal 50,000 × 0.25 = 12,500).
// ---------------------------------------------------------------------------

const HEAL_ALLY_SKILLS = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'team-heal',
                    type: 'heal',
                    target: 'ally',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'heal', pct: 25, basis: 'hp' },
                },
            ],
        },
    ],
});

const healerTeamInput = (): TeamActorInput[] => [
    {
        id: 'team1',
        speed: 200, // acts BEFORE the focus heal target every round
        selfBuffs: [],
        enemyDebuffs: [],
        chargeCount: 0,
        startCharged: false,
        shipSkills: HEAL_ALLY_SKILLS(),
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            shieldPenetration: 0,
            hacking: 175,
            defence: 0,
            hp: 50_000,
        },
    },
];

/** Run a 2-round healing battle and return the round-order repair landed ON THE FOCUS.
 *
 *  SP-4e Task 4: `HEAL_ALLY_SKILLS` is a plain single-`'ally'` heal, which now routes over the
 *  caster's target pattern instead of `[healing.targetId]`. This fixture is non-positional, so
 *  `supportFootprintAllyIds` returns undefined and nothing narrows the pattern — the repair
 *  reaches BOTH own-side actors (the focus AND `team1`, the caster itself). `heal-performed.amount`
 *  is the whole cast's total, so it doubled. These cases are about the MODIFIER FOLD on one
 *  recipient, not about how many recipients there are, so read the focus's own `perTarget` row:
 *  that isolates the fold and stays correct however wide the recipient set gets. */
const healAmounts = (args: {
    healerPreFight?: PreFightCombatModifiers;
    focusPreFight?: PreFightCombatModifiers;
}): number[] => {
    const engineTeam = deriveTeamEngineActors(healerTeamInput(), undefined)!;
    if (args.healerPreFight) {
        engineTeam[0] = { ...engineTeam[0], preFight: args.healerPreFight };
    }
    const bus = createEventBus();
    const amounts: number[] = [];
    bus.on('heal-performed', (e) => {
        const own = e.perTarget?.find((t) => t.targetId === 'attacker');
        if (own) amounts.push(own.amount);
    });
    runCombat(
        BASE_INPUT({
            numRounds: 2,
            healTargetId: 'attacker',
            mode: 'healing',
            teamActors: engineTeam,
            ...(args.focusPreFight ? { preFight: args.focusPreFight } : {}),
            bus,
        })
    );
    return amounts;
};

describe('F3 — heal channels fold at heal time', () => {
    it("baseline: the focus's share of the ally repair is 12,500 each round (no preFight)", () => {
        expect(healAmounts({})).toEqual([12_500, 12_500]);
    });

    it('caster outgoingHeal (+15) scales the repair ×1.15', () => {
        const amounts = healAmounts({ healerPreFight: preFight({ outgoingHeal: 15 }) });
        expect(amounts).toHaveLength(2);
        for (const a of amounts) expect(a).toBeCloseTo(14_375);
    });

    it('recipient incomingHeal (+20) applies from the PRE-FIRST-TURN receipt on, with no double-count once the ctx exists', () => {
        // Round 1: the healer (speed 200) casts BEFORE the focus's first turn — the
        // recipient has no turn ctx yet, so the engine's recipientIncomingHealPct falls
        // back to preFight.incomingHeal. Round 2: the focus HAS a ctx, whose
        // incomingHealPct now FOLDS the pre-fight baseline (playerTurn scheduledTotals).
        // Equal amounts across rounds prove fallback and fold agree (a double-count
        // would make round 2 land 12,500 × 1.4).
        expect(healAmounts({ focusPreFight: preFight({ incomingHeal: 20 }) })).toEqual([
            15_000, 15_000,
        ]);
    });
});

// ---------------------------------------------------------------------------
// Aggregate (non-positional legacy healing path) crit-family mirror: a bare enemy
// attacker bombards the heal target with 1 hit of 100% × attack 1000, critDamage 50.
// crit 100 → hit = 1000 × 1.5 = 1,500; a -10 crit-family modifier → ×0.9 = 1,350.
// ---------------------------------------------------------------------------

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

const bareEnemy = (crit: number, pf?: PreFightCombatModifiers): EnemyAttacker => ({
    id: 'e1',
    stats: { attack: 1000, crit, critDamage: 50, speed: 50, defence: 0, hp: 10_000 },
    chargeCount: 0,
    startCharged: false,
    ...(pf ? { preFight: pf } : {}),
});

const focusDamageTaken = (args: {
    enemyCrit: number;
    enemyPreFight?: PreFightCombatModifiers;
    focusPreFight?: PreFightCombatModifiers;
}): number => {
    let captured: CombatActor[] = [];
    runCombat(
        BASE_INPUT({
            healTargetId: 'attacker',
            mode: 'healing',
            enemyAttackers: [bareEnemy(args.enemyCrit, args.enemyPreFight)],
            ...(args.focusPreFight ? { preFight: args.focusPreFight } : {}),
            __testTapActors: (actors) => {
                captured = actors;
            },
        })
    );
    const focus = captured.find((a) => a.id === 'attacker');
    if (!focus) throw new Error('no focus actor captured');
    return 40_000 - focus.currentHp;
};

describe('F3 — aggregate crit-family mirror (legacy non-positional enemy path)', () => {
    it('baseline: a critting bare enemy lands 1,500', () => {
        expect(focusDamageTaken({ enemyCrit: 100 })).toBeCloseTo(1_500);
    });

    it('attacker-side outgoingCritDamage -10 → its crits deal exactly 10% less', () => {
        expect(
            focusDamageTaken({
                enemyCrit: 100,
                enemyPreFight: preFight({ outgoingCritDamage: -10 }),
            })
        ).toBeCloseTo(1_350);
    });

    it('victim-side incomingCritDamage -10 → the target takes exactly 10% smaller crits', () => {
        expect(
            focusDamageTaken({
                enemyCrit: 100,
                focusPreFight: preFight({ incomingCritDamage: -10 }),
            })
        ).toBeCloseTo(1_350);
    });

    it('both crit-family modifiers are INERT on non-crit hits', () => {
        expect(
            focusDamageTaken({
                enemyCrit: 0,
                enemyPreFight: preFight({ outgoingCritDamage: -10 }),
                focusPreFight: preFight({ incomingCritDamage: -10 }),
            })
        ).toBeCloseTo(1_000);
    });
});
