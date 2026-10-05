/**
 * Cobalt's two "additional damage equal to N% of this Unit's max HP" riders carry the gate their
 * own sentence names.
 *
 * Active: "If this Unit has more HP than the enemy, it deals additional damage equal to 25% of this
 * Unit's max HP." → `stat-vs-target` (hp, gt).
 * Charged: "If this Unit is at full HP, it deals additional damage equal to 30% of this Unit's max
 * HP." → `hp-threshold` above 99, self — the same full-HP gate his passive's "if it is at full HP"
 * parses to.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

const HP = 100_000;
const ATTACK = 1_000;
const HUGE_HP = 1_000_000_000;

const requireReferenceData = (): void => {
    if (!csvAvailable()) {
        throw new Error(
            'docs/ship-skills.csv is missing — copy the gitignored reference data into this ' +
                'worktree. These cases read the REAL Cobalt kit and cannot run without it.'
        );
    }
};

const realCobalt = (): ShipSkills => {
    const ship = buildTraceShip('Cobalt');
    if (!ship) throw new Error('Cobalt is missing from the reference data in this worktree');
    return buildShipAbilities(ship);
};

const riderIn = (skills: ShipSkills, slot: 'active' | 'charged'): Ability | undefined =>
    skills.slots
        .find((s) => s.slot === slot)
        ?.abilities.find((a) => a.config.type === 'additional-damage');

const front = (): ParsedTarget => ({ raw: 'front', side: 'enemy', selection: 'front' });
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

const plainHit: Ability = {
    id: 'pre-hit',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100 },
};

/** Cobalt with ONLY his real charged slot, starting charged, so his first cast is the charged one.
 *  A faster opposing ship hits him for `preHit` first; the struck target has 0 defence. */
const board = (side: 'player' | 'enemy', preHit: number): CombatEngineInput => {
    const charged = realCobalt().slots.filter((s) => s.slot === 'charged');
    const cobaltSkills: ShipSkills = { slots: [{ slot: 'active', abilities: [] }, ...charged] };
    const base = {
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        numRounds: 1,
        selfBuffs: [],
        enemyDebuffs: [],
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        affinity: 'antimatter' as const,
        defence: 0,
        healTargetId: 'attacker',
        mode: 'healing' as const,
        position: 'M4' as const,
        target: front(),
        pattern: basePattern(),
    };
    const opponent = (o: {
        attack: number;
        speed: number;
        skills: ShipSkills;
        chargeCount: number;
        startCharged: boolean;
        hp: number;
    }): EnemyAttacker => ({
        id: 'other',
        stats: { attack: o.attack, crit: 0, critDamage: 0, defence: 0, hp: o.hp, speed: o.speed },
        chargeCount: o.chargeCount,
        startCharged: o.startCharged,
        position: 'M4',
        affinity: 'antimatter',
        target: front(),
        pattern: basePattern(),
        shipSkills: o.skills,
    });
    if (side === 'player') {
        return {
            ...base,
            attack: ATTACK,
            speed: 10,
            hp: HP,
            chargeCount: 3,
            startCharged: true,
            hasChargedSkill: true,
            shipSkills: cobaltSkills,
            enemyAttackers: [
                opponent({
                    attack: preHit,
                    speed: 300,
                    skills: { slots: [{ slot: 'active', abilities: [plainHit] }] },
                    chargeCount: 0,
                    startCharged: false,
                    hp: HUGE_HP,
                }),
            ],
        };
    }
    return {
        ...base,
        attack: preHit,
        speed: 300,
        hp: HUGE_HP,
        chargeCount: 0,
        startCharged: false,
        hasChargedSkill: false,
        shipSkills: { slots: [{ slot: 'active', abilities: [plainHit] }] },
        enemyAttackers: [
            opponent({
                attack: ATTACK,
                speed: 10,
                skills: cobaltSkills,
                chargeCount: 3,
                startCharged: true,
                hp: HP,
            }),
        ],
    };
};

/** Cobalt's charged hit, as the damage the struck target lost. */
const cobaltHit = (side: 'player' | 'enemy', preHit: number): number => {
    const cobaltId = side === 'player' ? 'attacker' : 'other';
    const events: CombatEvent[] = [];
    const bus = createEventBus();
    const emit = bus.emit;
    bus.emit = (e) => {
        events.push(e);
        emit(e);
    };
    runCombat({ ...board(side, preHit), bus });
    return events
        .filter(
            (e): e is Extract<CombatEvent, { type: 'attacked' }> =>
                e.type === 'attacked' && e.attackerId === cobaltId
        )
        .reduce((sum, e) => sum + (e.takenDamage ?? e.damage ?? 0), 0);
};

describe("Cobalt's max-HP riders carry their own gates", () => {
    beforeAll(requireReferenceData);

    it('active rider: gated on having more HP than the enemy', () => {
        expect(riderIn(realCobalt(), 'active')?.conditions).toEqual([
            expect.objectContaining({
                subject: 'stat-vs-target',
                compareStat: 'hp',
                statComparator: 'gt',
            }),
        ]);
    });

    it('charged rider: gated on Cobalt being at full HP', () => {
        expect(riderIn(realCobalt(), 'charged')?.conditions).toEqual([
            expect.objectContaining({
                subject: 'hp-threshold',
                hpComparator: 'above',
                hpPercent: 99,
                hpSubject: 'self',
            }),
        ]);
    });

    for (const side of ['player', 'enemy'] as const) {
        it(`${side} Cobalt: the 30% max-HP rider lands at full HP and not at 98%`, () => {
            const full = cobaltHit(side, 0);
            const wounded = cobaltHit(side, 2_000);

            expect(full).toBeCloseTo(ATTACK * 2.3 + 0.3 * HP, 4);
            expect(wounded).toBeCloseTo(ATTACK * 2.3, 4);
        });
    }
});
