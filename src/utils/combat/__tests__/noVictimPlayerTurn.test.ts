/**
 * SP-4c-2b — a player ship casting on an ALLY keeps taking its turn.
 *
 * THE GAME CASE: Hermes ("repairs 27% of its Max HP", `activeTarget: allies`) acts with three
 * enemies on the board. Its cast aims at an ally, so no enemy victim resolves. Before this rung the
 * engine handed Hermes the invisible dummy `enemy` as its victim; after it, Hermes faces NOTHING.
 * Either way the repair must land and the turn must happen.
 *
 * This file is the rung's safety net, and it is deliberately written to pass BOTH before and after.
 * 24 of 148 shipped ships have an ally-side active target (every healer/shielder/buffer), so a
 * regression here silences the whole support half of the game — the same shape as the
 * `twoTeamBattle` "enemy supporter turn skipped after the focus player dies" repro.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { setupKeyedTestRng } from '../../calculators/rateAccumulator';
import { bareInput, bareAlly, bareEnemy, BARE_ALLY_ID } from '../__testutils__/bareRosterFixture';
import type { ShipSkills } from '../../../types/abilities';

/** A Hermes-shaped kit: repair only, aimed at allies. No enemy-facing clause — which is what all
 *  24 shipped ally-target ships look like (plan §A.2). */
const repairKit = (): ShipSkills => ({
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
    ],
});

/** The focus starts the fight at full HP and so does the ally, and a repair on a full-HP ally is
 *  an OVERHEAL that may log nothing at all — the same trap `kitFingerprintScenarios`' 'wounded'
 *  seeding exists to avoid. Seed the ally hurt so the repair has somewhere to go. */
const HURT_PCT = 0.4;

const supportRun = () => {
    const bus = createEventBus();
    const focusTurns: number[] = [];
    const allyRepairs: Array<{ amount: number }> = [];
    bus.on('turn-started', (e: Extract<CombatEvent, { type: 'turn-started' }>) => {
        if (e.actorId === 'attacker') focusTurns.push(e.round);
    });
    // `hp-changed` does NOT carry heal evidence — its three emission sites (engine.ts:5030,
    // :5306, :10914) are all on the INCOMING-damage-intake path (tank-side hit resolution and
    // the vestigial dummy sink), never on the outgoing heal-apply path. The event that actually
    // reports a cast's repair landing is `heal-performed` (events.ts:186), whose `perTarget`
    // breakdown is "always populated by the engine" — read that instead of the totals-only
    // `amount`/`targets` fields so this only counts a repair that reached the ally specifically.
    bus.on('heal-performed', (e: Extract<CombatEvent, { type: 'heal-performed' }>) => {
        const forAlly = e.perTarget?.find((t) => t.targetId === BARE_ALLY_ID);
        if (forAlly && forAlly.amount > 0) {
            allyRepairs.push({ amount: forAlly.amount });
        }
    });
    runCombat({
        ...bareInput(),
        // The healing pipeline is gated on `runMode === 'battle'` (`healTarget` stays undefined,
        // and the whole heal block is unreachable, under the default 'dps' mode — engine.ts:2468/
        // 2483). Every other heal-exercising fixture in this suite sets this too (e.g.
        // exposedStatus.integration.test.ts, deadVictimSkipsItsDotTick.integration.test.ts).
        mode: 'battle',
        position: 'M4',
        // The ally-side target is what makes the opposing selection resolve nobody. The
        // normalization boundary FILLS an absent target but never SUBSTITUTES an ally-side one
        // (`normalizeRoster.ts:79-81`), so this shape reaches the engine unrewritten.
        target: { raw: 'ally-team', side: 'ally', selection: 'team' },
        pattern: { raw: 'base', shape: 'base', range: 0, modifiers: {} },
        shipSkills: repairKit(),
        teamActors: [bareAlly()],
        enemyAttackers: bareEnemy({ stats: { hp: 10_000_000 } }),
        bus,
        __testTapActors: (actors) => {
            const ally = actors.find((a) => a.id === BARE_ALLY_ID);
            if (ally) ally.currentHp = ally.stats.hp * HURT_PCT;
        },
    });
    return { focusTurns, allyRepairs };
};

// NOTE: do NOT call resetRateGateRng() after setupKeyedTestRng() — reset nulls the keyed
// provider and restores Math.random, un-seeding the test (rateAccumulator.ts:26-29,
// rateGateSeedingOrder.test.ts). setupKeyedTestRng alone seeds both streams.
describe('SP-4c-2b: an ally-targeted player cast still acts', () => {
    beforeEach(() => {
        setupKeyedTestRng(12345);
    });

    it('the support ship takes its turn every round', () => {
        const { focusTurns } = supportRun();
        // bareInput().numRounds === 2. A skip (the shape the spec's literal wording would have
        // produced) reads 0 here — which is the exact failure this file exists to catch.
        expect(focusTurns).toHaveLength(2);
    });

    it('the repair actually lands on the ally', () => {
        const { allyRepairs } = supportRun();
        expect(allyRepairs.length).toBeGreaterThan(0);
    });
});
