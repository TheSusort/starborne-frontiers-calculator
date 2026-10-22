/**
 * A stasised ship gains NO charge from its own turn, but DOES still gain charges an ally's skill
 * grants it (owner ruling 2026-10-22).
 *
 * Real granter: Hayyan's charged skill ("... grants Cheat Death to all allies, and adds 1 charge to
 * their charged skill"), docs/ship-skills.csv through the production parser, started charged so it
 * fires in round 1. In round 1 a fast stasis-bot puts Stasis on the recipient first, then Hayyan
 * grants, then the recipient's own (blocked) turn comes round. The control arm swaps the bot for
 * an inert one, so the recipient's own turn banks its usual +1 too.
 *
 * Both sides: a player recipient + player Hayyan against an enemy bot, and the mirror.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import type { Ability, ShipSkills } from '../../../types/abilities';
import { parsePattern, parseShipTargeting, parseTarget } from '../../targetingParser';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

const HUGE_HP = 1_000_000_000;

beforeAll(() => {
    if (!csvAvailable()) {
        throw new Error(
            'docs/ship-skills.csv is missing — copy the gitignored reference data into this worktree'
        );
    }
});

const realHayyan = () => {
    const ship = buildTraceShip('Hayyan');
    if (!ship) throw new Error('Hayyan is missing from the reference data');
    const { active, charged } = parseShipTargeting(ship);
    if (!active || !charged) throw new Error('Hayyan has no parsed targeting');
    return { skills: buildShipAbilities(ship), active, charged };
};

const hit = (id: string): Ability => ({
    id,
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 1 },
});
const recipientSkills = (): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: [hit('r-a')] },
        { slot: 'charged', abilities: [hit('r-c')] },
    ],
});
const stasisSkills = (stasis: boolean): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: stasis
                ? [
                      {
                          id: 'bot-stasis',
                          type: 'debuff',
                          target: 'enemy',
                          trigger: 'on-cast',
                          conditions: [],
                          config: {
                              type: 'debuff',
                              buffName: 'Stasis',
                              application: 'inflict',
                              duration: 3,
                              stacks: 1,
                              isStackable: false,
                              parsedEffects: {},
                          },
                      },
                  ]
                : [],
        },
    ],
});

const common = {
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    numRounds: 1,
    selfBuffs: [],
    enemyDebuffs: [],
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    mode: 'battle' as const,
};

/** Player recipient (focus, M4) + player Hayyan (M1) vs an enemy stasis-bot. */
const playerBoard = (stasis: boolean): CombatEngineInput => {
    const h = realHayyan();
    const hayyan: TeamActorEngineInput = {
        id: 'hayyan',
        speed: 80,
        chargeCount: 4,
        startCharged: true,
        selfBuffs: [],
        enemyDebuffs: [],
        position: 'M1',
        target: h.active.target,
        pattern: h.active.pattern,
        chargedTarget: h.charged.target,
        chargedPattern: h.charged.pattern,
        walk: {
            shipSkills: h.skills,
            stats: {
                attack: 1000,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 0,
                hp: HUGE_HP,
            },
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: true,
        },
    };
    return {
        ...common,
        attack: 1,
        hacking: 0,
        security: 0,
        chargeCount: 5,
        shipSkills: recipientSkills(),
        hasChargedSkill: true,
        startCharged: false,
        hp: HUGE_HP,
        speed: 50,
        position: 'M4',
        target: parseTarget('front'),
        pattern: parsePattern('Pattern-Base'),
        teamActors: [hayyan],
        enemyAttackers: [
            {
                id: 'bot',
                stats: {
                    attack: 0,
                    crit: 0,
                    critDamage: 0,
                    defence: 0,
                    hp: HUGE_HP,
                    speed: 300,
                    hacking: 1e6,
                },
                chargeCount: 0,
                startCharged: false,
                position: 'M4',
                affinity: 'antimatter',
                target: parseTarget('front'),
                pattern: parsePattern('Pattern-Base'),
                shipSkills: stasisSkills(stasis),
            },
        ],
    };
};

/** The mirror: enemy recipient (M4) + enemy Hayyan (M1) vs a player-focus stasis-bot. */
const enemyBoard = (stasis: boolean): CombatEngineInput => {
    const h = realHayyan();
    const enemyHayyan: EnemyAttacker = {
        id: 'e-hayyan',
        stats: { attack: 1000, crit: 0, critDamage: 0, defence: 0, hp: HUGE_HP, speed: 80 },
        chargeCount: 4,
        startCharged: true,
        position: 'M1',
        affinity: 'antimatter',
        target: h.active.target,
        pattern: h.active.pattern,
        chargedTarget: h.charged.target,
        chargedPattern: h.charged.pattern,
        shipSkills: h.skills,
    };
    return {
        ...common,
        attack: 0,
        hacking: 1e6,
        chargeCount: 0,
        shipSkills: stasisSkills(stasis),
        hasChargedSkill: false,
        startCharged: false,
        hp: HUGE_HP,
        speed: 300,
        position: 'M4',
        target: parseTarget('front'),
        pattern: parsePattern('Pattern-Base'),
        enemyAttackers: [
            {
                id: 'e-recipient',
                stats: {
                    attack: 1,
                    crit: 0,
                    critDamage: 0,
                    defence: 0,
                    hp: HUGE_HP,
                    speed: 50,
                    security: 0,
                },
                chargeCount: 5,
                startCharged: false,
                position: 'M4',
                affinity: 'antimatter',
                target: parseTarget('front'),
                pattern: parsePattern('Pattern-Base'),
                shipSkills: recipientSkills(),
            },
            enemyHayyan,
        ],
    };
};

interface Read {
    stasised: boolean;
    acted: boolean;
    /** Charges the recipient holds at the end of round 1. */
    charges: number;
    /** Charge changes on the recipient, by reason. */
    gained: Record<string, number>;
}

const read = (input: CombatEngineInput, recipientId: string): Read => {
    const bus = createEventBus();
    const out: Read = { stasised: false, acted: false, charges: 0, gained: {} };
    bus.on('debuff-applied', (e: Extract<CombatEvent, { type: 'debuff-applied' }>) => {
        if (e.targetId === recipientId && e.buffName === 'Stasis') out.stasised = true;
    });
    bus.on('skill-fired', (e: Extract<CombatEvent, { type: 'skill-fired' }>) => {
        if (e.actorId === recipientId) out.acted = true;
    });
    bus.on('charge-changed', (e: Extract<CombatEvent, { type: 'charge-changed' }>) => {
        if (e.actorId !== recipientId) return;
        out.charges = e.newCharge;
        out.gained[e.reason] = (out.gained[e.reason] ?? 0) + (e.newCharge - e.oldCharge);
    });
    runCombat({ ...input, bus });
    return out;
};

describe("a stasised ship still gains an ally's charge grant, but none from its own turn", () => {
    const sides = [
        { tag: 'PLAYER side', board: playerBoard, recipient: 'attacker' },
        { tag: 'ENEMY side', board: enemyBoard, recipient: 'e-recipient' },
    ];
    for (const { tag, board, recipient } of sides) {
        describe(tag, () => {
            it("control (no Stasis): Hayyan's +1 and the recipient's own +1 → 2 charges", () => {
                const r = read(board(false), recipient);
                expect(r.stasised).toBe(false);
                expect(r.acted).toBe(true);
                expect(r.gained).toEqual({ manip: 1, gen: 1 });
                expect(r.charges).toBe(2);
            });

            it("stasised: Hayyan's +1 lands, the blocked turn banks nothing → 1 charge", () => {
                const r = read(board(true), recipient);
                expect(r.stasised).toBe(true);
                expect(r.acted).toBe(false);
                expect(r.gained).toEqual({ manip: 1 });
                expect(r.charges).toBe(1);
            });
        });
    }
});
