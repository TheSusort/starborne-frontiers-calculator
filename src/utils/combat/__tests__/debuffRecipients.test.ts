/**
 * Recipient resolution for a direct enemy-debuff clause (multi-hit full-walk epic, PR8 Task 1).
 *
 * Extracted VERBATIM from playerTurn.ts's cast-time ternary so the cast-time path and PR8's
 * per-sub-attack path cannot drift. Every branch below mirrors one arm of that ternary; the
 * `undefined` recipient means "resolve to the turn's own bound victim" — the DPS/non-positional
 * single-target answer — which is why the return type is `(string | undefined)[]` and not
 * `string[]`. (#343: it was called "the dummy sink" until the placeholder actor that name referred
 * to was deleted in #339; the mechanism is the same one.)
 */
import { describe, it, expect } from 'vitest';
import { resolveDebuffRecipientIds } from '../debuffRecipients';
import type { EnemySelectorKind } from '../../abilities/abilityTargetSide';

const adjacentOf = (anchorId: string): string[] => [`${anchorId}-left`, `${anchorId}-right`];

describe('resolveDebuffRecipientIds', () => {
    it('adjacent-enemies fans over the anchor’s neighbours and excludes the anchor', () => {
        expect(
            resolveDebuffRecipientIds({
                abTarget: 'adjacent-enemies',
                anchorId: 'v1',
                aoeVictimIds: undefined,
                adjacentEnemyIdsFor: adjacentOf,
                positionalLanding: true,
            })
        ).toEqual(['v1-left', 'v1-right']);
    });

    it('adjacent-enemies with no anchor resolves to nothing', () => {
        expect(
            resolveDebuffRecipientIds({
                abTarget: 'adjacent-enemies',
                anchorId: undefined,
                aoeVictimIds: undefined,
                adjacentEnemyIdsFor: adjacentOf,
                positionalLanding: true,
            })
        ).toEqual([]);
    });

    it('target-and-adjacent-enemies puts the anchor FIRST, then its neighbours', () => {
        expect(
            resolveDebuffRecipientIds({
                abTarget: 'target-and-adjacent-enemies',
                anchorId: 'v1',
                aoeVictimIds: undefined,
                adjacentEnemyIdsFor: adjacentOf,
                positionalLanding: true,
            })
        ).toEqual(['v1', 'v1-left', 'v1-right']);
    });

    it("target-and-adjacent-enemies with no anchor: positional resolves to nothing, non-positional to the turn's bound victim", () => {
        const base = {
            abTarget: 'target-and-adjacent-enemies' as const,
            anchorId: undefined,
            aoeVictimIds: undefined,
            adjacentEnemyIdsFor: adjacentOf,
        };
        expect(resolveDebuffRecipientIds({ ...base, positionalLanding: true })).toEqual([]);
        expect(resolveDebuffRecipientIds({ ...base, positionalLanding: false })).toEqual([
            undefined,
        ]);
    });

    it('all-enemies positional uses the supplied footprint, even when empty', () => {
        expect(
            resolveDebuffRecipientIds({
                abTarget: 'all-enemies',
                anchorId: 'v1',
                aoeVictimIds: ['v1', 'v2'],
                adjacentEnemyIdsFor: undefined,
                positionalLanding: true,
            })
        ).toEqual(['v1', 'v2']);
        expect(
            resolveDebuffRecipientIds({
                abTarget: 'all-enemies',
                anchorId: 'v1',
                aoeVictimIds: undefined,
                adjacentEnemyIdsFor: undefined,
                positionalLanding: true,
            })
        ).toEqual([]);
    });

    it('all-enemies non-positional uses the footprint only when non-empty, else falls back to the anchor', () => {
        expect(
            resolveDebuffRecipientIds({
                abTarget: 'all-enemies',
                anchorId: 'v1',
                aoeVictimIds: ['v2', 'v3'],
                adjacentEnemyIdsFor: undefined,
                positionalLanding: false,
            })
        ).toEqual(['v2', 'v3']);
        expect(
            resolveDebuffRecipientIds({
                abTarget: 'all-enemies',
                anchorId: 'v1',
                aoeVictimIds: [],
                adjacentEnemyIdsFor: undefined,
                positionalLanding: false,
            })
        ).toEqual(['v1']);
    });

    it("single-target resolves to the anchor; with no anchor, positional is empty and non-positional is the turn's bound victim", () => {
        expect(
            resolveDebuffRecipientIds({
                abTarget: 'enemy',
                anchorId: 'v1',
                aoeVictimIds: undefined,
                adjacentEnemyIdsFor: undefined,
                positionalLanding: true,
            })
        ).toEqual(['v1']);
        expect(
            resolveDebuffRecipientIds({
                abTarget: 'enemy',
                anchorId: undefined,
                aoeVictimIds: undefined,
                adjacentEnemyIdsFor: undefined,
                positionalLanding: true,
            })
        ).toEqual([]);
        expect(
            resolveDebuffRecipientIds({
                abTarget: 'enemy',
                anchorId: undefined,
                aoeVictimIds: undefined,
                adjacentEnemyIdsFor: undefined,
                positionalLanding: false,
            })
        ).toEqual([undefined]);
    });

    it('an undefined abTarget (no matching ability found) behaves as single-target', () => {
        expect(
            resolveDebuffRecipientIds({
                abTarget: undefined,
                anchorId: 'v1',
                aoeVictimIds: ['v1', 'v2'],
                adjacentEnemyIdsFor: adjacentOf,
                positionalLanding: true,
            })
        ).toEqual(['v1']);
    });

    it('adjacentEnemyIdsFor absent yields no neighbours (the DPS/non-positional caller supplies none)', () => {
        expect(
            resolveDebuffRecipientIds({
                abTarget: 'target-and-adjacent-enemies',
                anchorId: 'v1',
                aoeVictimIds: undefined,
                adjacentEnemyIdsFor: undefined,
                positionalLanding: true,
            })
        ).toEqual(['v1']);
    });

    // ── #403: the three enemy SELECTOR targets ────────────────────────────────────────────
    // Before #403 these fell through the whole ternary to its tail, `[anchorId]` — the cast's
    // normal target — so a clause naming "the highest attack enemy" hit whoever the pattern
    // anchored on. The delegate below stands in for engine.ts's buildTurnArgs closure.
    // #403 review Finding 3: typed against the real `EnemySelectorKind` union (not `string`) so a
    // typo'd kind key is a compile error instead of silently resolving to `undefined`.
    const selectorFor =
        (byKind: Partial<Record<EnemySelectorKind, string>>) =>
        (kind: EnemySelectorKind): string | undefined =>
            byKind[kind];

    it('#403 enemy-highest-attack resolves through the delegate, not the anchor', () => {
        expect(
            resolveDebuffRecipientIds({
                abTarget: 'enemy-highest-attack',
                anchorId: 'anchor',
                aoeVictimIds: ['anchor', 'big'],
                adjacentEnemyIdsFor: adjacentOf,
                positionalLanding: true,
                selectorEnemyIdFor: selectorFor({ 'highest-attack': 'big' }),
            })
        ).toEqual(['big']);
    });

    it('#403 enemy-most-buffs resolves through the delegate', () => {
        expect(
            resolveDebuffRecipientIds({
                abTarget: 'enemy-most-buffs',
                anchorId: 'anchor',
                aoeVictimIds: undefined,
                adjacentEnemyIdsFor: undefined,
                positionalLanding: true,
                selectorEnemyIdFor: selectorFor({ 'most-buffs': 'buffed' }),
            })
        ).toEqual(['buffed']);
    });

    it('#403 enemy-highest-speed resolves through the delegate', () => {
        expect(
            resolveDebuffRecipientIds({
                abTarget: 'enemy-highest-speed',
                anchorId: 'anchor',
                aoeVictimIds: undefined,
                adjacentEnemyIdsFor: undefined,
                positionalLanding: true,
                selectorEnemyIdFor: selectorFor({ 'highest-speed': 'fast' }),
            })
        ).toEqual(['fast']);
    });

    it('#403 a selector target NEVER reaches the all-enemies footprint arms', () => {
        // The selector branch sits AHEAD of the all-enemies branches. A selector names exactly one
        // actor; if the footprint arms ran first, an AoE cast carrying a selector clause would fan
        // the clause over the whole board.
        expect(
            resolveDebuffRecipientIds({
                abTarget: 'enemy-highest-attack',
                anchorId: 'anchor',
                aoeVictimIds: ['anchor', 'big', 'third'],
                adjacentEnemyIdsFor: adjacentOf,
                positionalLanding: true,
                selectorEnemyIdFor: selectorFor({ 'highest-attack': 'big' }),
            })
        ).toEqual(['big']);
    });

    it('#403 R1 unresolved selector: positional fizzles, non-positional falls to the bound victim', () => {
        // R1. On a real positioned board an unresolved selector ("most buffs" with no buff
        // anywhere) inflicts NOTHING — no victim, no resist, no landing draw. A non-positional /
        // DPS caller cannot resolve a selector at all (it has no roster), so it keeps the turn's
        // own bound victim and DPS numbers stay put.
        const base = {
            abTarget: 'enemy-most-buffs' as const,
            anchorId: 'anchor',
            aoeVictimIds: undefined,
            adjacentEnemyIdsFor: undefined,
            selectorEnemyIdFor: selectorFor({}), // delegate present, resolves to undefined
        };
        expect(resolveDebuffRecipientIds({ ...base, positionalLanding: true })).toEqual([]);
        expect(resolveDebuffRecipientIds({ ...base, positionalLanding: false })).toEqual([
            undefined,
        ]);
    });

    it('#403 R1 delegate ABSENT behaves the same as unresolved (the DPS caller supplies none)', () => {
        const base = {
            abTarget: 'enemy-highest-attack' as const,
            anchorId: 'anchor',
            aoeVictimIds: undefined,
            adjacentEnemyIdsFor: undefined,
        };
        expect(resolveDebuffRecipientIds({ ...base, positionalLanding: true })).toEqual([]);
        expect(resolveDebuffRecipientIds({ ...base, positionalLanding: false })).toEqual([
            undefined,
        ]);
    });

    it('#403 a NON-selector target ignores the delegate entirely', () => {
        // Guards the regression direction: supplying a delegate must not change any existing arm.
        expect(
            resolveDebuffRecipientIds({
                abTarget: 'enemy',
                anchorId: 'anchor',
                aoeVictimIds: undefined,
                adjacentEnemyIdsFor: undefined,
                positionalLanding: true,
                selectorEnemyIdFor: selectorFor({ 'highest-attack': 'big' }),
            })
        ).toEqual(['anchor']);
        expect(
            resolveDebuffRecipientIds({
                abTarget: 'all-enemies',
                anchorId: 'anchor',
                aoeVictimIds: ['anchor', 'big'],
                adjacentEnemyIdsFor: undefined,
                positionalLanding: true,
                selectorEnemyIdFor: selectorFor({ 'highest-attack': 'big' }),
            })
        ).toEqual(['anchor', 'big']);
    });
});
