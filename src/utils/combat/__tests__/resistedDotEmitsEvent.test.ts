import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { ShipSkills, Ability } from '../../../types/abilities';

// ─────────────────────────────────────────────────────────────────────────────
// Bug: a DoT that fails its hacking-vs-security landing roll (a RESIST) produces
// NO combat-log line, while a resisted stat-debuff DOES emit `debuff-resisted`.
// The normal DoT landing-failure branch (playerTurn.ts) was deliberately silent;
// only the Block-Debuff-immunity path emitted a resist. This asserts the normal
// resist path now emits `debuff-resisted` so "Inferno resisted" / "Corrosion II
// resisted" surfaces in the log — symmetric with stat-debuff resists.
// ─────────────────────────────────────────────────────────────────────────────

let idCounter = 0;

const BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    attack: 5000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [] },
    enemyDefense: 0,
    enemyHp: 10_000_000,
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
    defence: 2000,
    hp: 10000,
    ...overrides,
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

const enemyAb = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `eka${++idCounter}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...partial,
});

/** Enemy whose kit carries an attack + an Inferno-III DoT infliction. hacking 0 → guaranteed
 *  resist on the shared landing roll. */
const infernoEnemy = (): EnemyAttacker =>
    ({
        id: 'e1',
        stats: { attack: 1000, crit: 0, critDamage: 0, speed: 10, hacking: 0 },
        chargeCount: 0,
        startCharged: false,
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        enemyAb({ type: 'damage', config: { type: 'damage', multiplier: 100 } }),
                        enemyAb({
                            type: 'dot',
                            config: {
                                type: 'dot',
                                dotType: 'inferno',
                                tier: 45, // Inferno III (magnitude 45)
                                stacks: 1,
                                duration: 3,
                            },
                        }),
                    ],
                },
            ],
        } as ShipSkills,
    }) as EnemyAttacker;

function runAndCaptureResists() {
    const bus = createEventBus();
    const resisted: Extract<CombatEvent, { type: 'debuff-resisted' }>[] = [];
    bus.on('debuff-resisted', (e) => resisted.push(e));
    runCombat(
        BASE({
            numRounds: 1,
            hp: 1_000_000,
            defence: 0,
            healTargetId: 'attacker',
            mode: 'healing',
            enemyAttackers: [infernoEnemy()],
            shipSkills: { slots: [] },
            bus,
        })
    );
    return resisted;
}

describe('resisted DoT emits debuff-resisted (log line)', () => {
    it('a resisted Inferno III fires a debuff-resisted event labelled "Inferno III"', () => {
        const resisted = runAndCaptureResists();
        expect(resisted.some((e) => e.buffName === 'Inferno III')).toBe(true);
    });
});
