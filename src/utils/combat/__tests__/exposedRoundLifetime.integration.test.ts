/**
 * Exposed lives until it is spent or the round ends — not until the end of its holder's turn.
 *
 * Glossary: "Increases the incoming damage of the next direct hit by 100%, removed after taking
 * direct damage or at the end of the round." A hit reads ALL stacks and spends ONE (owner ruling
 * 2026-08-10, `exposedStatus.ts`).
 *
 * Amartya R2+ passive: "When an enemy defender gains Taunt, this Unit inflicts 2 stacks of Exposed
 * on that defender." Every Taunt gainer taunts itself on its OWN turn, so the Exposed lands during
 * that turn; a turn countdown would delete it at that same turn's end, before anyone could hit it.
 *
 * Board: Isha (real active — "gains Taunt for 1 turn"), a defender, speed 100, attack 0, taunts
 * every round. Amartya carries his real passive. Plain 100%/1000-attack hitters on Amartya's side
 * act before Isha (speed 300) or after her (speed 50, 40). Isha has 0 defence, so an unamplified
 * hit is 1000, one stack +100%, two stacks +200%.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

const ATTACK = 1000;
const HUGE_HP = 1_000_000_000;

const requireReferenceData = (): void => {
    if (!csvAvailable()) {
        throw new Error(
            'docs/ship-skills.csv is missing — copy the gitignored reference data into this ' +
                'worktree. These cases read REAL kits and cannot run without it.'
        );
    }
};

const realSlot = (name: string, slot: 'active' | 'passive'): ShipSkills['slots'][number] => {
    const ship = buildTraceShip(name);
    if (!ship) throw new Error(`${name} is missing from the reference data in this worktree`);
    const found = buildShipAbilities(ship).slots.find((s) => s.slot === slot);
    if (!found) throw new Error(`${name} has no parsed ${slot}`);
    return found;
};

const front = (): ParsedTarget => ({ raw: 'front', side: 'enemy', selection: 'front' });
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

const plainHit = (id: string): Ability => ({
    id,
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100 },
});

interface Ship {
    id: string;
    speed: number;
    attack: number;
    hacking: number;
    skills: ShipSkills;
    position: Position;
    role?: 'DEFENDER';
}

const POSITIONS: Position[] = ['M3', 'M2', 'T4', 'B4'];

/** `amartyaSide` holds Amartya and the hitters; the other side holds Isha alone, at M4. */
const board = (amartyaSide: 'player' | 'enemy', hitterSpeeds: number[]): CombatEngineInput => {
    const isha: Ship = {
        id: 'isha',
        speed: 100,
        attack: 0,
        hacking: 0,
        skills: { slots: [realSlot('Isha', 'active')] },
        position: 'M4',
        role: 'DEFENDER',
    };
    const amartya: Ship = {
        id: 'amartya',
        speed: 1,
        attack: 0,
        hacking: 1_000_000,
        skills: { slots: [{ slot: 'active', abilities: [] }, realSlot('Amartya', 'passive')] },
        position: 'B1',
    };
    const hitters: Ship[] = hitterSpeeds.map((speed, i) => ({
        id: `hitter-${i}`,
        speed,
        attack: ATTACK,
        hacking: 0,
        skills: { slots: [{ slot: 'active', abilities: [plainHit(`hit-${i}`)] }] },
        position: POSITIONS[i],
    }));

    const asEnemy = (s: Ship): EnemyAttacker => ({
        id: s.id,
        stats: {
            attack: s.attack,
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp: HUGE_HP,
            speed: s.speed,
            hacking: s.hacking,
        },
        chargeCount: 0,
        startCharged: false,
        position: s.position,
        affinity: 'antimatter',
        target: front(),
        pattern: basePattern(),
        shipSkills: s.skills,
        ...(s.role ? { role: s.role } : {}),
    });
    const asTeam = (s: Ship): TeamActorEngineInput => ({
        id: s.id,
        speed: s.speed,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        role: s.role ?? 'ATTACKER',
        position: s.position,
        target: front(),
        pattern: basePattern(),
        walk: {
            shipSkills: s.skills,
            stats: {
                attack: s.attack,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: s.hacking,
                defence: 0,
                hp: HUGE_HP,
            },
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
    });

    // The player focus is the first ship of the player side; the rest walk as team actors.
    const playerShips = amartyaSide === 'player' ? [...hitters, amartya] : [isha];
    const enemyShips = amartyaSide === 'player' ? [isha] : [...hitters, amartya];
    const [focus, ...team] = playerShips;
    return {
        attack: focus.attack,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        hacking: focus.hacking,
        chargeCount: 0,
        shipSkills: focus.skills,
        numRounds: 2,
        selfBuffs: [],
        enemyDebuffs: [],
        hasChargedSkill: false,
        startCharged: false,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        affinity: 'antimatter',
        defence: 0,
        hp: HUGE_HP,
        speed: focus.speed,
        healTargetId: 'attacker',
        mode: 'healing',
        position: focus.position,
        target: front(),
        pattern: basePattern(),
        ...(focus.role ? { role: focus.role } : {}),
        teamActors: team.map(asTeam),
        enemyAttackers: enemyShips.map(asEnemy),
    };
};

/** Each hitter's hit on Isha, per round, keyed by hitter index. */
const hitsOnIsha = (input: CombatEngineInput): Record<string, number[]> => {
    const events: CombatEvent[] = [];
    const bus = createEventBus();
    const emit = bus.emit;
    bus.emit = (e) => {
        events.push(e);
        emit(e);
    };
    runCombat({ ...input, bus });
    const ishaId = input.enemyAttackers.some((e) => e.id === 'isha') ? 'isha' : 'attacker';
    const out: Record<string, number[]> = {};
    for (const e of events) {
        if (e.type !== 'attacked' || e.targetId !== ishaId) continue;
        // The player focus is hitter-0 when the hitters are on the player side.
        const hitter = e.attackerId === 'attacker' ? 'hitter-0' : e.attackerId;
        (out[hitter] ??= []).push(e.damage ?? 0);
    }
    return out;
};

for (const side of ['player', 'enemy'] as const) {
    describe(`Exposed from a ${side}-side Amartya lasts until spent or the round ends`, () => {
        beforeAll(requireReferenceData);

        it('a hit after the taunt reads both stacks; a second hit reads the one left', () => {
            const hits = hitsOnIsha(board(side, [50, 40]));

            expect(hits['hitter-0']).toEqual([ATTACK * 3, ATTACK * 3]);
            expect(hits['hitter-1']).toEqual([ATTACK * 2, ATTACK * 2]);
        });

        it('a stack left unspent is gone at round end — the next round opens unamplified', () => {
            // hitter-0 moves BEFORE Isha re-taunts; hitter-1 moves after her.
            const hits = hitsOnIsha(board(side, [300, 50]));

            expect(hits['hitter-0']).toEqual([ATTACK, ATTACK]);
            expect(hits['hitter-1']).toEqual([ATTACK * 3, ATTACK * 3]);
        });
    });
}
