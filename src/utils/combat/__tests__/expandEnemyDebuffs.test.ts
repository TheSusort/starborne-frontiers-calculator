import { describe, it, expect } from 'vitest';
import { expandEnemyDebuffs } from '../playerTurn';
import type { ActiveBuff } from '../statusEngine';
import type { SelectedGameBuff } from '../../../types/calculator';

const mk = (name: string, parsedEffects: Record<string, number>): SelectedGameBuff =>
    ({ buffName: name, stacks: 1, parsedEffects }) as unknown as SelectedGameBuff;

describe('expandEnemyDebuffs', () => {
    it('maps active debuff names through the lookup to SelectedGameBuff effects', () => {
        const lookup = new Map<string, SelectedGameBuff[]>([
            ['Defense Down', [mk('Defense Down', { defense: -30 })]],
        ]);
        const active: ActiveBuff[] = [{ buffName: 'Defense Down', turnsRemaining: 2 }];
        expect(expandEnemyDebuffs(active, lookup)).toEqual([
            expect.objectContaining({ buffName: 'Defense Down', parsedEffects: { defense: -30 } }),
        ]);
    });

    it('applies the per-round stack override and drops zero-stack entries', () => {
        const lookup = new Map<string, SelectedGameBuff[]>([
            ['Stacking Down', [mk('Stacking Down', { defense: -10 })]],
        ]);
        // Non-zero stacks: override is applied (stacks field on result matches ab.stacks)
        expect(
            expandEnemyDebuffs(
                [{ buffName: 'Stacking Down', turnsRemaining: 'recurring', stacks: 3 }],
                lookup
            )
        ).toEqual([expect.objectContaining({ stacks: 3 })]);
        // Zero stacks: dropped entirely (expandBuffs returns [] when stacks === 0)
        expect(
            expandEnemyDebuffs(
                [{ buffName: 'Stacking Down', turnsRemaining: 'recurring', stacks: 0 }],
                lookup
            )
        ).toEqual([]);
    });

    it('drops unknown names (no lookup entry) → empty', () => {
        expect(expandEnemyDebuffs([{ buffName: 'Unknown', turnsRemaining: 1 }], new Map())).toEqual(
            []
        );
    });
});
