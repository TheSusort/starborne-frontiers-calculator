import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAutogearShipConfigs } from '../runShipOptimizer';
import type { Ship } from '../../../types/ship';
import type { CustomFormula } from '../../../types/autogear';

const ship = {
    id: 'focus',
    name: 'Focus',
    type: 'ATTACKER',
    faction: '',
    rarity: '',
} as unknown as Ship;

describe('useAutogearShipConfigs', () => {
    // Regression test for the bug where "Simulate candidates" scored a ship's own-role row with
    // whatever `shipConfigs` held when the page FIRST rendered, not what the user actually
    // configured — see `useAutogearShipConfigs`'s doc comment in `runShipOptimizer.ts`, which
    // covers `buildSimRerankConfig` too.
    it("buildSimRerankConfig's own-role row reflects the ship's CURRENT configuration, not a snapshot from an earlier render", () => {
        const { result } = renderHook(() => useAutogearShipConfigs(() => ship, null));

        // Nothing configured yet — the own-role row is the untouched default.
        const beforeConfig = result.current.buildSimRerankConfig(ship, ship.type);
        expect(beforeConfig.optimizeImplants).toBe(false);
        expect(beforeConfig.customFormula).toBeUndefined();

        // Configure the ship exactly as the Autogear Settings modal does, via `updateShipConfig`:
        // a custom formula and `optimizeImplants: true`.
        const customFormula: CustomFormula = {
            rows: [{ stat: 'attack', kind: 'core', direction: 'max' }],
        };
        act(() => {
            result.current.updateShipConfig(ship.id, {
                optimizeImplants: true,
                customFormula,
            });
        });

        // The own-role row must now carry what was just configured — not the pre-configuration
        // defaults a stale memoised closure would keep returning.
        const afterConfig = result.current.buildSimRerankConfig(ship, ship.type);
        expect(afterConfig.optimizeImplants).toBe(true);
        expect(afterConfig.customFormula).toBe(customFormula);
    });
});
