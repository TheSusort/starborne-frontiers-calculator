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

// Malvex's ACTIVE row, verbatim from docs/ship-skills.csv. Carries the SAME gate as the charged
// row above, but its consequent is a NAMELESS self-shield rather than a named buff — so it is built
// by the heal/shield loop, which never consulted detectGrantConditions (that helper needs a
// buffName to resolve a clause on). No comma before "this Unit" here; the gate regex allows both.
const MALVEX_ACTIVE =
    'This Unit deals <unit-damage>100% damage</unit-damage> with an additional damage equal to ' +
    '<unit-damage>5%</unit-damage> of its current Shield. If the target has a Shield this Unit ' +
    'gains <unit-damage>Shield equal to 15%</unit-damage> of its Max HP.';

const chargedAbilities = (text: string) =>
    buildShipAbilities({ refits: [], chargeSkillText: text } as unknown as Ship).slots.find(
        (s) => s.slot === 'charged'
    )?.abilities ?? [];

const activeAbilities = (text: string) =>
    buildShipAbilities({ refits: [], activeSkillText: text } as unknown as Ship).slots.find(
        (s) => s.slot === 'active'
    )?.abilities ?? [];

const selfShieldOf = (text: string) =>
    activeAbilities(text).find((a) => a.config.type === 'shield');

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

describe('"If the target has a Shield" gate (Malvex ACTIVE nameless self-shield)', () => {
    it('attaches a derivable enemy-shield condition to the self-shield grant', () => {
        // The charged-slot sibling above was fixed in #296; this row was left ungated because the
        // heal/shield builder hardcodes `conditions` to the damage-reaction/scaling set and never
        // asks for a clause gate. Ungated, Malvex banks 15% of its Max HP as shield on EVERY active
        // cast, shielded target or not.
        expect(selfShieldOf(MALVEX_ACTIVE)?.conditions).toEqual([
            { subject: 'enemy-shield', derivable: true },
        ]);
    });

    it('leaves the shield an on-cast self grant off 15% of max HP (gate only, no other change)', () => {
        const shield = selfShieldOf(MALVEX_ACTIVE);
        expect(shield?.trigger).toBe('on-cast');
        expect(shield?.target).toBe('self');
        expect(shield?.config).toMatchObject({ type: 'shield', pct: 15, basis: 'hp' });
    });

    it('leaves an ungated self-shield in the same slot condition-free', () => {
        // Sentence-scoped, like resolveBuffClause on the named-buff path: a shield clause with no
        // gate of its own must not inherit one. FrontLine's phrasing, minus the start-of-combat
        // trigger that would reroute it to the pre-combat seed.
        const shield = selfShieldOf(
            'This Unit gains <unit-damage>Shield equal to 25%</unit-damage> of its Max HP.'
        );
        expect(shield?.conditions).toEqual([]);
    });

    it('scopes the gate to the shield clause: a co-cast REPAIR in another sentence stays ungated', () => {
        // Two clauses, one gated. The heal must not pick up the shield's gate (and vice versa) —
        // the failure mode a text-wide (rather than sentence-scoped) test would let through.
        const text =
            'If the target has a Shield this Unit gains <unit-damage>Shield equal to 15%</unit-damage> ' +
            'of its Max HP. This Unit repairs <unit-damage>30%</unit-damage> of its Max HP.';
        expect(selfShieldOf(text)?.conditions).toEqual([
            { subject: 'enemy-shield', derivable: true },
        ]);
        const heal = activeAbilities(text).find((a) => a.config.type === 'heal');
        expect(heal?.conditions).toEqual([]);
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
