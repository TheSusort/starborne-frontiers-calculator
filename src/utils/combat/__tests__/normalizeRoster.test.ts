import { describe, it, expect } from 'vitest';
import { normalizeCombatRoster, MIN_TARGETABLE_MAX_HP } from '../normalizeRoster';
import {
    DEFAULT_ATTACKER_SLOT,
    DEFAULT_ENEMY_SLOT,
    DEFAULT_FRONT_ENEMY_TARGET,
    DEFAULT_BASE_PATTERN,
    defaultTeamSlot,
} from '../../calculators/dpsEnemyPlacement';
import { resolveCells } from '../../targeting/resolvePattern';
import type { CombatEngineInput } from '../engine';

/** Minimal valid engine input. Fields the boundary never reads are set to inert values. */
const baseInput = (over: Partial<CombatEngineInput> = {}): CombatEngineInput =>
    ({
        attack: 1000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: { slots: [] },
        numRounds: 1,
        selfBuffs: [],
        enemyDebuffs: [],
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        hasChargedSkill: false,
        startCharged: false,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        defence: 0,
        hp: 100_000,
        ...over,
    }) as CombatEngineInput;

const enemyInput = (id: string, position?: string) => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, speed: 10 },
    chargeCount: 0,
    startCharged: false,
    ...(position ? { position: position as never } : {}),
});

describe('normalizeCombatRoster — auto-placement', () => {
    it('places a position-less focus attacker on DEFAULT_ATTACKER_SLOT', () => {
        const out = normalizeCombatRoster(baseInput({ enemyAttackers: [enemyInput('e1')] }));
        expect(out.position).toBe(DEFAULT_ATTACKER_SLOT);
    });

    it('places a position-less first enemy on DEFAULT_ENEMY_SLOT', () => {
        const out = normalizeCombatRoster(baseInput({ enemyAttackers: [enemyInput('e1')] }));
        expect(out.enemyAttackers?.[0].position).toBe(DEFAULT_ENEMY_SLOT);
    });

    it('walks later enemies back instead of stacking them on the anchor', () => {
        const out = normalizeCombatRoster(
            baseInput({ enemyAttackers: [enemyInput('e1'), enemyInput('e2'), enemyInput('e3')] })
        );
        const slots = out.enemyAttackers.map((e) => e.position);
        expect(new Set(slots).size).toBe(3);
        expect(slots[0]).toBe(DEFAULT_ENEMY_SLOT);
    });

    it('does NOT move an explicitly-positioned actor', () => {
        const out = normalizeCombatRoster(
            baseInput({
                position: 'B1' as never,
                enemyAttackers: [enemyInput('e1', 'T2')],
            })
        );
        expect(out.position).toBe('B1');
        expect(out.enemyAttackers?.[0].position).toBe('T2');
    });

    it('places team actors without colliding with the focus', () => {
        const out = normalizeCombatRoster(
            baseInput({
                enemyAttackers: [enemyInput('e1')],
                teamActors: [{ id: 't1' }, { id: 't2' }] as never,
            })
        );
        const playerSlots = [out.position, ...out.teamActors!.map((t) => t.position)];
        expect(new Set(playerSlots).size).toBe(3);
    });

    it('keeps the two sides on independent boards (both may anchor on M4)', () => {
        const out = normalizeCombatRoster(baseInput({ enemyAttackers: [enemyInput('e1')] }));
        expect(out.position).toBe('M4');
        expect(out.enemyAttackers?.[0].position).toBe('M4');
    });

    // SP-4b-2b: this test used to read "leaves an empty enemy roster empty — it never invents an
    // enemy", asserting `out.enemyAttackers ?? []` came back `[]`. That was the OLD contract, and
    // this PR reverses it: the boundary is the one place that could accommodate an
    // under-specified caller, and accommodating it is exactly what kept the dummy sink alive. So
    // the boundary now REFUSES an opponent-less run instead of passing the emptiness through.
    //
    // The "never invents an enemy" half of the old subject is not lost — it is now implied
    // strictly more strongly. A function that throws cannot have synthesized a sink, and the
    // guard's own message names the correct caller-side remedy
    // (`healingEngineAdapter.practiceTarget`, i.e. synthesize the inert opponent ABOVE the
    // boundary, where it is visible). Both the `[]` and the `undefined` spelling are pinned
    // because an `as CombatEngineInput` cast at a call site defeats the compile-time check and
    // reaches this line with the field missing entirely.
    it('REFUSES an empty enemy roster rather than passing the emptiness through', () => {
        expect(() => normalizeCombatRoster(baseInput({ enemyAttackers: [] }))).toThrow(
            /enemyAttackers is empty/
        );
    });

    it('REFUSES a missing enemy roster too — the runtime guard catches `undefined`, not just `[]`', () => {
        expect(() => normalizeCombatRoster(baseInput())).toThrow(/enemyAttackers is empty/);
    });

    it('is a pure function — the caller’s input object is not mutated', () => {
        const input = baseInput({ enemyAttackers: [enemyInput('e1')] });
        normalizeCombatRoster(input);
        expect(input.position).toBeUndefined();
        expect(input.enemyAttackers?.[0].position).toBeUndefined();
    });

    it('walks enemies back in defaultEnemySlot order, not collision-resolver order', () => {
        const out = normalizeCombatRoster(
            baseInput({ enemyAttackers: [enemyInput('e1'), enemyInput('e2'), enemyInput('e3')] })
        );
        // defaultEnemySlot order is ['M4','T4','B4',...]; index 0 takes the anchor.
        expect(out.enemyAttackers.map((e) => e.position)).toEqual(['M4', 'T4', 'B4']);
    });

    it('walks team actors back in defaultTeamSlot order, not collision-resolver order', () => {
        const out = normalizeCombatRoster(
            baseInput({
                enemyAttackers: [enemyInput('e1')],
                teamActors: [{ id: 't1' }, { id: 't2' }, { id: 't3' }] as never,
            })
        );
        // defaultTeamSlot order is ['M3','M2','M1',...]; the focus keeps the anchor (M4), so the
        // Nth team actor lands on defaultTeamSlot(N) rather than wherever the collision resolver
        // happens to place it. The symmetric gap on the enemy side (no test above) hid a real
        // off-by-one until it was closed — this pins the same invariant for the team side.
        expect(out.teamActors!.map((t) => t.position)).toEqual([
            defaultTeamSlot(0),
            defaultTeamSlot(1),
            defaultTeamSlot(2),
        ]);
        expect(out.teamActors!.map((t) => t.position)).toEqual(['M3', 'M2', 'M1']);
    });

    describe('an invented slot yields to an explicit one', () => {
        it('player: focus invented + team explicit on the anchor cell — the team actor keeps M4, the focus moves', () => {
            const out = normalizeCombatRoster(
                baseInput({
                    enemyAttackers: [enemyInput('e1')],
                    teamActors: [{ id: 't1', position: DEFAULT_ATTACKER_SLOT }] as never,
                })
            );
            expect(out.teamActors?.[0].position).toBe(DEFAULT_ATTACKER_SLOT);
            expect(out.position).not.toBe(DEFAULT_ATTACKER_SLOT);
        });

        it('player: focus explicit + team explicit on the same cell — index 0 (the anchor) wins, pre-existing behaviour', () => {
            const out = normalizeCombatRoster(
                baseInput({
                    position: 'T2' as never,
                    enemyAttackers: [enemyInput('e1')],
                    teamActors: [{ id: 't1', position: 'T2' as never }] as never,
                })
            );
            expect(out.position).toBe('T2');
            expect(out.teamActors?.[0].position).not.toBe('T2');
        });

        it('player: focus explicit + team invented — the focus keeps its explicit slot', () => {
            const out = normalizeCombatRoster(
                baseInput({
                    position: 'T2' as never,
                    enemyAttackers: [enemyInput('e1')],
                    teamActors: [{ id: 't1' }] as never,
                })
            );
            expect(out.position).toBe('T2');
        });

        it('enemy: focus invented + a later enemy explicit on the anchor cell — the explicit enemy keeps M4, the focus enemy moves', () => {
            const out = normalizeCombatRoster(
                baseInput({
                    enemyAttackers: [enemyInput('e1'), enemyInput('e2', DEFAULT_ENEMY_SLOT)],
                })
            );
            expect(out.enemyAttackers?.[1].position).toBe(DEFAULT_ENEMY_SLOT);
            expect(out.enemyAttackers?.[0].position).not.toBe(DEFAULT_ENEMY_SLOT);
        });

        it('enemy: focus explicit + a later enemy explicit on the same cell — index 0 (the anchor) wins, pre-existing behaviour', () => {
            const out = normalizeCombatRoster(
                baseInput({
                    enemyAttackers: [enemyInput('e1', 'T2'), enemyInput('e2', 'T2')],
                })
            );
            expect(out.enemyAttackers?.[0].position).toBe('T2');
            expect(out.enemyAttackers?.[1].position).not.toBe('T2');
        });

        it('enemy: focus explicit + a later enemy invented — the focus enemy keeps its explicit slot', () => {
            const out = normalizeCombatRoster(
                baseInput({
                    enemyAttackers: [enemyInput('e1', 'T2'), enemyInput('e2')],
                })
            );
            expect(out.enemyAttackers?.[0].position).toBe('T2');
        });
    });
});

describe('normalizeCombatRoster — targeting synthesis', () => {
    it('gives a target-less focus the front-enemy default and the base pattern', () => {
        const out = normalizeCombatRoster(baseInput({ enemyAttackers: [enemyInput('e1')] }));
        expect(out.target).toEqual(DEFAULT_FRONT_ENEMY_TARGET);
        expect(out.pattern).toEqual(DEFAULT_BASE_PATTERN);
    });

    it('gives target-less enemies the same defaults (side is relative to the actor)', () => {
        const out = normalizeCombatRoster(baseInput({ enemyAttackers: [enemyInput('e1')] }));
        expect(out.enemyAttackers?.[0].target).toEqual(DEFAULT_FRONT_ENEMY_TARGET);
        expect(out.enemyAttackers?.[0].pattern).toEqual(DEFAULT_BASE_PATTERN);
    });

    it('synthesizes a pattern that actually resolves — "base|1|" has no offset table and would throw', () => {
        // Checking `out.pattern?.range === 0` in isolation only re-derives a property of the
        // DEFAULT_BASE_PATTERN constant the adjacent `toEqual` test already pins — it would pass
        // even if `withTargeting` synthesized something else with `range: 0` on it. Actually
        // resolving the synthesized pattern observes the thing that matters: a positional apply can
        // use it without throwing, which range:1 (no offset table) could not.
        const out = normalizeCombatRoster(baseInput({ enemyAttackers: [enemyInput('e1')] }));
        expect(() => resolveCells(out.pattern!, out.position!)).not.toThrow();
    });

    it('NEVER substitutes a target the caller supplied, including an ally-side one', () => {
        const allySide = { raw: 'lowest hp ally', side: 'ally', selection: 'lowest-hp' } as never;
        const out = normalizeCombatRoster(
            baseInput({ target: allySide, enemyAttackers: [enemyInput('e1')] })
        );
        // Substituting here is the healing ADAPTER's policy, not the boundary's. A battle-sim
        // support ship must keep targeting allies.
        expect(out.target).toBe(allySide);
    });

    it('NEVER synthesizes the charged axes — undefined there means "reuse the active axis"', () => {
        const out = normalizeCombatRoster(baseInput({ enemyAttackers: [enemyInput('e1')] }));
        expect(out.enemyAttackers?.[0].chargedTarget).toBeUndefined();
        expect(out.enemyAttackers?.[0].chargedPattern).toBeUndefined();
    });

    it('fills a missing pattern even when the target was supplied', () => {
        const explicitTarget = { raw: 'back enemy', side: 'enemy', selection: 'back' } as never;
        const out = normalizeCombatRoster(
            baseInput({ target: explicitTarget, enemyAttackers: [enemyInput('e1')] })
        );
        // Both axes are independently required for a positional cast, and a missing PATTERN fails
        // silently — perTargetDealt comes back empty while the damage number looks plausible.
        expect(out.target).toBe(explicitTarget);
        expect(out.pattern).toEqual(DEFAULT_BASE_PATTERN);
    });

    it('fills a missing target even when the pattern was supplied — the vice versa direction', () => {
        const explicitPattern = {
            raw: 'line range 2',
            shape: 'line',
            range: 2,
            modifiers: {},
        } as never;
        const out = normalizeCombatRoster(
            baseInput({ pattern: explicitPattern, enemyAttackers: [enemyInput('e1')] })
        );
        // Same independence, opposite axis: a missing TARGET falls back to the dummy at
        // selectTurnTarget regardless of how well-formed the pattern is.
        expect(out.pattern).toBe(explicitPattern);
        expect(out.target).toEqual(DEFAULT_FRONT_ENEMY_TARGET);
    });

    it('gives target-less team actors the defaults too', () => {
        const out = normalizeCombatRoster(
            baseInput({ enemyAttackers: [enemyInput('e1')], teamActors: [{ id: 't1' }] as never })
        );
        expect(out.teamActors?.[0].target).toEqual(DEFAULT_FRONT_ENEMY_TARGET);
        expect(out.teamActors?.[0].pattern).toEqual(DEFAULT_BASE_PATTERN);
    });
});

describe('normalizeCombatRoster — fenced in both directions', () => {
    it('TOO LOOSE would move explicit positions: a full explicit board is returned unchanged', () => {
        const input = baseInput({
            position: 'T1' as never,
            teamActors: [{ id: 't1', position: 'T2' }] as never,
            enemyAttackers: [enemyInput('e1', 'B3'), enemyInput('e2', 'B4')],
        });
        const out = normalizeCombatRoster(input);
        expect(out.position).toBe('T1');
        expect(out.teamActors?.[0].position).toBe('T2');
        expect(out.enemyAttackers?.map((e) => e.position)).toEqual(['B3', 'B4']);
    });

    it('TOO STRICT would skip mixed rosters: it places only the actors that lack a position', () => {
        const out = normalizeCombatRoster(
            baseInput({
                enemyAttackers: [enemyInput('e1', 'B3'), enemyInput('e2')],
            })
        );
        expect(out.enemyAttackers?.[0].position).toBe('B3');
        expect(out.enemyAttackers?.[1].position).toBeDefined();
        expect(out.enemyAttackers?.[1].position).not.toBe('B3');
    });

    // The brief's original third test asserted "the anchor (index 0) keeps its cell" on ANY
    // focus/team collision. Since 3952a6a0 that is only true when the focus's own slot is
    // EXPLICIT — an INVENTED anchor now yields to an explicit collider. Both directions are
    // fenced below rather than the single case the brief assumed. The same two properties are
    // also exercised (with different concrete positions) by the "an invented slot yields to an
    // explicit one" describe block above; they are kept here too, deliberately, because THIS
    // describe block is the one that pairs them with the TOO LOOSE / TOO STRICT tests as the
    // brief's baseline three-test requirement — not an accidental copy-paste.
    it('explicit vs explicit collision: the anchor (index 0) keeps its cell — pre-existing resolver behaviour', () => {
        const out = normalizeCombatRoster(
            baseInput({
                position: 'M4' as never,
                teamActors: [{ id: 't1', position: 'M4' }] as never,
                enemyAttackers: [enemyInput('e1')],
            })
        );
        expect(out.position).toBe('M4');
        expect(out.teamActors?.[0].position).not.toBe('M4');
    });

    it('invented vs explicit collision: the explicit actor keeps the cell and the invented anchor moves', () => {
        const out = normalizeCombatRoster(
            baseInput({
                // position omitted — the focus is auto-placed onto DEFAULT_ATTACKER_SLOT ('M4').
                teamActors: [{ id: 't1', position: DEFAULT_ATTACKER_SLOT }] as never,
                enemyAttackers: [enemyInput('e1')],
            })
        );
        expect(out.teamActors?.[0].position).toBe(DEFAULT_ATTACKER_SLOT);
        expect(out.position).not.toBe(DEFAULT_ATTACKER_SLOT);
    });

    it('is a no-op on a fully-positioned, fully-targeted input (module-level, not runCombat-level)', () => {
        // The honest form of "leaves an explicitly-positioned run byte-identical": that name was
        // previously attached to a runCombat test that compared runCombat against ITSELF, which
        // proves RNG determinism, not that this boundary is inert on positioned input. This
        // asserts the actual no-op property directly on the module under test.
        const target = { raw: 'back enemy', side: 'enemy', selection: 'back' } as never;
        const pattern = { raw: 'single target', shape: 'base', range: 0, modifiers: {} } as never;
        const input = baseInput({
            position: 'B1' as never,
            target,
            pattern,
            teamActors: [{ id: 't1', position: 'T2', target, pattern }] as never,
            enemyAttackers: [
                {
                    ...enemyInput('e1', 'T2'),
                    // An ARBITRARY positive hp (12_345), deliberately NOT MIN_TARGETABLE_MAX_HP.
                    // `withTargetableHp` is fill-if-absent-or-<=0, not a `Math.max` clamp, so any
                    // positive value already leaves the input untouched — the floor has nothing to
                    // raise here regardless of which positive number is chosen. Picking an arbitrary
                    // value rather than the floor's own constant keeps this fence honest as "nothing
                    // is invented when everything is given" even if the fill logic is ever tightened
                    // into a clamp: a fixture pinned to the floor's exact value would keep passing
                    // under a clamp (which also leaves it untouched, being already at the minimum),
                    // silently losing its ability to catch that change. An arbitrary value fails
                    // loudly under a clamp instead, because a clamp WOULD raise it.
                    stats: { ...enemyInput('e1', 'T2').stats, hp: 12_345 },
                    target,
                    pattern,
                },
            ],
        });
        const out = normalizeCombatRoster(input);
        expect(out).toEqual(input);
    });
});

describe('normalizeCombatRoster — targetable HP floor', () => {
    const zeroHpEnemy = (id: string) => ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, speed: 10, hp: 0 },
        chargeCount: 0,
        startCharged: false,
    });

    it('floors an explicit 0 max HP to MIN_TARGETABLE_MAX_HP', () => {
        const out = normalizeCombatRoster(baseInput({ enemyAttackers: [zeroHpEnemy('e1')] }));
        expect(out.enemyAttackers[0].stats.hp).toBe(MIN_TARGETABLE_MAX_HP);
    });

    it('floors an ABSENT max HP too — the boundary default was 0', () => {
        const out = normalizeCombatRoster(baseInput({ enemyAttackers: [enemyInput('e1')] }));
        expect(out.enemyAttackers[0].stats.hp).toBe(MIN_TARGETABLE_MAX_HP);
    });

    it('leaves a real max HP untouched', () => {
        const real = { ...zeroHpEnemy('e1'), stats: { ...zeroHpEnemy('e1').stats, hp: 5_000 } };
        const out = normalizeCombatRoster(baseInput({ enemyAttackers: [real] }));
        expect(out.enemyAttackers[0].stats.hp).toBe(5_000);
    });

    it('floors EVERY member of an all-zero roster, not just the anchor', () => {
        const out = normalizeCombatRoster(
            baseInput({ enemyAttackers: [zeroHpEnemy('e1'), zeroHpEnemy('e2')] })
        );
        expect(out.enemyAttackers.map((e) => e.stats.hp)).toEqual([
            MIN_TARGETABLE_MAX_HP,
            MIN_TARGETABLE_MAX_HP,
        ]);
    });

    it('does NOT floor the focus attacker — hp 0 is legitimate there', () => {
        const out = normalizeCombatRoster(
            baseInput({ hp: 0, enemyAttackers: [zeroHpEnemy('e1')] })
        );
        expect(out.hp).toBe(0);
    });

    it('is pure — the caller’s nested stats object is never mutated', () => {
        const input = baseInput({ enemyAttackers: [zeroHpEnemy('e1')] });
        const before = input.enemyAttackers[0].stats.hp;
        normalizeCombatRoster(input);
        expect(input.enemyAttackers[0].stats.hp).toBe(before);
        expect(before).toBe(0);
    });
});
