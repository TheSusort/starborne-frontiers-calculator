/**
 * SP-4d — the engine-level pin. A support ship's payload gated on a question about "the enemy"
 * does not fire on a turn that resolved no victim.
 *
 * THE GAME CASE: Hermes repairs an ally with a real enemy on the board. Give it Cobalt's real
 * clause shape — "If this Unit has more HP than the enemy" — attached to a self-shield. Before this
 * rung the enemy's HP read 0 on that turn, so 20,000 > 0 and the shield landed: a bonus whose own
 * text requires out-HPing an enemy, granted in a turn that had no enemy in it. The consumer
 * (`gateFiringAbilities`) is deliberately unfenced so the repair itself can land, so nothing else
 * suppresses it.
 *
 * Synthetic on purpose: no shipped kit can build this shape (none of the 24 ally-target ships
 * carries a phantom-satisfiable gate — spec §6), which is why the residual was tripwired rather
 * than red. Each case has a NEGATIVE half so it cannot pass by blocking everything.
 *
 * DISCHARGES, Task 7: two of `noVictimResidualTripwires.test.ts`'s three SP-4c-2b corpus-scan
 * cases are retired here as direct engine-level assertions — case (a) (enemy hp-threshold ABOVE)
 * by "an enemy hp-threshold ABOVE gate does not grant the shield against nobody" and its
 * drain-time sibling below, and case (c) (stat-vs-target GT) by "Cobalt's HP-vs-target clause does
 * not grant the shield against nobody" below. Case (b) (enemies-hit-this-cast) is NOT discharged
 * by this file — it was closed later, by SP-4d Task 8's honest 0-vs-1 footprint fix; see
 * `noVictimResidualTripwires.test.ts`'s header for where it is discharged.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { setupKeyedTestRng } from '../../calculators/rateAccumulator';
import { bareInput, bareAlly, bareEnemy, BARE_ALLY_ID } from '../__testutils__/bareRosterFixture';
import type { Condition, ShipSkills } from '../../../types/abilities';

const HURT_PCT = 0.4;

/** A Hermes-shaped repair, plus one self-shield carrying the gate under test. */
const repairKitWithGatedShield = (gate: Condition): ShipSkills =>
    ({
        slots: [
            {
                slot: 'active',
                abilities: [
                    {
                        id: 'repair1',
                        type: 'heal',
                        target: 'all-allies',
                        trigger: 'on-cast',
                        conditions: [],
                        config: { type: 'heal', pct: 27, basis: 'hp' },
                    },
                    {
                        id: 'gatedShield',
                        type: 'shield',
                        target: 'self',
                        trigger: 'on-cast',
                        conditions: [gate],
                        config: { type: 'shield', pct: 50, basis: 'hp' },
                    },
                ],
            },
        ],
    }) as ShipSkills;

const supportRun = (gate: Condition) => {
    const bus = createEventBus();
    const shieldsOnFocus: number[] = [];
    const allyRepairs: number[] = [];
    bus.on('shield-applied', (e: Extract<CombatEvent, { type: 'shield-applied' }>) => {
        const forFocus = e.perTarget?.find((t) => t.targetId === 'attacker');
        if (forFocus && forFocus.amount > 0) shieldsOnFocus.push(forFocus.amount);
    });
    bus.on('heal-performed', (e: Extract<CombatEvent, { type: 'heal-performed' }>) => {
        const forAlly = e.perTarget?.find((t) => t.targetId === BARE_ALLY_ID);
        if (forAlly && forAlly.amount > 0) allyRepairs.push(forAlly.amount);
    });
    runCombat({
        ...bareInput(),
        mode: 'battle',
        position: 'M4',
        target: { raw: 'ally-team', side: 'ally', selection: 'team' },
        pattern: { raw: 'base', shape: 'base', range: 0, modifiers: {} },
        shipSkills: repairKitWithGatedShield(gate),
        teamActors: [bareAlly()],
        enemyAttackers: bareEnemy({ stats: { hp: 10_000_000 } }),
        bus,
        __testTapActors: (actors) => {
            const ally = actors.find((a) => a.id === BARE_ALLY_ID);
            if (ally) ally.currentHp = ally.stats.hp * HURT_PCT;
        },
    });
    return { shieldsOnFocus, allyRepairs };
};

// Do NOT call resetRateGateRng() after setupKeyedTestRng() — reset un-seeds the test.
describe('SP-4d: a no-victim turn resolves no enemy-derived gate', () => {
    beforeEach(() => setupKeyedTestRng(12345));

    it("Cobalt's HP-vs-target clause does not grant the shield against nobody", () => {
        const { shieldsOnFocus, allyRepairs } = supportRun({
            subject: 'stat-vs-target',
            compareStat: 'hp',
            statComparator: 'gt',
            derivable: true,
        } as Condition);
        expect(shieldsOnFocus).toEqual([]);
        // The negative half, and the reason this is not a "block everything" test: the repair the
        // whole no-victim path exists to deliver must still land.
        expect(allyRepairs.length).toBeGreaterThan(0);
    });

    it('an enemy hp-threshold ABOVE gate does not grant the shield against nobody', () => {
        const { shieldsOnFocus, allyRepairs } = supportRun({
            subject: 'hp-threshold',
            hpComparator: 'above',
            hpPercent: 50,
            derivable: true,
        } as Condition);
        expect(shieldsOnFocus).toEqual([]);
        expect(allyRepairs.length).toBeGreaterThan(0);
    });

    it('an UNGATED shield on the same cast still lands — the turn is not being suppressed', () => {
        const { shieldsOnFocus } = supportRun({ subject: 'always', derivable: true } as Condition);
        expect(shieldsOnFocus.length).toBeGreaterThan(0);
    });

    it('a REACTIVE payload gated on an enemy hp-threshold ABOVE does not fire at drain time', () => {
        // The drain context's enemy-HP reading was a fight-wide scalar
        // (`100 * (1 - cumulativeDamage / enemyHp)`) which — because positional credit books
        // per-victim and never feeds `cumulativeDamage` — sat at exactly 100 on every positional
        // run, i.e. on every run there is. A `below` gate read false there (dead but fail-closed);
        // an `above` gate read TRUE against a number describing no actor on the board.
        //
        // Trigger note: the brief's original 'on-repair' is not a modelled AbilityTrigger (see
        // src/types/abilities.ts's AbilityTrigger union). Uses 'end-of-turn' instead — it fires at
        // the OWNER's own turn-end (rides `turn-ended`, self-scoped on actorId === ownerId) and is
        // drained through the SAME reactive queue/executeIntent/buildDrainContext path as every
        // other reactive trigger, which is what this case needs to exercise. Reachability was
        // verified directly: with this same shape but `conditions: []` (ungated), the shield lands
        // (shieldsOnFocus non-empty) — proving the trigger fires and reaches the drain gate at all,
        // not just that the gated version happens to produce an empty array.
        const bus = createEventBus();
        const shieldsOnFocus: number[] = [];
        bus.on('shield-applied', (e: Extract<CombatEvent, { type: 'shield-applied' }>) => {
            const forFocus = e.perTarget?.find((t) => t.targetId === 'attacker');
            if (forFocus && forFocus.amount > 0) shieldsOnFocus.push(forFocus.amount);
        });
        runCombat({
            ...bareInput(),
            mode: 'battle',
            position: 'M4',
            target: { raw: 'ally-team', side: 'ally', selection: 'team' },
            pattern: { raw: 'base', shape: 'base', range: 0, modifiers: {} },
            shipSkills: {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            {
                                id: 'repair1',
                                type: 'heal',
                                target: 'all-allies',
                                trigger: 'on-cast',
                                conditions: [],
                                config: { type: 'heal', pct: 27, basis: 'hp' },
                            },
                        ],
                    },
                    {
                        slot: 'passive',
                        abilities: [
                            {
                                id: 'reactiveShield',
                                type: 'shield',
                                target: 'self',
                                trigger: 'end-of-turn',
                                conditions: [
                                    {
                                        subject: 'hp-threshold',
                                        hpComparator: 'above',
                                        hpPercent: 50,
                                        derivable: true,
                                    },
                                ],
                                config: { type: 'shield', pct: 50, basis: 'hp' },
                            },
                        ],
                    },
                ],
            } as ShipSkills,
            teamActors: [bareAlly()],
            enemyAttackers: bareEnemy({ stats: { hp: 10_000_000 } }),
            bus,
            __testTapActors: (actors) => {
                const ally = actors.find((a) => a.id === BARE_ALLY_ID);
                if (ally) ally.currentHp = ally.stats.hp * HURT_PCT;
            },
        });
        expect(shieldsOnFocus).toEqual([]);
    });
});
