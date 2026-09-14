/**
 * `ally-shield-count` scaling — Zenith's "8% more direct damage for each ally with a shield",
 * combat-engine integration.
 *
 * The own-side mirror of `enemy-stealth-count` (see `stealthedEnemyCountScaling.integration
 * .test.ts`, whose harness this follows). Three things are specific to this subject and are each
 * measured here rather than assumed:
 *
 *  1. **Zenith counts ITSELF** (owner ruling 2026-09-14). Its round-start self shield therefore
 *     floors the bonus at one step on any board.
 *  2. **Only LIVING allies count.** A destroyed actor can still carry a residual `shieldPool`
 *     (killed through it by a shield-penetrating hit), and a corpse is nobody's shielded ally.
 *  3. **The bonus rides the `outgoingDamage` channel, which is DIRECT damage only** — a DoT tick
 *     is paid out of the separate `dotDamage` channel and must not move with the count.
 *
 * Damage is read off the caster's own `ability-performed` event: this is a GLOBAL count on the
 * CASTER's own side, not a per-victim gate, and every cast here is single-target and single-hit,
 * so that figure is the cast's whole direct damage.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { CombatEvent } from '../events';
import { createEventBus } from '../events';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `asc${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

const PER_UNIT = 8;

/** Zenith's built passive shape — see `buildShipAbilities.test.ts` for the parse that yields it. */
const allyShieldCountModifier = (): Ability =>
    ab({
        target: 'self',
        type: 'modifier',
        conditions: [{ subject: 'ally-shield-count', derivable: true }],
        config: {
            type: 'modifier',
            channel: 'outgoingDamage',
            value: 0,
            isMultiplicative: true,
        },
        scaling: { conditionIndex: 0, perUnit: PER_UNIT },
    });

const zenithKit = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                ab({ type: 'damage', config: { type: 'damage', multiplier: 100 } }),
                allyShieldCountModifier(),
            ],
        },
    ],
});

/** A shield pool seeded at construction, as a % of max HP — no ability, no trigger, no decay. */
const preFightShield = (pct: number): NonNullable<CombatEngineInput['preFight']> => ({
    outgoingDamage: 0,
    incomingDamage: 0,
    outgoingCritDamage: 0,
    incomingCritDamage: 0,
    outgoingHeal: 0,
    incomingHeal: 0,
    startingShieldPctOfHp: pct,
});

const POSITIONS: Position[] = ['M1', 'M2', 'M3', 'B1', 'B2'];

/** A bystander ally: no offense, high HP, optionally holding a shield pool. */
const ally = (index: number, shielded: boolean, hp = 1_000_000_000): TeamActorEngineInput => ({
    id: `ally${index}`,
    speed: 50,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position: POSITIONS[index],
    target: parsedTarget('front'),
    pattern: basePattern(),
    ...(shielded ? { preFight: preFightShield(10) } : {}),
    walk: {
        shipSkills: { slots: [] },
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 0,
            defence: 0,
            hp,
        },
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: false,
        healModifier: 0,
    },
});

/** An inert punching bag for the focus to hit. */
const dummyEnemy = (): EnemyAttacker => ({
    id: 'bag',
    stats: {
        attack: 0,
        crit: 0,
        critDamage: 0,
        defence: 0,
        hp: 1_000_000_000,
        speed: 1,
        security: 0,
    },
    chargeCount: 0,
    startCharged: false,
    position: 'M4',
    target: parsedTarget('front'),
    pattern: basePattern(),
    shipSkills: { slots: [] },
});

const base = (over: Partial<CombatEngineInput>): CombatEngineInput => ({
    attack: 10_000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: zenithKit(),
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
    hp: 1_000_000_000,
    healTargetId: 'attacker',
    mode: 'healing',
    // Slow focus: every ally and enemy has already taken its turn when the focus's own turn is
    // built, so nothing about the board is still in flight when the count is read.
    speed: 1,
    position: 'M4',
    target: parsedTarget('front'),
    pattern: basePattern(),
    enemyAttackers: [dummyEnemy()],
    ...over,
});

/** The named actor's own emitted direct damage on its first cast. */
const castDamage = (input: CombatEngineInput, actorId = 'attacker'): number => {
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    bus.on('ability-performed', (e) => events.push(e as CombatEvent));
    runCombat({ ...input, bus });
    const hit = events.find((e) => e.type === 'ability-performed' && e.actorId === actorId);
    return hit && hit.type === 'ability-performed' ? (hit.damage ?? 0) : NaN;
};

/** Focus holding `selfShield`, with `shieldedAllies` shielded and `plainAllies` unshielded allies. */
const focusRun = (args: {
    selfShield: boolean;
    shieldedAllies: number;
    plainAllies?: number;
}): number => {
    idc = 0;
    const allies: TeamActorEngineInput[] = [];
    for (let i = 0; i < args.shieldedAllies; i++) allies.push(ally(allies.length, true));
    for (let i = 0; i < (args.plainAllies ?? 0); i++) allies.push(ally(allies.length, false));
    return castDamage(
        base({
            teamActors: allies,
            ...(args.selfShield ? { preFight: preFightShield(10) } : {}),
        })
    );
};

describe('ally-shield-count scaling — the count', () => {
    it('nobody shielded → no bonus', () => {
        expect(focusRun({ selfShield: false, shieldedAllies: 0 })).toBeGreaterThan(0);
    });

    it('the caster COUNTS ITSELF: its own shield alone is one step', () => {
        const bare = focusRun({ selfShield: false, shieldedAllies: 0 });
        expect(focusRun({ selfShield: true, shieldedAllies: 0 })).toBeCloseTo(
            bare * (1 + PER_UNIT / 100),
            6
        );
    });

    it('scales linearly and uncapped: five shielded ships is five steps', () => {
        const bare = focusRun({ selfShield: false, shieldedAllies: 0 });
        for (const allies of [1, 2, 3, 4]) {
            expect(focusRun({ selfShield: true, shieldedAllies: allies })).toBeCloseTo(
                bare * (1 + (PER_UNIT * (allies + 1)) / 100),
                6
            );
        }
    });

    it('an UNSHIELDED ally is not counted — it is the pool that counts, not the headcount', () => {
        const withPlain = focusRun({ selfShield: true, shieldedAllies: 0, plainAllies: 4 });
        expect(withPlain).toBeCloseTo(focusRun({ selfShield: true, shieldedAllies: 0 }), 6);
    });
});

describe('ally-shield-count scaling — a corpse does not count', () => {
    // The ally holds a 1,000-point pool and 1 HP, and the enemy kills it through the pool with
    // 100% shield penetration — so it is destroyed in round 1 with its shieldPool INTACT. If the
    // count gated on `shieldPool > 0` alone it would keep counting the corpse forever.
    const shieldPenKiller = (): EnemyAttacker => ({
        id: 'penetrator',
        stats: {
            attack: 1_000_000,
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp: 1_000_000_000,
            speed: 1_000,
            security: 0,
            shieldPenetration: 100,
        },
        chargeCount: 0,
        startCharged: false,
        position: 'M4',
        target: parsedTarget('back'),
        pattern: basePattern(),
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 100 } }),
                    ],
                },
            ],
        },
    });

    const runWithDoomedAlly = (allyHp: number): number => {
        idc = 0;
        return castDamage(
            base({
                preFight: preFightShield(10),
                teamActors: [ally(0, true, allyHp)],
                enemyAttackers: [shieldPenKiller()],
            })
        );
    };

    it('a shielded ally that survives counts; the same ally killed through its shield does not', () => {
        const alive = runWithDoomedAlly(1_000_000_000);
        const dead = runWithDoomedAlly(1);
        // Two steps (self + ally) while it lives, one step (self alone) once it is a corpse.
        expect(alive / dead).toBeCloseTo((1 + (2 * PER_UNIT) / 100) / (1 + PER_UNIT / 100), 6);
    });
});

describe('ally-shield-count scaling — DIRECT damage only', () => {
    // The `outgoingDamage` channel and the `dotDamage` channel are separate folds. This measures
    // that separation rather than trusting it: the same kit, the same Corrosion, the count moved
    // from one to five — the ticks must not budge while the direct hit scales.
    const corrosionKit = (): ShipSkills => ({
        slots: [
            {
                slot: 'active',
                abilities: [
                    ab({ type: 'damage', config: { type: 'damage', multiplier: 100 } }),
                    ab({
                        type: 'dot',
                        config: {
                            type: 'dot',
                            dotType: 'corrosion',
                            tier: 9,
                            stacks: 1,
                            duration: 5,
                        },
                    }),
                    allyShieldCountModifier(),
                ],
            },
        ],
    });

    const run = (shieldedAllies: number): { direct: number; ticks: number } => {
        idc = 0;
        const allies: TeamActorEngineInput[] = [];
        for (let i = 0; i < shieldedAllies; i++) allies.push(ally(i, true));
        const bus = createEventBus();
        const events: CombatEvent[] = [];
        bus.on('ability-performed', (e) => events.push(e as CombatEvent));
        bus.on('dot-ticked', (e) => events.push(e as CombatEvent));
        runCombat({
            ...base({
                shipSkills: corrosionKit(),
                numRounds: 3,
                teamActors: allies,
                preFight: preFightShield(10),
            }),
            bus,
        });
        const first = events.find(
            (e) => e.type === 'ability-performed' && e.actorId === 'attacker'
        );
        return {
            direct: first && first.type === 'ability-performed' ? (first.damage ?? 0) : NaN,
            ticks: events.reduce((sum, e) => (e.type === 'dot-ticked' ? sum + e.damage : sum), 0),
        };
    };

    it('the DoT ticks are identical at 1 and 5 shielded ships while the direct hit scales', () => {
        const one = run(0);
        const five = run(4);
        expect(one.ticks).toBeGreaterThan(0); // the axis can move at all
        expect(five.ticks).toBeCloseTo(one.ticks, 6);
        expect(five.direct / one.direct).toBeCloseTo(
            (1 + (5 * PER_UNIT) / 100) / (1 + PER_UNIT / 100),
            6
        );
    });
});

describe('ally-shield-count scaling — team symmetry', () => {
    // The identical kit on an ENEMY-side carrier, counting the ENEMY roster's shields. Its own
    // pool is the one step it always has; a second shielded enemy adds the second.
    const enemyZenith = (shielded: boolean): EnemyAttacker => ({
        id: 'enemy-zenith',
        stats: {
            attack: 10_000,
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp: 1_000_000_000,
            speed: 10,
            security: 0,
        },
        chargeCount: 0,
        startCharged: false,
        position: 'M4',
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills: zenithKit(),
        ...(shielded ? { preFight: preFightShield(10) } : {}),
    });

    const shieldedEnemyBystander = (): EnemyAttacker => ({
        id: 'enemy-bystander',
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp: 1_000_000_000,
            speed: 5,
            security: 0,
        },
        chargeCount: 0,
        startCharged: false,
        position: 'M3',
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills: { slots: [] },
        preFight: preFightShield(10),
    });

    const enemySideDamage = (enemies: EnemyAttacker[]): number => {
        idc = 0;
        return castDamage(
            base({ shipSkills: { slots: [] }, enemyAttackers: enemies }),
            'enemy-zenith'
        );
    };

    it('an enemy-side carrier gets the same step per shielded actor on ITS OWN side', () => {
        const bare = enemySideDamage([enemyZenith(false)]);
        expect(enemySideDamage([enemyZenith(true)])).toBeCloseTo(bare * (1 + PER_UNIT / 100), 6);
        expect(enemySideDamage([enemyZenith(true), shieldedEnemyBystander()])).toBeCloseTo(
            bare * (1 + (2 * PER_UNIT) / 100),
            6
        );
    });

    it("a PLAYER-side shield does not feed the enemy carrier's count (own side only)", () => {
        const enemyOnly = enemySideDamage([enemyZenith(true)]);
        idc = 0;
        const withShieldedPlayers = castDamage(
            base({
                shipSkills: { slots: [] },
                preFight: preFightShield(10),
                teamActors: [ally(0, true), ally(1, true)],
                enemyAttackers: [enemyZenith(true)],
            }),
            'enemy-zenith'
        );
        expect(withShieldedPlayers).toBeCloseTo(enemyOnly, 6);
    });
});
