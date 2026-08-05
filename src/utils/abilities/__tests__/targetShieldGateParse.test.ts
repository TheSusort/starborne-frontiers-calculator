/**
 * "If the target has a Shield" → the `enemy-shield` gate (Malvex's charged Barrier).
 *
 * Malvex's charged skill grants Barrier — FULL damage immunity — only when the target it just hit
 * carries a shield. The gate used to be dropped on the floor entirely (`conditions: []`), so the
 * immunity landed on every charged cast. The parse side of that fix is pinned here; the
 * five-layer live wiring that makes the condition actually gate anything is pinned by
 * malvexTargetShieldGate.integration.test.ts (engine level) and the LIVE_SUBJECTS membership
 * guard in abilityStatusGating.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { buildShipAbilities } from '../buildShipAbilities';
import { conditionsMet } from '../evaluateConditions';
import type { Ship } from '../../../types/ship';
import type { Condition } from '../../../types/abilities';

// Verbatim from docs/ship-skills.csv (the only ground truth for skill text), including the
// typographic apostrophe in "enemy’s Shield".
const MALVEX_CHARGED =
    'This Unit deals <unit-damage>220% damage</unit-damage> with additional damage equal to ' +
    '<unit-damage>12%</unit-damage> of its current Shield and removes 30% of the enemy’s Shield. ' +
    'If the target has a Shield, it gains <unit-skill>Barrier</unit-skill> for 1 hit.';

const chargedAbilities = (text: string) =>
    buildShipAbilities({ refits: [], chargeSkillText: text } as unknown as Ship).slots.find(
        (s) => s.slot === 'charged'
    )?.abilities ?? [];

const barrierOf = (text: string) =>
    chargedAbilities(text).find((a) => a.config.type === 'buff' && a.config.buffName === 'Barrier');

describe('"If the target has a Shield" gate (Malvex charged Barrier)', () => {
    it('attaches a derivable enemy-shield condition to the Barrier grant', () => {
        // derivable:true is load-bearing: evaluateCondition short-circuits a derivable:false
        // condition to "met", which would leave the Barrier exactly as ungated as before the fix.
        expect(barrierOf(MALVEX_CHARGED)?.conditions).toEqual([
            { subject: 'enemy-shield', derivable: true },
        ]);
    });

    it('still parses the rest of the cast unchanged (the gate is scoped to the Barrier clause)', () => {
        // The shield-strip clause sits BEFORE the Barrier clause in the same skill; resolveBuffClause
        // scopes the gate to the Barrier sentence, so the strip must stay condition-free.
        const strip = chargedAbilities(MALVEX_CHARGED).find(
            (a) => a.config.type === 'shield-strip'
        );
        expect(strip?.conditions).toEqual([]);
    });

    it('does not fire on the OWNER-side phrasing (APEX canary)', () => {
        // "If this Unit has Shield" is the `self-shield` sibling rule immediately above this one in
        // detectGrantConditions. The two must never co-match.
        const barrier = barrierOf(
            'If this Unit has Shield, it gains <unit-skill>Barrier</unit-skill> for 1 hit.'
        );
        expect(barrier?.conditions).toEqual([{ subject: 'self-shield', derivable: true }]);
    });

    it('does not fire on a bare "When Shielded" clause (Malvex passive canary)', () => {
        // Malvex's own second passive says "When Shielded, this Ship takes 10% less damage" — an
        // owner-side incoming-reduction condition, not a target-side gate.
        const barrier = barrierOf(
            'When Shielded, it gains <unit-skill>Barrier</unit-skill> for 1 hit.'
        );
        expect(barrier?.conditions ?? []).not.toContainEqual(
            expect.objectContaining({ subject: 'enemy-shield' })
        );
    });
});

describe('enemy-shield condition evaluation', () => {
    const GATE: Condition[] = [{ subject: 'enemy-shield', derivable: true }];

    it('is met when the resolved target carries a shield', () => {
        expect(conditionsMet(GATE, { enemyShielded: true } as never)).toBe(true);
    });

    it('is NOT met when the target has no shield', () => {
        expect(conditionsMet(GATE, { enemyShielded: false } as never)).toBe(false);
    });

    it('is NOT met when the field is absent (DPS mode — the dummy victim has no shield pool)', () => {
        // And specifically NOT satisfied by the OWNER's shield: the two subjects read separate
        // fields, which is the whole point of adding a second one.
        expect(conditionsMet(GATE, { selfShielded: true } as never)).toBe(false);
    });
});
