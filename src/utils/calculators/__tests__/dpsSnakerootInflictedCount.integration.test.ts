/**
 * Snakeroot's "120% damage for every 4 stacks of damage over time inflicted onto a single enemy"
 * in the DPS calculator (owner ruling R90): the hit fires on every 4th stack INFLICTED on the enemy
 * this combat, not each time the enemy's live stack total reaches a multiple of 4.
 *
 * Solo Snakeroot lands 2 stacks of 2-turn Corrosion I every round, so the enemy's live total sits
 * at 4 from round 2 on (the previous round's 2 expire as the next 2 land) — a live reading would
 * re-cross 4 every round. The inflicted count reaches 4, 8, 12, 16 on rounds 2, 4, 6, 8.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { simulateDPS, DPSSimulationInput } from '../dpsSimulator';
import { setupKeyedRng } from '../rateAccumulator';
import { DEFAULT_ATTACKER_SLOT, DEFAULT_ENEMY_SLOT } from '../dpsEnemyPlacement';
import { realKit } from '../../combat/__testutils__/realKitBoard';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import type { CombatEvent } from '../../combat/events';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => {
    setupKeyedRng(1);
});

/** Snakeroot's real kit against the DPS calculator's enemy for 8 rounds: the round of every
 *  landing (`L<stacks>`) and every passive hit (`H`), in order. */
const timeline = (): string[] => {
    const events: CombatEvent[] = [];
    const input: DPSSimulationInput = {
        attack: 10_000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        enemyDefense: 0,
        enemyHp: 1e9,
        rounds: 8,
        selfBuffs: [],
        enemyDebuffs: [],
        speed: 100,
        hp: 1_000_000,
        hacking: 1e6,
        position: DEFAULT_ATTACKER_SLOT,
        shipSkills: realKit('Snakeroot'),
        enemyAttackers: [
            {
                id: 'enemy-1',
                stats: { attack: 0, crit: 0, critDamage: 0, speed: 40, defence: 0, hp: 1e9 },
                chargeCount: 0,
                startCharged: false,
                position: DEFAULT_ENEMY_SLOT,
            },
        ],
        bus: { on: () => {}, emit: (e: CombatEvent) => void events.push(e) },
    };
    simulateDPS(input);
    const out: string[] = [];
    for (const e of events) {
        if (e.type === 'dot-applied') out.push(`r${e.round}:L${e.stacks}`);
        if (e.type === 'reactive-damage-performed') out.push(`r${e.round}:H`);
    }
    return out;
};

describe('DPS calculator: Snakeroot counts the stacks inflicted, not the live total (R90)', () => {
    it('solo Snakeroot hits on the 4th, 8th, 12th and 16th stack: rounds 2, 4, 6 and 8', () => {
        expect(timeline()).toEqual([
            'r1:L2',
            'r2:L2',
            'r2:H',
            'r3:L2',
            'r4:L2',
            'r4:H',
            'r5:L2',
            'r6:L2',
            'r6:H',
            'r7:L2',
            'r8:L2',
            'r8:H',
        ]);
    });
});
