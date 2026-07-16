import { describe, it, expect } from 'vitest';
import { buildStandardScenario } from '../../../../scripts/lib/traceScenario';
import { simulateBattle } from '../../../../src/utils/calculators/battleSimulator';
import type { Ship } from '../../../../src/types/ship';

const reviewed: Ship = {
    id: 'trace:Test',
    name: 'Test',
    rarity: 'legendary',
    faction: 'MPL',
    type: 'ATTACKER',
    affinity: 'antimatter',
    baseStats: {
        hp: 250_000,
        attack: 3000,
        defence: 300,
        hacking: 220,
        security: 150,
        crit: 50,
        critDamage: 150,
        speed: 120,
    },
    equipment: {},
    implants: {},
    refits: [],
    activeSkillText: 'This Unit deals <unit-damage>120% damage</unit-damage>.',
    activeTarget: 'front',
    activePattern: 'Pattern-Base',
};

describe('buildStandardScenario', () => {
    it('places the reviewed ship as the focus actor with fillers and enemies', () => {
        const input = buildStandardScenario(reviewed);
        expect(input.playerTeam[0].ship.name).toBe('Test');
        expect(input.playerTeam[0].position).toBe('M4');
        expect(input.playerTeam.length).toBeGreaterThanOrEqual(3);
        expect(input.enemyTeam.length).toBeGreaterThanOrEqual(3);
        expect(input.rounds).toBe(30);
    });

    it('produces a runnable battle with a non-empty combat log', () => {
        const result = simulateBattle(buildStandardScenario(reviewed));
        expect(result.combatLog.length).toBeGreaterThan(0);
        // The reviewed ship acted at least once (its active fired). The reviewed ship is always
        // playerTeam[0], which the engine assigns the reserved focus actorId 'attacker' (see
        // `FOCUS_ID` in battleSimulator.ts) — combat log entries carry actorIds, not ship names,
        // so this is the correct way to detect the reviewed ship's turns (not a name substring
        // match, which would never appear in the log).
        const acted = result.combatLog.some((round) =>
            round.turns.some((turn) => turn.actorId === 'attacker' && turn.entries.length > 0)
        );
        expect(acted).toBe(true);
    });

    it('adds a fragile ally when requested', () => {
        const input = buildStandardScenario(reviewed, { includeFragileAlly: true });
        expect(input.playerTeam.length).toBe(4);
    });
});
