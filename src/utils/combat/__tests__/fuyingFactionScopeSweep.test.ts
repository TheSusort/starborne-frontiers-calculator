/**
 * #363 Gap 1 follow-up (review finding 3) — the recipient FACTION intersection
 * (`Ability.factionFilter`) is applied at FOUR sites, and `fuyingFactionScope.integration.test.ts`
 * only exercises one of them (the timed cast-path loop in playerTurn.ts, via
 * `resolveSupportRecipients`). This file covers the other three, each with its own minimal
 * engine-level scenario built to isolate that ONE site:
 *
 *   - `seedPassiveTimedStatuses` (engine.ts) — a PASSIVE-slot finite-duration buff, seeded once
 *     at round 1 (never routes through playerTurn's cast-path loop at all).
 *   - the aura/accumulating registration fan-out inside `registerActorAbilityStatuses`
 *     (engine.ts) — a duration-less (recurring) buff, read back via `activeAbilityStatuses`
 *     rather than a `buff-applied` event (an aura is not "cast" per round).
 *   - `footprintFilteredRecipients` (triggers.ts) — a REACTIVE (`start-of-round`) buff grant,
 *     which never touches `registerActorAbilityStatuses`/`seedPassiveTimedStatuses` at all.
 *
 * Each scenario pairs the scoped grant with an UNFILTERED control grant of the same shape, so a
 * broken/no-op factionFilter (every recipient gets it) is distinguishable from a broken cast path
 * (nobody gets either). No positions/patterns anywhere — footprint narrowing is `undefined`, so
 * the faction intersection is the only narrowing in play (mirrors fuyingFactionScope's own
 * synthetic-kit rationale).
 */
import { describe, it, expect } from 'vitest';
import { runCombat, type CombatEngineInput } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { bareEnemy } from '../__testutils__/bareRosterFixture';
import type { ConditionContext } from '../../abilities/evaluateConditions';
import type { FactionKey } from '../../../constants/factions';
import type { ShipSkills } from '../../../types/abilities';

const inertWalkStats = (hp: number) => ({
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    hacking: 0,
    defence: 0,
    hp,
});

const inertAlly = (id: string, faction?: FactionKey) => ({
    id,
    speed: 1,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    ...(faction ? { faction } : {}),
    walk: {
        shipSkills: { slots: [] },
        stats: inertWalkStats(500_000),
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: false,
    },
});

function recipientsOf(
    buffsApplied: Extract<CombatEvent, { type: 'buff-applied' }>[],
    name: string
) {
    return [
        ...new Set(buffsApplied.filter((e) => e.buffName === name).map((e) => e.actorId)),
    ].sort();
}

function runAndCollectBuffs(input: CombatEngineInput) {
    const bus = createEventBus();
    const buffsApplied: Extract<CombatEvent, { type: 'buff-applied' }>[] = [];
    bus.on('buff-applied', (e) => buffsApplied.push(e));
    runCombat({ ...input, bus });
    return buffsApplied;
}

const BASE = (shipSkills: ShipSkills): CombatEngineInput => ({
    attack: 1000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills,
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
    hp: 1_000_000,
    faction: 'TIANCHAO',
    teamActors: [
        inertAlly('ally-tianchao', 'TIANCHAO'),
        inertAlly('ally-xaoc', 'XAOC'),
        inertAlly('ally-unknown'), // manual slot: no faction at all
    ],
    enemyAttackers: bareEnemy({ stats: { hp: 10_000_000 } }),
});

describe('#363 faction-filter sweep — site 2: seedPassiveTimedStatuses (passive-slot combat-start seed)', () => {
    const kit: ShipSkills = {
        slots: [
            {
                slot: 'passive',
                abilities: [
                    {
                        id: 'seed-scoped',
                        type: 'buff',
                        target: 'all-allies',
                        trigger: 'on-cast',
                        conditions: [],
                        factionFilter: ['TIANCHAO'],
                        config: {
                            type: 'buff',
                            buffName: 'Passive Seed Scoped',
                            parsedEffects: {},
                            stacks: 1,
                            isStackable: false,
                            duration: 3,
                        },
                    },
                    {
                        id: 'seed-open',
                        type: 'buff',
                        target: 'all-allies',
                        trigger: 'on-cast',
                        conditions: [],
                        config: {
                            type: 'buff',
                            buffName: 'Passive Seed Control',
                            parsedEffects: {},
                            stacks: 1,
                            isStackable: false,
                            duration: 3,
                        },
                    },
                ],
            },
        ],
    };

    it('seeds the scoped grant onto matching-faction allies only, the control onto everyone', () => {
        const buffs = runAndCollectBuffs(BASE(kit));
        // Control: proves the passive seed fired at all and reached the whole roster — without
        // this the scoped assertion below could pass on a seed that silently never ran.
        expect(recipientsOf(buffs, 'Passive Seed Control')).toEqual([
            'ally-tianchao',
            'ally-unknown',
            'ally-xaoc',
            'attacker',
        ]);
        expect(recipientsOf(buffs, 'Passive Seed Scoped')).toEqual(['ally-tianchao', 'attacker']);
    });
});

describe('#363 faction-filter sweep — site 3: aura/accumulating registration fan-out', () => {
    const kit: ShipSkills = {
        slots: [
            {
                slot: 'passive',
                abilities: [
                    {
                        id: 'aura-scoped',
                        type: 'buff',
                        target: 'all-allies',
                        trigger: 'on-cast',
                        conditions: [],
                        factionFilter: ['TIANCHAO'],
                        config: {
                            type: 'buff',
                            buffName: 'Aura Scoped',
                            parsedEffects: {},
                            stacks: 1,
                            isStackable: false,
                            // No duration → aura (recurring), the branch site 3 covers.
                        },
                    },
                    {
                        id: 'aura-open',
                        type: 'buff',
                        target: 'all-allies',
                        trigger: 'on-cast',
                        conditions: [],
                        config: {
                            type: 'buff',
                            buffName: 'Aura Control',
                            parsedEffects: {},
                            stacks: 1,
                            isStackable: false,
                        },
                    },
                ],
            },
        ],
    };

    // Auras never emit `buff-applied` (they are not "cast" per round) — read the per-recipient
    // aura STORE back via `__testTapStatusEngine` + `activeAbilityStatuses('self', ctx, id)`,
    // exactly like statusEngine.test.ts's own aura-fan-out assertions.
    it('registers the scoped aura only onto matching-faction allies, the control onto everyone', () => {
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
        let auraNamesFor: (id: string) => string[] = () => [];
        runCombat({
            ...BASE(kit),
            __testTapStatusEngine: (engine) => {
                auraNamesFor = (id: string) =>
                    engine
                        .activeAbilityStatuses('self', () => baseCtx, id)
                        .map((s) => s.active.buffName);
            },
        });
        for (const id of ['attacker', 'ally-tianchao']) {
            const names = auraNamesFor(id);
            expect(names).toContain('Aura Scoped');
            expect(names).toContain('Aura Control');
        }
        for (const id of ['ally-xaoc', 'ally-unknown']) {
            const names = auraNamesFor(id);
            expect(names).not.toContain('Aura Scoped');
            expect(names).toContain('Aura Control');
        }
    });
});

describe('#363 faction-filter sweep — site 4: footprintFilteredRecipients (reactive path)', () => {
    const kit: ShipSkills = {
        slots: [
            {
                slot: 'passive',
                abilities: [
                    {
                        id: 'reactive-scoped',
                        type: 'buff',
                        target: 'all-allies',
                        trigger: 'start-of-round',
                        conditions: [],
                        factionFilter: ['TIANCHAO'],
                        config: {
                            type: 'buff',
                            buffName: 'Reactive Scoped',
                            parsedEffects: {},
                            stacks: 1,
                            isStackable: false,
                            duration: 3,
                        },
                    },
                    {
                        id: 'reactive-open',
                        type: 'buff',
                        target: 'all-allies',
                        trigger: 'start-of-round',
                        conditions: [],
                        config: {
                            type: 'buff',
                            buffName: 'Reactive Control',
                            parsedEffects: {},
                            stacks: 1,
                            isStackable: false,
                            duration: 3,
                        },
                    },
                ],
            },
        ],
    };

    it('grants the scoped reactive buff to matching-faction allies only, the control to everyone', () => {
        const buffs = runAndCollectBuffs(BASE(kit));
        expect(recipientsOf(buffs, 'Reactive Control')).toEqual([
            'ally-tianchao',
            'ally-unknown',
            'ally-xaoc',
            'attacker',
        ]);
        expect(recipientsOf(buffs, 'Reactive Scoped')).toEqual(['ally-tianchao', 'attacker']);
    });
});
