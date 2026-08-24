/**
 * #345 — Valkyrie's Echoing Burst repair fires on HER OWN burst, and on nothing else.
 *
 *     "When an Echoing Burst explodes on an enemy, this Unit and the ally with the lowest
 *      current health percentage repair 5% of damage dealt."
 *
 * The engine had this backwards on both halves. Her repair parsed to `on-bomb-detonated` — a
 * VICTIM-scoped trigger riding the `bomb-detonated` event — while her Echoing Burst is an
 * ACCUMULATOR, and `processAccumulators` emitted nothing at all. So the repair fired on any
 * Bomb bursting on an enemy (including bombs she never applied) and never once on the effect
 * its own text names. Owner-confirmed 2026-08-21: only her own Echoing Burst may fire it.
 *
 * The fix is an `accumulator-detonated` event plus an APPLIER-scoped
 * `on-own-echoing-burst-detonated` trigger. Bombs keep `bomb-detonated` untouched, so
 * Demolisher's splash and Lingshe's Stealth grant are unreachable from here.
 *
 * Valkyrie's passive runs through the REAL production path — verbatim skill text from
 * docs/ship-skills.csv through `buildShipAbilities` — so a parser regression that re-points her
 * repair at the bomb trigger fails HERE too, not only in the parser suite.
 *
 * Crit 0 and healModifier 0 everywhere → every repair is an exact integer, no RNG is drawn.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import type { Ship } from '../../../types/ship';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { CombatActor, PendingAccumulator, PendingBomb } from '../state';
import type { Position } from '../../../types/encounters';
import { parsePattern, parseTarget } from '../../targetingParser';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

/** Valkyrie's R1 passive, verbatim from docs/ship-skills.csv (first passive column). */
const VALKYRIE_R1 =
    'This Unit gains <unit-skill>Speed Up II</unit-skill> for 1 turn at the start of the round.' +
    '<br /><br />When an <unit-aid>Echoing Burst</unit-aid> explodes on an enemy, this Unit and ' +
    'the ally with the lowest current health percentage <unit-damage>repair 5%</unit-damage> of ' +
    'damage dealt.';

const valkyriePassive = (): Ability[] =>
    buildShipAbilities({
        refits: [],
        firstPassiveSkillText: VALKYRIE_R1,
    } as unknown as Ship).slots.find((s) => s.slot === 'passive')?.abilities ?? [];

/** Mutation guard: the two repairs this whole file is about must actually be in the kit. */
describe('#345 extracted shape (mutation guard)', () => {
    it("Valkyrie's R1 passive carries two APPLIER-scoped Echoing Burst repairs", () => {
        const repairs = valkyriePassive().filter((a) => a.type === 'heal');
        expect(repairs).toHaveLength(2);
        for (const r of repairs) {
            // The whole point of #345: NOT 'on-bomb-detonated'.
            expect(r.trigger).toBe('on-own-echoing-burst-detonated');
            expect(r.config).toMatchObject({ type: 'heal', pct: 5, basis: 'damage-dealt' });
        }
        expect(repairs.map((r) => r.target).sort()).toEqual(['lowest-hp-ally', 'self']);
    });
});

let idc = 0;
const damageAbility = (multiplier: number): Ability => ({
    id: `ebd${++idc}`,
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier },
});

const skills = (active: number, passive: Ability[] = []): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: [damageAbility(active)] },
        ...(passive.length > 0 ? [{ slot: 'passive' as const, abilities: passive }] : []),
    ],
});

const accumulator = (sourceId: string, pct = 100): PendingAccumulator => ({
    accumulated: 0,
    pct,
    roundsRemaining: 1,
    sourceId,
});

/** A bomb that bursts on the holder's next turn, for the same payout as the accumulator below. */
const bomb = (sourceId: string, damagePerStack: number): PendingBomb => ({
    countdown: 1,
    damagePerStack,
    stacks: 1,
    tier: 15,
    sourceId,
    affinityMult: 1,
    detonationDamageModifier: 0,
    splashModifier: 0,
});

const enemyAt = (
    id: string,
    position: Position,
    attack: number,
    speed: number,
    shipSkills: ShipSkills
): EnemyAttacker => ({
    id,
    stats: { attack, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    shipSkills,
});

/** Valkyrie as the player focus: 1000 attack, one 100% cast, her real R1 passive. */
const BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    attack: 1000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: skills(100, valkyriePassive()),
    numRounds: 2,
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
    healModifier: 0,
    healTargetId: 'attacker',
    mode: 'healing', // reactive repairs only resolve in healing mode
    speed: 100,
    position: 'M4',
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    enemyAttackers: [enemyAt('enemy-front', 'M4', 0, 1, skills(0))],
    ...overrides,
});

interface Run {
    repairs: Extract<CombatEvent, { type: 'reactive-heal-performed' }>[];
    bursts: Extract<CombatEvent, { type: 'bomb-detonated' }>[];
}

const run = (input: CombatEngineInput): Run => {
    const bus = createEventBus();
    const repairs: Run['repairs'] = [];
    const bursts: Run['bursts'] = [];
    bus.on('reactive-heal-performed', (e) => repairs.push(e));
    bus.on('bomb-detonated', (e) => bursts.push(e));
    runCombat({ ...input, bus });
    return { repairs, bursts };
};

describe('#345 — the repair fires on an Echoing Burst, not on a Bomb', () => {
    it("fires on Valkyrie's OWN Echoing Burst, for 5% of the burst", () => {
        // The focus deals 1000 direct on its turn; the enemy's turn follows and bursts the
        // accumulator it carries for 100% of that gather → 1000 detonation damage → 5% = 50.
        const { repairs } = run(
            BASE({
                __testTapActors: (actors: CombatActor[]) => {
                    actors
                        .find((a) => a.id === 'enemy-front')
                        ?.pendingAccumulators.push(accumulator('attacker'));
                },
            })
        );
        const own = repairs.filter((e) => e.casterId === 'attacker');
        // Pre-fix: ZERO — processAccumulators announced nothing, so the passive was silent for a
        // Valkyrie running as the only bomb-family source on her team.
        expect(own).toHaveLength(1);
        expect(own[0].amount).toBe(50);
    });

    it('does NOT fire on a Bomb burst — not even one Valkyrie applied herself', () => {
        // Same payout, different mechanism: a Bomb she applied bursts on the enemy for 1000.
        // Her text names the Echoing Burst, so this must repair nothing.
        const { repairs, bursts } = run(
            BASE({
                __testTapActors: (actors: CombatActor[]) => {
                    actors
                        .find((a) => a.id === 'enemy-front')
                        ?.pendingBombs.push(bomb('attacker', 1000));
                },
            })
        );
        // Vacuity guard: the bomb really did burst, so the zero below means something.
        expect(bursts).toHaveLength(1);
        expect(bursts[0]).toMatchObject({ actorId: 'attacker', victimId: 'enemy-front' });
        expect(bursts[0].damage).toBe(1000);
        // Pre-fix: one repair per burst, driven by a mechanic her text never mentions.
        expect(repairs.filter((e) => e.casterId === 'attacker')).toHaveLength(0);
    });

    it("is APPLIER-scoped and team-symmetric: an enemy Valkyrie's burst repairs the enemy, not ours", () => {
        // Both sides field the same passive. The accumulator is the ENEMY's, and it bursts on the
        // PLAYER focus — so the enemy repairs (its own burst, on an enemy of its own) and the
        // player Valkyrie does not (someone else's burst, and it exploded on an ally).
        const { repairs } = run(
            BASE({
                speed: 1, // the enemy (speed 500) acts first, so its direct is already gathered
                enemyAttackers: [
                    enemyAt('enemy-front', 'M4', 700, 500, skills(100, valkyriePassive())),
                ],
                __testTapActors: (actors: CombatActor[]) => {
                    actors
                        .find((a) => a.id === 'attacker')
                        ?.pendingAccumulators.push(accumulator('enemy-front'));
                },
            })
        );
        // 700 enemy direct, gathered once at pct 100 → burst 700 → 5% = 35.
        const enemyRepairs = repairs.filter((e) => e.casterId === 'enemy-front');
        expect(enemyRepairs).toHaveLength(1);
        expect(enemyRepairs[0].amount).toBe(35);
        expect(repairs.filter((e) => e.casterId === 'attacker')).toHaveLength(0);
    });
});
