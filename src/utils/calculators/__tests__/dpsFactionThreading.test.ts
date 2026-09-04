import { describe, it, expect } from 'vitest';
import { simulateDPS, DPSSimulationInput } from '../dpsSimulator';
import { DEFAULT_ATTACKER_SLOT, DEFAULT_ENEMY_SLOT } from '../dpsEnemyPlacement';
import type { ShipSkills } from '../../../types/abilities';
import type { CombatEvent } from '../../combat/events';

/**
 * task-prepr Fix 2 — before this fix `DPSSimulationInput` carried no `faction` field at all and
 * the DPS calculator page never populated `TeamShipConfig.faction` / `DPSShipConfig.faction`, so a
 * Fuying-shaped focus attacker or team actor in the DPS calculator granted Stealth to nobody: every
 * player actor read as unknown-faction, which a `factionFilter` never matches (conservative). This
 * pins the `simulateDPS` plumbing directly — the same faction-scoped grant kit the engine-level
 * `fuyingFactionScope.integration.test.ts` uses, run through the DPS adapter instead of `runCombat`
 * directly, so a regression in the ADAPTER'S OWN wiring (not just the engine) is caught here.
 */

const factionScopedGrantKit = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'fs-scoped',
                    type: 'buff',
                    target: 'all-allies',
                    trigger: 'on-cast',
                    conditions: [],
                    factionFilter: ['TIANCHAO'],
                    config: {
                        type: 'buff',
                        buffName: 'Stealth',
                        parsedEffects: {},
                        stacks: 1,
                        isStackable: false,
                        duration: 1,
                    },
                },
                {
                    id: 'fs-open',
                    type: 'buff',
                    target: 'all-allies',
                    trigger: 'on-cast',
                    conditions: [],
                    config: {
                        type: 'buff',
                        buffName: 'Security Up III',
                        parsedEffects: {},
                        stacks: 1,
                        isStackable: false,
                        duration: 2,
                    },
                },
            ],
        },
    ],
});

const collect = (events: CombatEvent[]) => ({
    on: () => {},
    emit: (e: CombatEvent) => void events.push(e),
});

function recipientsOf(events: CombatEvent[], name: string): string[] {
    return [
        ...new Set(
            events
                .filter(
                    (e): e is Extract<CombatEvent, { type: 'buff-applied' }> =>
                        e.type === 'buff-applied' && e.buffName === name
                )
                .map((e) => e.actorId)
        ),
    ].sort();
}

/** A Fuying-shaped focus attacker casting the faction-scoped grant, with two minimal team
 *  actors — one Tianchen, one XAOC — as her allies. `rounds: 1` is enough: the ability fires
 *  on-cast every round, and round 1 is all this needs. */
const baseInput = (): DPSSimulationInput => ({
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    enemyDefense: 0,
    enemyHp: 1_000_000,
    rounds: 1,
    selfBuffs: [],
    enemyDebuffs: [],
    speed: 100,
    hp: 300_000,
    position: DEFAULT_ATTACKER_SLOT,
    shipSkills: factionScopedGrantKit(),
    faction: 'TIANCHAO',
    teamActors: [
        {
            id: 'ally-tianchao',
            speed: 90,
            chargeCount: 0,
            startCharged: false,
            selfBuffs: [],
            enemyDebuffs: [],
            faction: 'TIANCHAO',
        },
        {
            id: 'ally-xaoc',
            speed: 80,
            chargeCount: 0,
            startCharged: false,
            selfBuffs: [],
            enemyDebuffs: [],
            faction: 'XAOC',
        },
    ],
    enemyAttackers: [
        {
            id: 'enemy-1',
            stats: { attack: 0, crit: 0, critDamage: 0, speed: 1, defence: 0, hp: 1_000_000 },
            chargeCount: 0,
            startCharged: false,
            position: DEFAULT_ENEMY_SLOT,
        },
    ],
});

describe('DPS calculator faction threading (#363 follow-up)', () => {
    it('a Fuying-shaped focus actor grants a faction-scoped buff only to the Tianchen team actor', () => {
        const events: CombatEvent[] = [];
        simulateDPS({ ...baseInput(), bus: collect(events) });

        // Control: the unfiltered co-cast grant proves the cast fired and reached every ally, so
        // the scoped assertion below is not passing on a cast that never happened.
        expect(recipientsOf(events, 'Security Up III')).toEqual([
            'ally-tianchao',
            'ally-xaoc',
            'attacker',
        ]);
        // The scoped grant: the Tianchen ally and the Tianchen focus itself; never the XAOC ally.
        expect(recipientsOf(events, 'Stealth')).toEqual(['ally-tianchao', 'attacker']);
    });

    it('omitting the focus’s own faction drops it from its own scoped grant, without affecting the ally', () => {
        const events: CombatEvent[] = [];
        const { faction: _drop, ...withoutFaction } = baseInput();
        simulateDPS({ ...withoutFaction, bus: collect(events) });

        // Still reaches the Tianchen ally — its OWN faction is threaded independently via
        // `teamActors`, which was already wired before this fix.
        expect(recipientsOf(events, 'Stealth')).toContain('ally-tianchao');
        // But the focus itself is now unknown-faction and drops out of its own grant — this is
        // the regression `DPSSimulationInput.faction` (new) guards against.
        expect(recipientsOf(events, 'Stealth')).not.toContain('attacker');
    });
});
