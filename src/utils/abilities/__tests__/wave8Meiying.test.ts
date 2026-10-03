import { describe, it, expect } from 'vitest';
import { buildShipAbilities } from '../buildShipAbilities';
import { Ship } from '../../../types/ship';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const shipWith = (over: Partial<Ship>): Ship => ({ ...({} as any), ...over }) as Ship;

describe('Wave 8 Task 13 — Meiying Stasis-on-kill gated on a debuffed victim (parser)', () => {
    // Verbatim docs/ship-skills.csv Meiying first_passive_skill_text. Target (adjacent-enemies)
    // and trigger (on-enemy-destroyed) are locked here alongside the killed-enemy-had-debuff
    // condition.
    const MEIYING_P1 =
        "This Unit's attacks ignore <unit-skill>Taunt</unit-skill> and <unit-skill>Provoke</unit-skill> effects.<br /><br />Upon destroying an enemy with a <unit-aid>debuff</unit-aid>, this Unit inflicts <unit-skill>Stasis</unit-skill> on all adjacent enemies for 1 turn.";

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
        // Mangler's "it gains <Buff> for N turns upon destroying an enemy." — the same "destroying
        // an enemy" with no debuff qualifier, so the gate must NOT attach.
        const s = shipWith({
            firstPassiveSkillText:
                'This Unit gains 1 stack of <unit-skill>Overload</unit-skill> every turn and, upon destroying an enemy, removes <unit-skill>Overload</unit-skill>. Additionally, it gains <unit-skill>Marauder Rage I</unit-skill> for 2 turns upon destroying an enemy.',
        });
        const { slots } = buildShipAbilities(s);
        const abilities = slots.flatMap((sl) => sl.abilities);
        const grant = abilities.find(
            (a) => a.config.type === 'buff' && a.config.buffName === 'Marauder Rage I'
        );
        expect(grant).toBeDefined();
        expect(grant?.trigger).toBe('on-enemy-destroyed');
        expect(grant?.conditions.some((c) => c.subject === 'killed-enemy-had-debuff')).toBe(false);
    });
});
