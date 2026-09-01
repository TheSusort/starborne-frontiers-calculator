/**
 * Tormenter's "itself and all adjacent allies" grant — ENGINE integration.
 *
 * The parse-level fix lives in `skillTextParser`'s `detectGrantScopes` (and is pinned in
 * `abilities/__tests__/selfAndAdjacentGrantScope.test.ts`). That test cannot see the thing the
 * owner ruling is actually about, because the parse alone does not decide who gets the buff:
 * `adjacentAllyIds` falls back to the WHOLE living same side whenever no board positions are
 * wired, so in a non-positional sim `self` + `adjacent-allies` is indistinguishable from the old
 * `all-allies` routing. Every golden in the suite is non-positional, which is exactly why the
 * parser change moved none of them.
 *
 * So the recipient set is proven HERE, on a real board:
 *
 *   Tormenter @ M3 casts its active. M3's neighbours are M2, M4, T2, T3, B2, B3
 *   (targeting/board.ts). One ally sits at M4 (adjacent), one at M1 (NOT adjacent — two hexes
 *   away, present on the roster, inside no neighbour set).
 *
 * Owner ruling 2026-08-30, posed as that same in-fight example: Tormenter and the M4 ally come
 * away with the Out. Damage Up I icon; the M1 ally gets nothing.
 *
 * Non-vacuity: the M1 ally is a full team actor on the same side and the same roster as the M4
 * one — the two differ ONLY in board position. A run of this fixture against the pre-fix parser
 * puts the buff on all three (the all-allies routing), so the "far ally is excluded" assertion
 * genuinely discriminates; and the positive half (Tormenter itself + M4) fails if the fix had
 * emitted `adjacent-allies` alone, which would silently drop the caster.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';
import { Ship } from '../../../types/ship';
import type { Ability } from '../../../types/abilities';
import type { ConditionContext } from '../../abilities/evaluateConditions';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

// Reference data is gitignored; throw rather than skip so a worktree missing it fails loudly
// instead of reporting a silent pass.
function requireReferenceData(): void {
    if (!csvAvailable()) {
        throw new Error(
            'docs/ship-skills.csv is missing from this worktree (gitignored reference data) — ' +
                "this test resolves Tormenter's real skill text from it."
        );
    }
}

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

const noopActive = (): Ability => ({
    id: 'noop',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 0 },
});

function skillsFor(name: string): CombatEngineInput['shipSkills'] {
    const rec = loadShipSkillRecords().find((r) => r.name.toUpperCase() === name.toUpperCase());
    if (!rec) throw new Error(`docs/ship-skills.csv: no record for "${name}"`);
    return buildShipAbilities({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({} as any),
        refits: [{}, {}, {}, {}],
        activeSkillText: rec.active,
        chargeSkillText: rec.charge,
        chargeSkillCharge: rec.chargeCharge,
        firstPassiveSkillText: rec.passives[0],
        secondPassiveSkillText: rec.passives[1],
        thirdPassiveSkillText: rec.passives[2],
    } as Ship);
}

/** The non-vacuity control's kit: one plain `all-allies` on-cast buff and nothing else. */
const allAlliesControlKit = (): CombatEngineInput['shipSkills'] => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'control-buff',
                    type: 'buff',
                    target: 'all-allies',
                    trigger: 'on-cast',
                    conditions: [],
                    config: {
                        type: 'buff',
                        buffName: 'Attack Up I',
                        parsedEffects: { attack: 15 },
                        stacks: 1,
                        isStackable: false,
                        duration: 1,
                    },
                },
            ],
        },
    ],
});

/** A same-side ally that only ever RECEIVES: its own active deals nothing. */
const ally = (id: string, position: Position): TeamActorEngineInput =>
    ({
        id,
        speed: 1, // acts after Tormenter, so the grant has already landed
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position,
        target: parsedTarget('front'),
        pattern: basePattern(),
        walk: {
            shipSkills: { slots: [{ slot: 'active', abilities: [noopActive()] }] },
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 0,
                hp: 20_000,
            },
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
    }) as unknown as TeamActorEngineInput;

const casterAtM3 = (over: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    attack: 10_000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: skillsFor('Tormenter'),
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
    hp: 1_000_000_000,
    healTargetId: 'attacker',
    mode: 'healing',
    position: 'M3',
    target: parsedTarget('front'),
    pattern: basePattern(),
    speed: 100, // acts first
    teamActors: [ally('adjacent-ally', 'M4'), ally('far-ally', 'M1')],
    enemyAttackers: [
        {
            id: 'dummy',
            stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 1 },
            chargeCount: 0,
            startCharged: false,
            position: 'M4',
            target: parsedTarget('front'),
            pattern: basePattern(),
            shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
        },
    ],
    ...over,
});

/** Recipients of `buffName`, in application order (`actorId` is the RECIPIENT). */
function recipientsOf(buffName: string, over: Partial<CombatEngineInput> = {}): string[] {
    const bus = createEventBus();
    const applied: Extract<CombatEvent, { type: 'buff-applied' }>[] = [];
    bus.on('buff-applied', (e) => applied.push(e));
    runCombat({ ...casterAtM3(over), bus });
    return applied.filter((b) => b.buffName === buffName).map((b) => b.actorId);
}

describe('Tormenter — "grants Out. Damage Up I to itself and all adjacent allies"', () => {
    beforeAll(requireReferenceData);

    it('buffs the caster and its board neighbour, and NOT the ally two hexes away', () => {
        const recipients = recipientsOf('Out. Damage Up I');
        expect([...new Set(recipients)].sort()).toEqual(['adjacent-ally', 'attacker']);
        expect(recipients).not.toContain('far-ally');
    });

    // NON-VACUITY CONTROL. The fixture only means anything if an ally-scoped grant can reach the
    // two team actors AT ALL from this board — otherwise "the far ally got nothing" is a fact
    // about the harness, not about adjacency. Same fixture, same actors, one hand-built
    // `all-allies` buff swapped in for the caster's kit: all three must receive it.
    it('CONTROL: an all-allies grant from the same board reaches all three actors', () => {
        expect(
            [...new Set(recipientsOf('Attack Up I', { shipSkills: allAlliesControlKit() }))]
                .sort()
                .join(',')
        ).toBe('adjacent-ally,attacker,far-ally');
    });
});

// CHARACTERIZATION, not a guard for the fix above — read the measured note before trusting it.
//
// Centurion's charged skill reads "This Unit gains 4 stacks of Core Charge I and grants all
// adjacent allies 2 stacks of Core Charge I …", and the parser has resolved that into a `self` +
// an `adjacent-allies` pair since ship-kit W8 Task 2. He is the corpus's only other cast-path
// `adjacent-allies` grant, so he is the ship this commit's engine change could have disturbed.
//
// MEASURED 2026-08-30 (mutation-probed, both arms): his stacks are **4 either way**. The recipient
// routing moves the adjacent status off Centurion's own store and onto his neighbour's, but it is
// unobservable on BOTH sides, for two independent reasons:
//   • on his store it was already dead — `registerAbilityStatuses` keys the accumulating map by
//     `payload.buffName` and `.set()`s, so two same-named statuses on one owner overwrite rather
//     than sum; only one rate ever survived.
//   • on the neighbour's store it is dead too — `statusEngine.sourceFired` increments
//     `accumSelfMaps.get('attacker')` ONLY ("legacy semantics", its own comment), so an
//     accumulating status on any store but the focus actor's never ticks.
// So Centurion's sim output was unchanged by THAT commit.
//
// BOTH layers are now fixed (#436, 2026-09-01, on two owner rulings): the accumulating map holds
// one contribution per GRANTER instead of a single overwritten rate, and a per-slot share ticks
// on its granter's cast rather than only the focus actor's. Centurion still banks 4 on his own
// charge; his neighbour now banks 2 on the same cast. The `far-ally` half of the pin is untouched
// and still the point — a non-adjacent roster member is never a recipient at all.
describe('Centurion — charged "grants all adjacent allies 2 stacks of Core Charge I"', () => {
    beforeAll(requireReferenceData);

    // Core Charge I is an ACCUMULATING status ("gains N stacks", recurring duration), and
    // accumulating stores never emit `buff-applied` — they are registered once per recipient at
    // actor construction, not cast per round. So the recipient set is read back out of the store
    // itself, the same way fuyingFactionScopeSweep reads its aura fan-out.
    const coreChargeStacks = (): Record<string, number | undefined> => {
        const baseCtx: ConditionContext = {
            selfBuffNames: [],
            selfDebuffNames: [],
            enemyBuffNames: [],
            enemyDebuffCount: 0,
            effectiveCritRate: 50,
            adjacentAllyCount: 0,
            enemyAdjacentCount: 0,
            enemyDestroyedCount: 0,
            selfHpPct: 100,
            enemyHpPct: 100,
        };
        let stacksFor: (id: string) => number | undefined = () => undefined;
        runCombat({
            ...casterAtM3({
                shipSkills: skillsFor('Centurion'),
                hasChargedSkill: true,
                startCharged: true,
            }),
            __testTapStatusEngine: (engine) => {
                stacksFor = (id: string) =>
                    engine
                        .activeAbilityStatuses('self', () => baseCtx, id)
                        .find((s) => s.active.buffName === 'Core Charge I')?.active.stacks;
            },
        });
        return Object.fromEntries(
            ['attacker', 'adjacent-ally', 'far-ally'].map((id) => [id, stacksFor(id)])
        );
    };

    it('Centurion still banks his own 4 stacks per charge — unchanged by the routing fix', () => {
        expect(coreChargeStacks()['attacker']).toBe(4);
    });

    it("the adjacent ally banks 2 stacks on Centurion's charge; the far ally is no recipient", () => {
        const stacks = coreChargeStacks();
        expect(stacks['far-ally']).toBeUndefined();
        // #436: the near ally's grant now ticks on CENTURION's charge (owner ruling 2026-09-01 —
        // a granted accumulating stack keeps accruing on the GRANTER's cadence). Before #436
        // this read `undefined`: the entry was registered on his store and visible there, but
        // only the focus actor's map was ever incremented.
        expect(stacks['adjacent-ally']).toBe(2);
    });
});

// #436 ruling B, on a real board: two same-named accumulating grants on ONE owner both land.
//
// Two Centurions side by side at M3 and M4 (each is in the other's neighbour set), both starting
// charged, both casting their charged skill in round 1. Each one's store then holds TWO shares of
// Core Charge I — his own 4-stack self grant, and the other's 2-stack adjacent grant — and the
// owner ruling (2026-09-01, posed as exactly this fight) is that each reads 6.
//
// This is the engine-level witness for the summing half of #436. The unit test in
// accumulatingGranterCadence.test.ts drives statusEngine directly; this one goes through
// runCombat, so it is what proves the two registrations actually reach one store from the real
// cast path. Before #436 the second registration `.set()` over the first and each Centurion read
// 4 — which is why his pre-fix double-registration onto himself was harmless rather than
// doubling his stacks.
describe("#436 — two adjacent Centurions each bank their own grant AND the other's", () => {
    beforeAll(requireReferenceData);

    /** A second Centurion as a team actor: same kit as the caster, starts charged, acts after. */
    const centurionAtM4 = (): TeamActorEngineInput => ({
        ...ally('centurion-b', 'M4'),
        chargeCount: 0,
        startCharged: true,
        walk: {
            shipSkills: skillsFor('Centurion'),
            stats: {
                attack: 10_000,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 0,
                hp: 1_000_000_000,
            },
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: true,
        },
    });

    const stacksAfterBothCharge = (): Record<string, number | undefined> => {
        const baseCtx: ConditionContext = {
            selfBuffNames: [],
            selfDebuffNames: [],
            enemyBuffNames: [],
            enemyDebuffCount: 0,
            effectiveCritRate: 50,
            adjacentAllyCount: 0,
            enemyAdjacentCount: 0,
            enemyDestroyedCount: 0,
            selfHpPct: 100,
            enemyHpPct: 100,
        };
        let stacksFor: (id: string) => number | undefined = () => undefined;
        runCombat({
            ...casterAtM3({
                shipSkills: skillsFor('Centurion'),
                hasChargedSkill: true,
                startCharged: true,
                teamActors: [centurionAtM4()],
            }),
            __testTapStatusEngine: (engine) => {
                stacksFor = (id: string) =>
                    engine
                        .activeAbilityStatuses('self', () => baseCtx, id)
                        .find((s) => s.active.buffName === 'Core Charge I')?.active.stacks;
            },
        });
        return Object.fromEntries(['attacker', 'centurion-b'].map((id) => [id, stacksFor(id)]));
    };

    it("each Centurion reads 6 = his own 4 plus his neighbour's 2", () => {
        const stacks = stacksAfterBothCharge();
        expect(stacks['attacker']).toBe(6);
        expect(stacks['centurion-b']).toBe(6);
    });
});
