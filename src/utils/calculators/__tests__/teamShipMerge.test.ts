import { describe, it, expect } from 'vitest';
import { TeamShipConfig, SelectedGameBuff } from '../../../types/calculator';

// Pure helper extracted from the DPSCalculatorPage memo.
// Given a list of team ships, produce enemy debuffs with sourceStartCharged overridden.
function mergeTeamEnemyDebuffs(teamShips: TeamShipConfig[]): SelectedGameBuff[] {
    return teamShips.flatMap((t) =>
        t.enemyDebuffs.map((d) => ({ ...d, sourceStartCharged: t.startCharged }))
    );
}

const makeDebuff = (overrides: Partial<SelectedGameBuff> = {}): SelectedGameBuff => ({
    id: 'test',
    buffName: 'Defense Down II',
    stacks: 1,
    parsedEffects: { defense: -20 },
    isStackable: false,
    autoFilled: true,
    sourceChargeCount: 3,
    sourceStartCharged: false,
    ...overrides,
});

describe('mergeTeamEnemyDebuffs', () => {
    it('returns empty array for no team ships', () => {
        expect(mergeTeamEnemyDebuffs([])).toEqual([]);
    });

    it('overrides sourceStartCharged=false when teamShip.startCharged is false', () => {
        const ship: TeamShipConfig = {
            id: '1',
            startCharged: false,
            buffs: [],
            enemyDebuffs: [makeDebuff({ sourceStartCharged: true })],
        };
        const result = mergeTeamEnemyDebuffs([ship]);
        expect(result[0].sourceStartCharged).toBe(false);
    });

    it('overrides sourceStartCharged=true when teamShip.startCharged is true', () => {
        const ship: TeamShipConfig = {
            id: '1',
            startCharged: true,
            buffs: [],
            enemyDebuffs: [makeDebuff({ sourceStartCharged: false })],
        };
        const result = mergeTeamEnemyDebuffs([ship]);
        expect(result[0].sourceStartCharged).toBe(true);
    });

    it('flattens debuffs from multiple team ships', () => {
        const ships: TeamShipConfig[] = [
            { id: '1', startCharged: false, buffs: [], enemyDebuffs: [makeDebuff({ id: 'a' })] },
            { id: '2', startCharged: true, buffs: [], enemyDebuffs: [makeDebuff({ id: 'b' })] },
        ];
        const result = mergeTeamEnemyDebuffs(ships);
        expect(result).toHaveLength(2);
        expect(result[0].sourceStartCharged).toBe(false);
        expect(result[1].sourceStartCharged).toBe(true);
    });

    it('preserves all other debuff fields unchanged', () => {
        const debuff = makeDebuff({ sourceChargeCount: 5, buffName: 'Armor Rift' });
        const ship: TeamShipConfig = {
            id: '1',
            startCharged: true,
            buffs: [],
            enemyDebuffs: [debuff],
        };
        const [result] = mergeTeamEnemyDebuffs([ship]);
        expect(result.buffName).toBe('Armor Rift');
        expect(result.sourceChargeCount).toBe(5);
        expect(result.stacks).toBe(1);
    });
});
