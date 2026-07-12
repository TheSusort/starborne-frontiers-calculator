// Locality invariant: increasing ONE actor's draw count must not change ANOTHER actor's outcomes.
// Construct a tiny 1v2 battle where actor E2 acts independently of E1; give E1 an extra
// proc-gated draw each turn (gameplay-inert to E2). Under keyed streams E2's per-round
// damageDealt is identical with/without E1's extra draw.
//
// The two `simulateBattle` calls are re-seeded to the SAME starting keyed-stream state
// (`setupKeyedTestRng(SEED)` before each) rather than left to run back-to-back off one
// continuing provider. Per-key streams are lazily created and never reset between two calls
// sharing one provider instance, so without re-seeding, E2's second-call draws would be items
// 4-6 of its stream instead of a fresh 1-3 — any match would be coincidental (a fluke of where
// the crit threshold happens to fall), not a real proof that E1's extra draw never reaches E2.
// Re-seeding pins both runs to the identical starting position for every key, so a genuine
// divergence in E2's outcome could only come from E1's perturbation leaking across streams.
//
// `ShipRoundState` (the per-round `ships[]` entries) carries only `actorId`, NOT a `name` —
// `name` lives on the top-level `BattleResult.roster` instead. So E2's actorId is resolved via
// the roster (by name 'E2') once per result, then used to look up its row in each round.
import { describe, it, expect } from 'vitest';
import { simulateBattle } from '../../calculators/battleSimulator';
import { setupKeyedTestRng } from '../../calculators/rateAccumulator';
import { baseLocalityInput, withExtraE1Draw } from './__fixtures__/rngLocalityFixture';

// Any fixed seed works — the point is that both calls below start from the SAME one.
const LOCALITY_TEST_SEED = 0x5eed1234;

describe('RNG stream locality', () => {
    it("perturbing E1's draw count leaves E2's per-round damage unchanged", () => {
        setupKeyedTestRng(LOCALITY_TEST_SEED);
        const a = simulateBattle(baseLocalityInput());

        setupKeyedTestRng(LOCALITY_TEST_SEED);
        const b = simulateBattle(withExtraE1Draw());

        const e2 = (r: ReturnType<typeof simulateBattle>) => {
            const e2ActorId = r.roster.find((entry) => entry.name === 'E2')?.actorId;
            if (!e2ActorId) throw new Error("no roster entry named 'E2'");
            return r.rounds.map(
                (rd) => rd.ships.find((s) => s.actorId === e2ActorId)?.damageDealt ?? 0
            );
        };
        expect(e2(b)).toEqual(e2(a));
    });
});
