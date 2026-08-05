import { describe, it, expect } from 'vitest';
import { buildShipAbilities } from '../buildShipAbilities';
import type { Ship } from '../../../types/ship';

const abilitiesFor = (text: string) =>
    buildShipAbilities({ refits: [], activeSkillText: text } as unknown as Ship).slots.find(
        (s) => s.slot === 'active'
    )?.abilities ?? [];

describe('"shield equal to 100% of its max HP" gate', () => {
    it('emits a derivable self-shield-full condition', () => {
        const abilities = abilitiesFor(
            "At the end of this Unit's turn if it has shield equal to 100% of its max HP, this Unit grants all allies <unit-skill>Barrier</unit-skill> for 1 hit."
        );
        const barrier = abilities.find(
            (a) => a.config.type === 'buff' && a.config.buffName === 'Barrier'
        );
        expect(barrier?.conditions).toContainEqual(
            expect.objectContaining({ subject: 'self-shield-full', derivable: true })
        );
    });

    it('does not fire on a plain "When Shielded" clause (Malvex canary)', () => {
        const abilities = abilitiesFor(
            'When Shielded, this Unit grants all allies <unit-skill>Barrier</unit-skill> for 1 hit.'
        );
        const barrier = abilities.find(
            (a) => a.config.type === 'buff' && a.config.buffName === 'Barrier'
        );
        expect(barrier?.conditions ?? []).not.toContainEqual(
            expect.objectContaining({ subject: 'self-shield-full' })
        );
    });
});
