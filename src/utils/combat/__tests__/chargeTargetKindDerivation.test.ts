/**
 * #407 — the anti-drift cross-check between `CHARGE_TARGET_KIND` (triggers.ts) and
 * `ABILITY_TARGET_SELECTOR` (abilityTargetSide.ts).
 *
 * Both are total `Record`s over `AbilityTarget`, so `tsc` already forces a NEW target to be
 * classified in each. What `tsc` could NOT force is that the two AGREE about which targets are
 * selectors at all: they were hand-authored in different files, each spelling out the same
 * three-target partition. #407 derives `CHARGE_TARGET_KIND`'s three selector VALUES from
 * `enemySelectorKind`, and its union arm from `EnemySelectorKind`, so the two cannot disagree by
 * construction. This file checks that from the other direction — the derivation could be undone by
 * someone "simplifying" it back to literals, and the literals would look perfectly plausible.
 *
 * Pure refactor when it was written: all twelve target→kind pairs are asserted unchanged below, and
 * the charge-removal behaviour is covered by `chargeTargetSideWidening.test.ts` plus the
 * charge-removal engine integration tests.
 */
import { describe, it, expect } from 'vitest';
import { CHARGE_TARGET_KIND } from '../triggers';
import { ABILITY_TARGET_SELECTOR, enemySelectorKind } from '../../abilities/abilityTargetSide';
import type { AbilityTarget } from '../../../types/abilities';

const ALL_TARGETS = Object.keys(ABILITY_TARGET_SELECTOR) as AbilityTarget[];

describe('#407: CHARGE_TARGET_KIND cannot drift from ABILITY_TARGET_SELECTOR', () => {
    it('every SELECTOR target maps to the matching selector-* charge kind', () => {
        const selectorTargets = ALL_TARGETS.filter((t) => enemySelectorKind(t) !== null);
        // Guard the sweep: if the selector classification ever emptied out, every assertion in the
        // loop below would pass vacuously.
        expect(selectorTargets).toHaveLength(3);

        for (const target of selectorTargets) {
            expect(CHARGE_TARGET_KIND[target]).toBe(`selector-${enemySelectorKind(target)}`);
        }
    });

    it('no NON-selector target maps to a selector-* charge kind', () => {
        // The other direction, and the one a re-literalised map would break: a target that
        // abilityTargetSide.ts says is NOT a selector must not be dispatched to a selector arm,
        // which resolves exactly one opposing actor.
        const wrong = ALL_TARGETS.filter(
            (t) => enemySelectorKind(t) === null && CHARGE_TARGET_KIND[t].startsWith('selector-')
        );
        expect(wrong).toEqual([]);
    });

    it('preserves the exact twelve target -> kind pairs the derivation replaced', () => {
        // Written out deliberately: this was a pure dispatch refactor, and this is the record that
        // no arm moved while the three selector values became derived.
        expect(CHARGE_TARGET_KIND).toEqual({
            self: 'owner-gain',
            ally: 'ally-bulk',
            'all-allies': 'ally-bulk',
            'lowest-hp-ally': 'lowest-hp-ally',
            // KNOWN GAP, unchanged by #407 — see CHARGE_TARGET_KIND's own doc comment.
            'adjacent-allies': 'owner-gain',
            enemy: 'enemy-bulk',
            'all-enemies': 'enemy-bulk',
            // KNOWN GAP, unchanged by #407.
            'adjacent-enemies': 'owner-gain',
            'target-and-adjacent-enemies': 'owner-gain',
            'enemy-most-buffs': 'selector-most-buffs',
            'enemy-highest-attack': 'selector-highest-attack',
            'enemy-highest-speed': 'selector-highest-speed',
        });
    });
});
