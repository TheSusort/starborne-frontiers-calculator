/**
 * A repair fired by a reactive/passive trigger can crit, on the HEALER's crit rate and crit
 * power — the same rule a cast repair already follows. Game-verified: Hayyan's "repairs the ally
 * for 6% of this Unit's max HP" crit for 5,878 x 2.74 (her 174% crit power); Salvation's "repairs
 * that ally 5%" went 2,790 -> 4,297 (x1.54, her 54% crit power).
 *
 * Both abilities are the real production shapes (Hayyan via `buildShipAbilities`, Salvation as the
 * hand-built `on-ally-purged` heal the purge suite uses). Crit rates are pinned at 0 / 100 so the
 * outcome is deterministic, and `setupKeyedRng` seeds every other stream.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { Ship } from '../../../types/ship';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import { bareEnemy } from '../__testutils__/bareRosterFixture';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

beforeEach(() => setupKeyedRng(2026));

const HAYYAN_P3 =
    "When a <unit-aid>debuff</unit-aid> is inflicted on an ally, this Unit <unit-damage>repairs the ally for 6%</unit-damage> of this Unit's max HP.";
const HAYYAN_HP = 20_000;
const HAYYAN_BASE_REPAIR = HAYYAN_HP * 0.06; // 1,200
const HAYYAN_CRIT_POWER = 174;

function hayyanHeal(): Ability {
    const ship = { refits: [{}, {}, {}, {}], firstPassiveSkillText: HAYYAN_P3 } as unknown as Ship;
    const heal = buildShipAbilities(ship)
        .slots.find((s) => s.slot === 'passive')
        ?.abilities.find((a) => a.type === 'heal' && a.trigger === 'on-ally-debuffed');
    if (!heal) throw new Error('Hayyan on-ally-debuffed repair not found');
    return heal;
}

const noopActive = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        {
            id: 'noop-atk',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'damage', multiplier: 0 },
        },
    ],
});

const debuffEnemy = (id: string): EnemyAttacker => ({
    id,
    stats: { attack: 1, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 1000 },
    chargeCount: 0,
    startCharged: false,
    shipSkills: {
        slots: [
            {
                slot: 'active',
                abilities: [
                    {
                        id: 'enemy-debuff',
                        type: 'debuff',
                        target: 'enemy',
                        trigger: 'on-cast',
                        conditions: [],
                        config: {
                            type: 'debuff',
                            buffName: 'Def Down',
                            parsedEffects: {},
                            stacks: 1,
                            isStackable: false,
                            application: 'inflict',
                            duration: 1,
                        },
                    },
                ],
            },
        ],
    },
});

const hayyanTeamActor = (crit: number, critDamage: number): TeamActor => ({
    id: 'hayyan',
    speed: 80,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    walk: {
        shipSkills: { slots: [{ slot: 'passive', abilities: [hayyanHeal()] }] },
        stats: {
            attack: 0,
            crit,
            critDamage,
            defensePenetration: 0,
            hacking: 0,
            defence: 0,
            hp: HAYYAN_HP,
        },
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: false,
    },
});

const BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    enemyAttackers: bareEnemy(),
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [noopActive()] },
    numRounds: 1,
    selfBuffs: [],
    enemyDebuffs: [],
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: 1_000_000_000,
    speed: 1,
    healTargetId: 'attacker',
    mode: 'healing',
    ...overrides,
});

function sumDirectHeal(result: ReturnType<typeof runCombat>, actorId: string): number {
    return (result.healing?.rounds ?? []).reduce(
        (sum, rd) => sum + (rd.perActor.get(actorId)?.directHeal ?? 0),
        0
    );
}

describe("Hayyan's reactive repair crits on HER crit rate and crit power", () => {
    it('crit rate 100 -> the repair is base x (1 + critPower)', () => {
        const result = runCombat(
            BASE({
                teamActors: [hayyanTeamActor(100, HAYYAN_CRIT_POWER)],
                enemyAttackers: [debuffEnemy('enemy-deb')],
            })
        );
        expect(sumDirectHeal(result, 'hayyan')).toBeCloseTo(
            HAYYAN_BASE_REPAIR * (1 + HAYYAN_CRIT_POWER / 100),
            6
        );
    });

    it('crit rate 0 -> the repair never crits', () => {
        const result = runCombat(
            BASE({
                teamActors: [hayyanTeamActor(0, HAYYAN_CRIT_POWER)],
                enemyAttackers: [debuffEnemy('enemy-deb')],
            })
        );
        expect(sumDirectHeal(result, 'hayyan')).toBeCloseTo(HAYYAN_BASE_REPAIR, 6);
    });

    it('team symmetry: an enemy-side Hayyan with crit rate 100 crits her repair too', () => {
        const enemyVictim: EnemyAttacker = {
            id: 'enemy-victim',
            stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 5 },
            chargeCount: 0,
            startCharged: false,
            position: 'M4',
            shipSkills: { slots: [] },
        };
        const enemyHayyan: EnemyAttacker = {
            id: 'enemy-hayyan',
            stats: {
                attack: 0,
                crit: 100,
                critDamage: HAYYAN_CRIT_POWER,
                defence: 0,
                hp: HAYYAN_HP,
                speed: 10,
            },
            chargeCount: 0,
            startCharged: false,
            position: 'M3',
            shipSkills: { slots: [{ slot: 'passive', abilities: [hayyanHeal()] }] },
        };
        const playerDebuff: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        {
                            id: 'deb',
                            type: 'debuff',
                            target: 'enemy',
                            trigger: 'on-cast',
                            conditions: [],
                            config: {
                                type: 'debuff',
                                buffName: 'Def Down',
                                parsedEffects: {},
                                stacks: 1,
                                isStackable: false,
                                application: 'inflict',
                                duration: 5,
                            },
                        },
                    ],
                },
            ],
        };
        const result = runCombat(
            BASE({
                shipSkills: playerDebuff,
                speed: 200,
                enemyAttackers: [enemyVictim, enemyHayyan],
            })
        );
        expect(sumDirectHeal(result, 'enemy-hayyan')).toBeCloseTo(
            HAYYAN_BASE_REPAIR * (1 + HAYYAN_CRIT_POWER / 100),
            6
        );
    });
});

describe("Salvation's purge repair crits on HER crit rate and crit power", () => {
    let idc = 0;
    const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
        id: `rc${++idc}`,
        target: 'enemy',
        trigger: 'on-cast',
        conditions: [],
        ...p,
    });
    const SALVATION_HP = 20_000;
    const SALVATION_CRIT_POWER = 54;
    const basePattern = (): ParsedPattern => ({
        raw: 'base',
        shape: 'base',
        range: 0,
        modifiers: {},
    });
    const front: ParsedTarget = { raw: 'front', side: 'enemy', selection: 'front' };

    const run = (crit: number) => {
        const hit = () =>
            ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } });
        const focusSkills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({
                            type: 'buff',
                            target: 'self',
                            config: {
                                type: 'buff',
                                buffName: 'Attack Up',
                                parsedEffects: { attack: 10 },
                                stacks: 1,
                                isStackable: false,
                                duration: 99,
                            },
                        }),
                        hit(),
                    ],
                },
            ],
        };
        const salvation = {
            id: 'salvation',
            speed: 80,
            chargeCount: 0,
            startCharged: false,
            selfBuffs: [],
            enemyDebuffs: [],
            walk: {
                shipSkills: {
                    slots: [
                        {
                            slot: 'passive' as const,
                            abilities: [
                                ab({
                                    type: 'heal',
                                    target: 'ally',
                                    trigger: 'on-ally-purged' as const,
                                    config: { type: 'heal', basis: 'hp' as const, pct: 5 },
                                }),
                            ],
                        },
                    ],
                },
                stats: {
                    attack: 0,
                    crit,
                    critDamage: SALVATION_CRIT_POWER,
                    defensePenetration: 0,
                    hacking: 0,
                    defence: 0,
                    hp: SALVATION_HP,
                },
                affinityDamageModifier: 0,
                affinityCritCap: 100,
                affinityCritPenalty: 0,
                hasChargedSkill: false,
            },
        };
        const purgingEnemy = {
            id: 'enemy-front',
            stats: {
                attack: 1000,
                crit: 0,
                critDamage: 0,
                defence: 0,
                hp: 1_000_000_000,
                speed: 50,
            },
            chargeCount: 0,
            startCharged: false,
            position: 'M4' as Position,
            target: front,
            pattern: basePattern(),
            shipSkills: {
                slots: [
                    {
                        slot: 'active' as const,
                        abilities: [
                            ab({
                                type: 'purge',
                                target: 'enemy',
                                config: { type: 'purge', count: 5 },
                            }),
                            hit(),
                        ],
                    },
                ],
            },
        };
        return runCombat({
            ...BASE({
                attack: 5000,
                shipSkills: focusSkills,
                numRounds: 2,
                speed: 100,
                position: 'M4',
                target: front,
                pattern: basePattern(),
                teamActors: [salvation],
                enemyAttackers: [purgingEnemy],
            }),
        });
    };

    it('crit rate 100 -> each purge repair is base x (1 + critPower)', () => {
        expect(sumDirectHeal(run(100), 'salvation')).toBeCloseTo(
            2 * SALVATION_HP * 0.05 * (1 + SALVATION_CRIT_POWER / 100),
            6
        );
    });

    it('crit rate 0 -> never crits', () => {
        expect(sumDirectHeal(run(0), 'salvation')).toBeCloseTo(2 * SALVATION_HP * 0.05, 6);
    });
});

describe('a reactive repair that crits is a critically-repaired ally for the crit listeners', () => {
    const critReaction = (): Ability => ({
        id: 'crit-reaction-heal',
        type: 'heal',
        target: 'self',
        trigger: 'on-any-ally-critically-repaired',
        conditions: [],
        config: { type: 'heal', basis: 'hp', pct: 6 },
    });
    const withReaction = (crit: number): TeamActor => {
        const actor = hayyanTeamActor(crit, HAYYAN_CRIT_POWER);
        if (!actor.walk) throw new Error('fixture has no walk');
        return {
            ...actor,
            walk: {
                ...actor.walk,
                shipSkills: {
                    slots: [{ slot: 'passive', abilities: [hayyanHeal(), critReaction()] }],
                },
            },
        };
    };

    it('fires on a crit reactive repair, and its own crit repair does not loop', () => {
        const result = runCombat(
            BASE({
                teamActors: [withReaction(100)],
                enemyAttackers: [debuffEnemy('enemy-deb')],
            })
        );
        // Hayyan's crit repair (3,288) -> her crit-reaction repair (6% of her max HP, crit again,
        // 3,288) -> the reaction is already in the lineage, so it stops there.
        expect(sumDirectHeal(result, 'hayyan')).toBeCloseTo(
            2 * HAYYAN_BASE_REPAIR * (1 + HAYYAN_CRIT_POWER / 100),
            6
        );
    });

    it('does not fire when the reactive repair does not crit', () => {
        const result = runCombat(
            BASE({
                teamActors: [withReaction(0)],
                enemyAttackers: [debuffEnemy('enemy-deb')],
            })
        );
        expect(sumDirectHeal(result, 'hayyan')).toBeCloseTo(HAYYAN_BASE_REPAIR, 6);
    });
});
