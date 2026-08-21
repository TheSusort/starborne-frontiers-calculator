/**
 * #346 — THE PIN: an enemy that resolves no victim binds NOBODY.
 *
 * This is the regression class the deleted `skipDeadTargetTurn` branch grew out of. Before SP-4e
 * (#335) the enemy site fell back to `legacyVictim: healTarget` whenever positional selection
 * returned nothing, so an ally-targeted enemy supporter resolved a PLAYER SHIP as the victim of a
 * cast that never aimed at one — and anything enemy-facing on that cast landed there. The fallback
 * is gone, and the dead-target skip that existed to stop the fabricated victim from being read once
 * it died went with it (#346: its surviving precondition, a resolved victim already dead, is
 * unconstructible).
 *
 * ⚠️ WHY THIS FILE EXISTS AT ALL. #346's own issue records the coverage hole: the two
 * `twoTeamBattle` cases that used to exercise the skip were relabelled, and BOTH stay green if a
 * fabricated enemy-side fallback is reintroduced in `selectTurnTarget` — they assert an outcome
 * ("this actor delivers nothing") that either route produces, because `runPlayerTurn` fences its
 * damage assembly on `hasVictim` anyway. So the whole class rested on one test. This one fails.
 *
 * The instrument is a cast that carries BOTH halves: an ally-side repair (which must land, proving
 * the turn ran rather than being skipped) and an enemy-facing DoT (which must land NOWHERE). A
 * fabricated victim is invisible in the first half and unmistakable in the second — the DoT would
 * be applied to whichever player ship the fallback named.
 *
 * MUTATION-VERIFIED (#346): reintroducing `?? healTarget` on the null branch of `selectTurnTarget`
 * turns the DoT assertion RED (the focus receives Corrosion) while both relabelled `twoTeamBattle`
 * cases stay green — which is exactly the gap this file closes.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
    runCombat,
    __getNoVictimTurnCount,
    __resetNoVictimTurnCount,
    __getResolvedVictimTurnCounts,
    __resetResolvedVictimTurnCounts,
} from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { setupKeyedTestRng } from '../../calculators/rateAccumulator';
import { bareInput, bareEnemy, BARE_ENEMY_ID } from '../__testutils__/bareRosterFixture';
import type { ShipSkills } from '../../../types/abilities';
import { parsePattern, parseTarget } from '../../targetingParser';

/**
 * An enemy supporter's cast: repair its own side, AND inflict Corrosion on an enemy. The parsed
 * target is ALLY-side, so `resolvePositionalTarget` returns null (it never resolves through the
 * opposing list for an ally-side target) and the turn has no victim — at which point the repair
 * must still land and the Corrosion must not.
 */
const supportPlusDotKit = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'enemy-repair',
                    type: 'heal',
                    target: 'all-allies',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'heal', pct: 10, basis: 'hp' },
                },
                {
                    id: 'enemy-corrosion',
                    type: 'dot',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'dot', dotType: 'corrosion', tier: 3, duration: 3, stacks: 1 },
                },
            ],
        },
    ],
});

const run = () => {
    setupKeyedTestRng(12345);
    __resetNoVictimTurnCount();
    __resetResolvedVictimTurnCounts();
    const events: CombatEvent[] = [];
    const bus = createEventBus();
    bus.on('heal-performed', (e) => events.push(e));
    bus.on('dot-applied', (e) => events.push(e));
    bus.on('debuff-applied', (e) => events.push(e));
    runCombat({
        ...bareInput(),
        mode: 'healing',
        healTargetId: 'attacker', // the ship a fabricated fallback would have named
        hp: 5_000_000, // survives the whole run, so a late-round DoT would still be observable
        position: 'M4',
        target: parseTarget('front'),
        pattern: parsePattern('Pattern-Base'),
        enemyAttackers: bareEnemy({
            position: 'M4',
            // ALLY-side: the cast aims at the enemy's own team, so nothing resolves opposite it.
            target: parseTarget('all-allies'),
            pattern: parsePattern('Pattern-Base'),
            shipSkills: supportPlusDotKit(),
            stats: { hp: 5_000_000, hacking: 100_000 }, // never resisted — a miss must not read as a no-op
        }),
        bus,
    });
    return events;
};

describe('#346: an ally-targeted enemy cast binds no victim, so its enemy-facing half lands nowhere', () => {
    beforeEach(() => setupKeyedTestRng(12345));

    it('the repair lands on the enemy side — the turn RAN, it was not skipped', () => {
        const heals = run().filter((e) => e.type === 'heal-performed');
        // Anti-vacuity for everything below: a suppressed turn would produce this same empty
        // enemy-facing result for the wrong reason.
        expect(heals.length).toBeGreaterThan(0);
        expect(heals.every((e) => e.casterId === BARE_ENEMY_ID)).toBe(true);
    });

    it('THE PIN: the enemy-facing Corrosion reaches NO player ship', () => {
        const landed = run().filter((e) => e.type === 'dot-applied' || e.type === 'debuff-applied');
        // Pre-#335 this read one Corrosion application per round, on the heal target — a ship the
        // cast never aimed at. With a fabricated fallback reintroduced it reads that way again.
        expect(landed).toEqual([]);
    });

    it('the turn is counted as a NO-VICTIM turn, and binds nothing the tripwire can see', () => {
        run();
        // The enemy took a no-victim turn in each of the two rounds.
        expect(__getNoVictimTurnCount()).toBeGreaterThanOrEqual(2);
        // …and every turn that DID bind a victim bound a living one. The focus binds the enemy on
        // each of its two turns; the enemy binds nobody, so it contributes nothing here.
        expect(__getResolvedVictimTurnCounts()).toEqual({ resolved: 2, dead: 0 });
    });
});
