/**
 * Meatshield's "Any damage this Unit takes from Protection is transformed into a Damage over Time
 * effect for 2 turns" gives him ONE DoT per direct hit on an ally (owner ruling 2026-10-22):
 *  - his 3 Protection stacks redirect a hit as three sub-hits, but they make one DoT, not three;
 *  - an area hit that strikes two protected allies is still one hit: one DoT carrying the SUM of
 *    both redirected shares.
 * The DoT count is what his charged skill reads ("repairs 1.5% of its max HP for each debuff on
 * itself"), so the repair is pinned too.
 *
 * Real kit: Meatshield's skill text from `docs/ship-skills.csv` through the production parser
 * (refit 4, so the transform passive is the active one). The hitter, the allies and the board are
 * authored. Every case runs on both sides: a player Meatshield shielding player allies from an
 * enemy hitter, and an enemy Meatshield shielding enemy allies from the player focus.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import type { CombatActor } from '../state';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedPattern, ParsedTarget } from '../../targetingParser';
import { parseShipTargeting } from '../../targetingParser';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import type { Position } from '../../../types/encounters';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

const HUGE_HP = 1_000_000_000;
const MEATSHIELD_HP = 1_000_000;
const HITTER_ATTACK = 10_000;

beforeAll(() => {
    if (!csvAvailable()) {
        throw new Error(
            'docs/ship-skills.csv is missing — copy the gitignored reference data into this worktree'
        );
    }
});

const isTransform = (a: Ability): boolean => a.config.type === 'transform-incoming-to-dot';

const realMeatshield = (withTransform: boolean) => {
    const ship = buildTraceShip('Meatshield');
    if (!ship) throw new Error('Meatshield is missing from the reference data');
    const { active, charged } = parseShipTargeting(ship);
    if (!active || !charged) throw new Error('Meatshield has no parsed targeting');
    const built = buildShipAbilities(ship);
    const skills: ShipSkills = withTransform
        ? built
        : {
              slots: built.slots.map((s) => ({
                  ...s,
                  abilities: s.abilities.filter((a) => !isTransform(a)),
              })),
          };
    return { skills, active, charged };
};

const front: ParsedTarget = { raw: 'front', side: 'enemy', selection: 'front' };
const single: ParsedPattern = { raw: 'base', shape: 'base', range: 0, modifiers: {} };
/** Anchored on the front ally at M4, a range-1 line also covers M3. */
const area: ParsedPattern = { raw: 'line-range-1', shape: 'line', range: 1, modifiers: {} };

const inertAlly = (id: string, position: Position): TeamActor => ({
    id,
    speed: 10,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position,
    walk: {
        shipSkills: { slots: [] },
        stats: {
            attack: 0,
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
        hasChargedSkill: false,
    },
});

const inertEnemy = (id: string, position: Position): EnemyAttacker => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: HUGE_HP, speed: 10 },
    chargeCount: 0,
    startCharged: false,
    position,
    affinity: 'antimatter',
    target: front,
    pattern: single,
    shipSkills: { slots: [] },
});

const hitterAttack = (): Ability => ({
    id: 'hitter-attack',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100 },
});

interface Opts {
    aoe: boolean;
    charged: boolean;
    transform: boolean;
}

interface Board {
    input: CombatEngineInput;
    meatshieldId: string;
    hitterId: string;
    allyIds: [string, string];
}

/** Meatshield at B1 (never hit), his allies at M4 (the hitter's anchor) and M3 (covered only by
 *  the area pattern). The hitter outspeeds everyone, so its one hit lands before Meatshield acts. */
const board = (side: 'player' | 'enemy', o: Opts): Board => {
    const m = realMeatshield(o.transform);
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
        healTargetId: 'attacker',
        mode: 'healing' as const,
    };
    if (side === 'player') {
        return {
            meatshieldId: 'attacker',
            hitterId: 'hitter',
            allyIds: ['ally-1', 'ally-2'],
            input: {
                ...common,
                attack: 0,
                chargeCount: 3,
                shipSkills: m.skills,
                hasChargedSkill: true,
                startCharged: o.charged,
                hp: MEATSHIELD_HP,
                speed: 50,
                position: 'B1',
                target: m.active.target,
                pattern: m.active.pattern,
                chargedTarget: m.charged.target,
                chargedPattern: m.charged.pattern,
                teamActors: [inertAlly('ally-1', 'M4'), inertAlly('ally-2', 'M3')],
                enemyAttackers: [
                    {
                        id: 'hitter',
                        stats: {
                            attack: HITTER_ATTACK,
                            crit: 0,
                            critDamage: 0,
                            defence: 0,
                            hp: HUGE_HP,
                            speed: 300,
                        },
                        chargeCount: 0,
                        startCharged: false,
                        position: 'M4',
                        affinity: 'antimatter',
                        target: front,
                        pattern: o.aoe ? area : single,
                        shipSkills: { slots: [{ slot: 'active', abilities: [hitterAttack()] }] },
                    },
                ],
            },
        };
    }
    return {
        meatshieldId: 'meatshield',
        hitterId: 'attacker',
        allyIds: ['e-ally-1', 'e-ally-2'],
        input: {
            ...common,
            attack: HITTER_ATTACK,
            chargeCount: 0,
            shipSkills: { slots: [{ slot: 'active', abilities: [hitterAttack()] }] },
            hasChargedSkill: false,
            startCharged: false,
            hp: HUGE_HP,
            speed: 300,
            position: 'M4',
            target: front,
            pattern: o.aoe ? area : single,
            enemyAttackers: [
                inertEnemy('e-ally-1', 'M4'),
                inertEnemy('e-ally-2', 'M3'),
                {
                    id: 'meatshield',
                    stats: {
                        attack: 0,
                        crit: 0,
                        critDamage: 0,
                        defence: 0,
                        hp: MEATSHIELD_HP,
                        speed: 50,
                    },
                    chargeCount: 3,
                    startCharged: o.charged,
                    position: 'B1',
                    affinity: 'antimatter',
                    target: m.active.target,
                    pattern: m.active.pattern,
                    chargedTarget: m.charged.target,
                    chargedPattern: m.charged.pattern,
                    shipSkills: m.skills,
                },
            ],
        },
    };
};

interface Measured {
    /** Meatshield's converted-hit DoTs right after the hitter's turn: one entry per DoT. */
    dots: { stacks: number; total: number }[];
    /** Round-1 instant intake per actor. */
    incoming: Record<string, number>;
    /** What Meatshield's round-1 repairs restored to himself. */
    selfRepair: number;
}

const run = (b: Board): Measured => {
    const bus = createEventBus();
    let meatshield: CombatActor | undefined;
    const out: Measured = { dots: [], incoming: {}, selfRepair: 0 };
    bus.on('turn-ended', (e: Extract<CombatEvent, { type: 'turn-ended' }>) => {
        if (e.actorId !== b.hitterId || e.round !== 1 || !meatshield) return;
        out.dots = meatshield.genericDoTEntries
            .filter((d) => d.convertedFromHit)
            .map((d) => ({
                stacks: d.stacks,
                total: (d.perTickAmount ?? 0) * d.stacks * d.remainingRounds,
            }));
    });
    bus.on('heal-performed', (e: Extract<CombatEvent, { type: 'heal-performed' }>) => {
        if (e.casterId === b.meatshieldId && e.round === 1 && e.targets.includes(b.meatshieldId))
            out.selfRepair += e.amount;
    });
    const result = runCombat({
        ...b.input,
        bus,
        __testTapActors: (all: CombatActor[]) => {
            meatshield = all.find((a) => a.id === b.meatshieldId);
            // Half HP, so a repair is never cut short by the max-HP cap.
            if (meatshield) meatshield.currentHp = MEATSHIELD_HP / 2;
        },
    });
    const r1 = result.rounds.find((r) => r.round === 1)!;
    for (const [id, v] of Object.entries(r1.perActorIncoming ?? {})) out.incoming[id] = v.incoming;
    return out;
};

describe("Meatshield's Protection DoT: one per direct hit on an ally", () => {
    it('PRECONDITION: the real kit carries the Protection-only 2-turn transform', () => {
        const { skills } = realMeatshield(true);
        const transforms = skills.slots.flatMap((s) => s.abilities.filter(isTransform));
        expect(transforms).toHaveLength(1);
        expect(transforms[0].config).toMatchObject({
            turns: 2,
            condition: 'self-protection-redirect',
        });
    });

    for (const side of ['player', 'enemy'] as const) {
        describe(`${side} side`, () => {
            it('a single-target hit on one ally → ONE DoT carrying the whole redirected share', () => {
                const b = board(side, { aoe: false, charged: false, transform: true });
                const control = run(board(side, { aoe: false, charged: false, transform: false }));
                // The control proves the hit really was redirected, and what the share was.
                const redirected = control.incoming[b.meatshieldId];
                expect(redirected).toBeGreaterThan(0);
                expect(control.incoming[b.allyIds[1]] ?? 0).toBe(0);

                const m = run(b);
                expect(m.dots).toHaveLength(1);
                expect(m.dots[0].stacks).toBe(1);
                expect(m.dots[0].total).toBeCloseTo(redirected, 6);
            });

            it('an area hit on TWO protected allies → still ONE DoT, carrying the sum of both shares', () => {
                const b = board(side, { aoe: true, charged: false, transform: true });
                const control = run(board(side, { aoe: true, charged: false, transform: false }));
                // Both allies really were struck, so Meatshield took two allies' shares.
                expect(control.incoming[b.allyIds[0]]).toBeGreaterThan(0);
                expect(control.incoming[b.allyIds[1]]).toBeGreaterThan(0);
                const single = run(board(side, { aoe: false, charged: false, transform: false }));
                const redirected = control.incoming[b.meatshieldId];
                expect(redirected).toBeGreaterThan(single.incoming[b.meatshieldId]);

                const m = run(b);
                expect(m.dots).toHaveLength(1);
                expect(m.dots[0].stacks).toBe(1);
                expect(m.dots[0].total).toBeCloseTo(redirected, 6);
            });

            it('his charged repair counts that one DoT: 1.5% of max HP, not one 1.5% per Protection stack', () => {
                const m = run(board(side, { aoe: false, charged: true, transform: true }));
                expect(m.selfRepair).toBeCloseTo(MEATSHIELD_HP * 0.015, 0);
                // Without the transform he carries no DoT, so the repair has nothing to count —
                // the 1.5% above is the DoT and nothing else.
                const control = run(board(side, { aoe: false, charged: true, transform: false }));
                expect(control.selfRepair).toBe(0);
            });
        });
    }
});
