import { describe, it, expect } from 'vitest';
import { buildShipAbilities } from '../buildShipAbilities';
import { Ship } from '../../../types/ship';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const shipWith = (over: Partial<Ship>): Ship => ({ ...({} as any), ...over }) as Ship;

describe('Wave 8 Task 13 — Meiying Stasis-on-kill gated on a debuffed victim (parser)', () => {
    // Verbatim docs/ship-skills.csv Meiying first_passive_skill_text: "Upon killing an enemy with
    // a Debuff, this Unit inflicts Stasis on all adjacent enemies for 1 turn." Target
    // (adjacent-enemies) and trigger (on-enemy-destroyed) already shipped in Wave 5 — locked here
    // alongside the NEW killed-enemy-had-debuff condition this task adds.
    const MEIYING_P1 =
        'Upon killing an enemy with a Debuff, this Unit inflicts <unit-skill>Stasis</unit-skill> on all adjacent enemies for 1 turn.';

    it('the Stasis debuff carries adjacent-enemies target, on-enemy-destroyed trigger, and a killed-enemy-had-debuff condition', () => {
        const { slots } = buildShipAbilities(shipWith({ firstPassiveSkillText: MEIYING_P1 }));
        const passive = slots.find((s) => s.slot === 'passive');
        const stasis = passive?.abilities.find(
            (a) => a.config.type === 'debuff' && a.config.buffName === 'Stasis'
        );
        expect(stasis).toBeDefined();
        expect(stasis?.target).toBe('adjacent-enemies');
        expect(stasis?.trigger).toBe('on-enemy-destroyed');
        expect(stasis?.conditions).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ subject: 'killed-enemy-had-debuff', derivable: true }),
            ])
        );
    });

    it('regression: a plain kill-reactive grant with NO "with a Debuff" qualifier stays ungated', () => {
        // Mangler/Ravager/Sokol-shape phrasing: "Upon killing an enemy, this Unit gains <Buff>
        // for N turns." — no debuff qualifier, so the new gate must NOT attach.
        const s = shipWith({
            firstPassiveSkillText:
                'Upon killing an enemy, this Unit gains <unit-skill>Speed Up I</unit-skill> for 3 turns.',
        });
        const { slots } = buildShipAbilities(s);
        const abilities = slots.flatMap((sl) => sl.abilities);
        const speedUp = abilities.find(
            (a) => a.config.type === 'buff' && a.config.buffName === 'Speed Up I'
        );
        expect(speedUp).toBeDefined();
        expect(speedUp?.trigger).toBe('on-enemy-destroyed');
        expect(speedUp?.conditions.some((c) => c.subject === 'killed-enemy-had-debuff')).toBe(
            false
        );
    });
});
