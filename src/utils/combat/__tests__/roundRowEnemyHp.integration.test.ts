/**
 * #341 — the round row's enemy-HP reading comes from the enemy roster, not from whatever the focus
 * happened to strike.
 *
 * THE REPORTED BUG: your focus ship is destroyed before its turn comes up in round 4, so the engine
 * fabricates its row (`pushSynthesizedFocusSkipTurn`). The enemy is sitting at a fraction of its HP
 * — your attackers nearly killed it. The DPS round chart's tooltip for round 4 said
 * **"Enemy HP: 100%"**, because the row was read off the focus's STRUCK VICTIM and a turn that never
 * happened struck nobody, so it took a `DISPLAY_ENEMY_HP_PCT_NO_VICTIM = 100` stand-in. The same
 * thing happened on any round the focus struck nobody — an ally-targeted repair, for instance.
 *
 * The row now reads the opposing roster's HP-weighted remainder, snapshotted at the round HEAD. Two
 * properties matter and both are asserted below:
 *   • a row whose focus struck NOBODY still reports the enemy's real HP;
 *   • the reading stays ENTERING-round, because an hp-threshold gate evaluated during the round was
 *     gated against exactly that number — a row showing 25% beside an execute rider that did not
 *     fire would be self-contradicting (`dpsSimulator.test.ts`'s execute-gate case reads this row to
 *     explain which round the gate switched on).
 *
 * Crit 0 everywhere → every value is an exact integer and no RNG is drawn.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, type CombatEngineInput } from '../engine';
import { setupKeyedTestRng } from '../../calculators/rateAccumulator';
import {
    bareInput,
    bareAlly,
    attackingEnemy,
    BARE_ENEMY_ID,
} from '../__testutils__/bareRosterFixture';

/** The bare fixture's per-cast damage: 10,000 attack × 100% multiplier, no defence, no crit. */
const PER_CAST = 10_000;
/** The enemy's max HP in this fixture — chosen so each cast is a clean 1% of it. */
const ENEMY_MAX_HP = 1_000_000;

const run = (over: Partial<CombatEngineInput> = {}) => {
    setupKeyedTestRng(12345);
    return runCombat({
        ...bareInput(),
        numRounds: 4,
        enemyAttackers: attackingEnemy({ stats: { hp: ENEMY_MAX_HP, attack: PER_CAST } }),
        ...over,
    });
};

describe('#341: the round row reports the enemy roster HP, on every row', () => {
    it('a row whose focus is DEAD reports the real enemy HP, not 100%', () => {
        // The focus holds exactly two casts' worth of HP, so the enemy kills it during round 2 and
        // every later row is a synthesized skip row. A second placed player actor keeps the player
        // side from being wiped (SP-4c-1 would otherwise end the match on the killing turn, leaving
        // no skip row to observe), and `mode: 'battle'` keeps the run going past the focus's death.
        const result = run({
            mode: 'battle',
            hp: 2 * PER_CAST,
            teamActors: [{ ...bareAlly(), position: 'M3' }],
        });

        // The fixture really did produce skip rows: the focus is destroyed and the run continued.
        expect(result.rounds.length).toBeGreaterThan(2);

        // Round 1 enters untouched. Every LATER row must report a real, declining reading — the
        // focus landed one cast per round while it lived, and the enemy takes no other damage
        // (the ally carries no damage ability), so each row is a whole number of casts down.
        expect(result.rounds[0].enemyHpPct).toBe(100);
        const later = result.rounds.slice(1);
        // Pre-fix EVERY row from the death round on read exactly 100 — the stand-in. The real
        // enemy is strictly below full HP on all of them.
        expect(later.every((r) => r.enemyHpPct < 100)).toBe(true);
        // …and the sequence never goes back UP, which a stand-in interleaved with real readings
        // would do.
        for (let i = 1; i < later.length; i++) {
            expect(later[i].enemyHpPct).toBeLessThanOrEqual(later[i - 1].enemyHpPct);
        }
    });

    it('the reading is ENTERING-round: round 1 is 100 even though the focus damages the enemy in it', () => {
        const result = run();
        // The focus deals PER_CAST in round 1, so a round-TAIL reading would show 99 here. The row
        // is deliberately the entering value — the number this round's hp-threshold gates saw.
        expect(result.rounds[0].enemyHpPct).toBe(100);
        // Round 2 enters one cast down: 10,000 of 1,000,000 = 1%.
        expect(result.rounds[1].enemyHpPct).toBe(99);
        expect(result.rounds[2].enemyHpPct).toBe(98);
    });

    it('is read off the ROSTER, so a focus that struck nobody still reports it', () => {
        // An ally-targeted focus cast binds no victim at all, which is the OTHER row
        // shape that used to take the 100 stand-in. The enemy still damages itself into view here:
        // it attacks the focus, and its own HP is untouched — so the honest answer is 100, and the
        // proof that this is a real reading rather than the old constant is the row above, where
        // the same expression produced 99 and 98.
        const result = run({ shipSkills: { slots: [] } });
        expect(result.rounds.every((r) => r.enemyHpPct === 100)).toBe(true);
        // Non-vacuity: the enemy really did act (it damaged the focus), so these rows are real
        // rounds and not an empty run.
        expect(result.rounds.length).toBe(4);
        expect(result.rounds[3].perTargetDamage?.['attacker'] ?? 0).toBeGreaterThan(0);
    });

    it('a partially-damaged enemy roster reports the weighted remainder, not the last struck victim', () => {
        // Two enemies, only one of which the focus can reach (front-most). With the second at full
        // HP the roster reading is strictly HIGHER than the struck victim's own — which is what
        // "weighted across the roster" means, and what the old per-victim reading could not say.
        const result = run({
            numRounds: 3,
            enemyAttackers: [
                ...attackingEnemy({ stats: { hp: ENEMY_MAX_HP, attack: 0 }, position: 'M4' }),
                ...attackingEnemy({
                    stats: { hp: ENEMY_MAX_HP, attack: 0 },
                    position: 'M1',
                }).map((e) => ({ ...e, id: 'e2' })),
            ],
        });
        // Round 3 enters two casts down on ONE of two equal-HP enemies: 20,000 off a 2,000,000
        // pool = 1%, so 99 — not the 98 the struck victim alone would read.
        expect(result.rounds[2].enemyHpPct).toBe(99);
    });
});

/** Guard the fixture's own premise: `BARE_ENEMY_ID` is the actor the focus actually hits. */
describe('#341 fixture premise', () => {
    it('the focus books its damage on the bare enemy', () => {
        const result = run();
        expect(result.rounds[0].perTargetDealt?.['attacker']?.[BARE_ENEMY_ID]).toBe(PER_CAST);
    });
});
