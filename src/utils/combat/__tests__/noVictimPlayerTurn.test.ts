/**
 * SP-4c-2b — a player ship casting on an ALLY keeps taking its turn.
 *
 * THE GAME CASE: Hermes ("repairs 27% of its Max HP", `activeTarget: allies`) acts with three
 * enemies on the board. Its cast aims at an ally, so no enemy victim resolves. Before this rung the
 * engine handed Hermes the invisible dummy `enemy` as its victim; after it, Hermes faces NOTHING.
 * Either way the repair must land and the turn must happen.
 *
 * This file is the rung's safety net, and the first two cases are deliberately written to pass BOTH
 * before and after. 24 of 148 shipped ships have an ally-side active target (every
 * healer/shielder/buffer), so a regression there silences the whole support half of the game — the
 * same shape as the `twoTeamBattle` "enemy supporter turn skipped after the focus player dies" repro.
 *
 * BUT a net is not a pin, and this file carries the rung's headline. "Passes before and after" means
 * that if a future change routed the ghost BACK to the player side, the two cases above would stay
 * green: the turn would still happen and the repair would still land — off a phantom victim again.
 * So the third case pins the thing the rung is actually named for: that the turn had NO VICTIM.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runCombat, __getNoVictimTurnCount, __resetNoVictimTurnCount } from '../engine';
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

/**
 * The same repair kit plus ONE control ability, whose target side is the knob. Used by the
 * `control-applied` cases: an ENEMY-targeted control on an ally-targeted cast has nobody to control,
 * a SELF-targeted one (Taunt's shape) is unaffected by the absence of an enemy.
 */
const repairKitWithControl = (controlTarget: 'enemy' | 'self'): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                ...repairKit().slots[0].abilities,
                {
                    id: 'ctrl1',
                    type: 'control',
                    target: controlTarget,
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'control', effect: 'stasis' },
                },
            ],
        },
    ],
});

/** The focus starts the fight at full HP and so does the ally, and a repair on a full-HP ally is
 *  an OVERHEAL that may log nothing at all — the same trap `kitFingerprintScenarios`' 'wounded'
 *  seeding exists to avoid. Seed the ally hurt so the repair has somewhere to go. */
const HURT_PCT = 0.4;

const supportRun = (skills: ShipSkills = repairKit()) => {
    const bus = createEventBus();
    const focusTurns: number[] = [];
    const allyRepairs: Array<{ amount: number }> = [];
    const controlsApplied: string[] = [];
    bus.on('control-applied', (e: Extract<CombatEvent, { type: 'control-applied' }>) => {
        if (e.casterId === 'attacker') controlsApplied.push(e.effect);
    });
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
        shipSkills: skills,
        teamActors: [bareAlly()],
        enemyAttackers: bareEnemy({ stats: { hp: 10_000_000 } }),
        bus,
        __testTapActors: (actors) => {
            const ally = actors.find((a) => a.id === BARE_ALLY_ID);
            if (ally) ally.currentHp = ally.stats.hp * HURT_PCT;
        },
    });
    return { focusTurns, allyRepairs, controlsApplied };
};

// NOTE: do NOT call resetRateGateRng() after setupKeyedTestRng() — reset nulls the keyed
// provider and restores Math.random, un-seeding the test (rateAccumulator.ts:26-29,
// rateGateSeedingOrder.test.ts). setupKeyedTestRng alone seeds both streams.
describe('SP-4c-2b: an ally-targeted player cast still acts', () => {
    beforeEach(() => {
        setupKeyedTestRng(12345);
        // Module-level, so it needs a per-case reset (same contract as the sibling counters in
        // `dummyReachability.test.ts`).
        __resetNoVictimTurnCount();
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

    it('an ENEMY-targeted control on this cast announces NOTHING — nobody was controlled', () => {
        // Final-review IMPORTANT 2. This was the one application emit left unfenced, and it did not
        // merely survive the rung — it got WORSE. On a no-victim turn nothing downstream can suppress
        // it: `targetImmuneToDebuffs` is fenced to false, and `resistedEnemyDebuffNames` only carries
        // ability-sourced names from a loop that is itself victim-fenced. The ghost path at least
        // suppressed the event whenever the paired named status lost its landing roll, so the rung
        // turned a PROBABILISTIC phantom into an ALWAYS-ON one — and `control-applied` is not inert,
        // it wakes `on-stasis-applied` reactions.
        //
        // This case exists because the fence has NO OTHER COVERAGE: probed over the whole suite, the
        // guard fires 0 times (no shipped ship carries this shape — §A.2 — and none of the 13 §A.7
        // fixture rows observes it). A guard with zero coverage is exactly the class this branch keeps
        // catching, so it gets a fixture of its own rather than a promise.
        const { controlsApplied } = supportRun(repairKitWithControl('enemy'));
        expect(controlsApplied).toEqual([]);
    });

    it('...but a SELF-targeted control still does, because it never needed an enemy', () => {
        // The other half of the fence, and why it is scoped `ctrl.target === 'enemy'` rather than
        // applied to the whole loop. Taunt's shape is self-targeted: the absence of an opposing victim
        // says nothing about it, so it must keep emitting. Without this case a future "simplification"
        // that dropped the target check would silence it and stay green.
        const { controlsApplied } = supportRun(repairKitWithControl('self'));
        expect(controlsApplied).toEqual(['stasis', 'stasis']);
    });

    it('THE PIN: the turn really had no victim — it did not quietly fall back to the ghost', () => {
        // What the two cases above CANNOT distinguish, and the rung's whole subject. Both stay green
        // if a future change hands the dummy back to the player side: the turn still happens and the
        // repair still lands, but every enemy-derived read is a phantom's stats again. This reads the
        // discriminator directly.
        //
        // ONE PER ROUND — `bareInput().numRounds === 2`, and the focus takes exactly one ally-targeted
        // turn in each. The walked ally does NOT contribute (its kit is empty, so no cast resolves a
        // target at all) and neither does the roster member (it is enemy-side; the boundary gives it
        // the enemy-side front default, which resolves against the targetable focus).
        //
        // SP-4e renamed this counter from `noVictimPlayerTurnCount`: it now counts no-victim turns on
        // BOTH sides, since the enemy side's fallback victim is gone too. The enumeration above is
        // what keeps the expected value at 2 rather than 2-plus-the-enemy's — that enemy resolves a
        // real victim, so a 3 here would mean the enemy side lost a resolution it used to have.
        //
        // Deliberately `toBe`, not `toBeGreaterThan(0)`: a count that drifted upward would mean turns
        // are resolving no victim that used to resolve one, which is as much a regression as the ghost
        // coming back.
        supportRun();
        expect(__getNoVictimTurnCount()).toBe(2);
    });
});
