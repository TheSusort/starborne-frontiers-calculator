import { describe, it, expect } from 'vitest';
import { buildSameEnemyBaseline, buildStandardScenario } from '../traceScenario';
import { canonicalPlacement } from '../../../src/utils/combat/audit/fixtures';
import type { Ship } from '../../../src/types/ship';
import type { BattlePlacement } from '../../../src/utils/calculators/battleSimulator';

const ship = (id: string, name: string, over: Partial<Ship['baseStats']> = {}): Ship => ({
    id,
    name,
    rarity: 'legendary',
    faction: 'MPL',
    type: 'ATTACKER',
    affinity: 'chemical',
    baseStats: {
        hp: 100_000,
        attack: 2000,
        defence: 1000,
        hacking: 90,
        security: 40,
        crit: 20,
        critDamage: 150,
        speed: 100,
        ...over,
    },
    equipment: {},
    implants: {},
    refits: [],
    activeSkillText: 'This Unit deals <unit-damage>100% damage</unit-damage>.',
    activeTarget: 'front',
    activePattern: 'Pattern-Base',
});

const subject = canonicalPlacement(ship('s-subject', 'Subject'), 'T1');
const enemies: BattlePlacement[] = [
    canonicalPlacement(ship('s-e1', 'EnemyOne'), 'M2'),
    canonicalPlacement(ship('s-e2', 'EnemyTwo'), 'B3'),
];

describe('buildSameEnemyBaseline', () => {
    it('puts the subject ALONE on the player side, keeping its position and stat overrides', () => {
        const input = buildSameEnemyBaseline(subject, enemies);
        expect(input.playerTeam).toHaveLength(1);
        expect(input.playerTeam[0]).toBe(subject);
        expect(input.playerTeam[0].position).toBe('T1');
        expect(input.playerTeam[0].statOverrides).toEqual(subject.statOverrides);
    });

    it('reuses the caller’s enemy roster verbatim, in order', () => {
        const input = buildSameEnemyBaseline(subject, enemies);
        expect(input.enemyTeam).toHaveLength(2);
        expect(input.enemyTeam[0]).toBe(enemies[0]);
        expect(input.enemyTeam[1]).toBe(enemies[1]);
    });

    it('copies the enemy array so the caller’s roster cannot be mutated through the result', () => {
        const input = buildSameEnemyBaseline(subject, enemies);
        input.enemyTeam.pop();
        expect(enemies).toHaveLength(2);
    });

    it('passes `rounds` through, including undefined (engine default)', () => {
        expect(buildSameEnemyBaseline(subject, enemies, 7).rounds).toBe(7);
        expect(buildSameEnemyBaseline(subject, enemies).rounds).toBeUndefined();
    });

    it('throws on an empty enemy roster rather than emitting an unrunnable battle', () => {
        expect(() => buildSameEnemyBaseline(subject, [])).toThrow(/enemyTeam is empty/);
    });

    // Instrument validity: the whole point of this builder is that it is NOT the canned scenario.
    // If the differential oracle were reverted to `buildStandardScenario`, these assertions are
    // what would fail — the canned scenario injects its own fillers on BOTH sides and pins the
    // subject to M4, none of which may survive here.
    it('shares nothing with the canned standard scenario except the subject itself', () => {
        const canned = buildStandardScenario(subject.ship);
        const cannedIds = new Set(
            [...canned.playerTeam, ...canned.enemyTeam].map((p) => p.ship.id)
        );
        expect(cannedIds.has('trace-ally-plain')).toBe(true); // the canned baseline really does add allies
        expect(cannedIds.has('trace-e-1')).toBe(true); // ...and its own enemies
        expect(canned.playerTeam[0].position).toBe('M4'); // ...and re-pins the subject

        const input = buildSameEnemyBaseline(subject, enemies);
        const ids = [...input.playerTeam, ...input.enemyTeam].map((p) => p.ship.id);
        expect(ids).toEqual(['s-subject', 's-e1', 's-e2']);
        expect(ids.some((id) => id.startsWith('trace-ally-'))).toBe(false);
        expect(ids.some((id) => id.startsWith('trace-e-'))).toBe(false);
        expect(input.playerTeam[0].position).not.toBe('M4');
    });
});
