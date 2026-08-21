import { describe, it, expect, beforeAll } from 'vitest';
import { buildSameEnemyBaseline, buildStandardScenario } from '../traceScenario';
import { buildTraceShip } from '../traceShipFactory';
import { loadShipSkillRecords, csvAvailable } from '../shipSkillCsv';
import { loadShipDataByName, shipDataAvailable } from '../shipDataSnapshot';
import { tagShip } from '../../../src/utils/combat/audit/classes';
import { composeBattle, type TaggedShip } from '../../../src/utils/combat/audit/compose';
import { runSeededBattle } from '../../../src/utils/combat/audit/seededBattle';
import { runDifferential } from '../../../src/utils/combat/audit/fingerprint';
import type {
    BattlePlacement,
    BattleResult,
    BattleSimulationInput,
} from '../../../src/utils/calculators/battleSimulator';
import type { Position } from '../../../src/types/encounters';
import type { FingerprintDiff } from '../../../src/utils/combat/audit/types';

/**
 * FINDING-003 regression — the concrete case that justified `buildSameEnemyBaseline`.
 *
 * `scripts/auditInteractions.ts`'s differential oracle reported a Makoli differential at seed 335
 * whose OWN ddmin reduced the composition to `player:[Makoli] / enemy:[Nuqtu]` — a single player
 * ship, i.e. ZERO allies, so the "ally interference" the oracle claims to detect was impossible by
 * construction. The finding was opponent variance leaking in through the canned
 * `buildStandardScenario` baseline (three synthetic fillers at security 20) being compared against
 * a real-corpus opponent.
 *
 * Both arms are asserted, deliberately. Asserting only the collapse would pass just as happily if
 * the seed no longer produced a Makoli, if the corpus drifted, or if the differential returned null
 * for some unrelated reason — the vacuous-but-green failure mode this repo keeps paying for. The
 * canned arm is the proof that the case is still LIVE and that the oracle can still report a diff
 * here at all.
 */

function requireReferenceData(): void {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'docs/ship-skills.csv and/or docs/ship-data.json are missing from this worktree ' +
                '(gitignored reference data) — this regression needs the real ship corpus.'
        );
    }
}

function buildTaggedCorpus(): TaggedShip[] {
    const namesByUpper = new Map<string, string>();
    for (const r of loadShipSkillRecords()) namesByUpper.set(r.name.toUpperCase(), r.name);
    for (const [upper, data] of loadShipDataByName()) {
        if (!namesByUpper.has(upper)) namesByUpper.set(upper, data.name);
    }
    const tagged: TaggedShip[] = [];
    for (const name of namesByUpper.values()) {
        const ship = buildTraceShip(name);
        if (!ship) continue;
        tagged.push({ ship, classes: tagShip(ship) });
    }
    return tagged;
}

const SEED = 335;

function actorIdAt(result: BattleResult, side: 'player' | 'enemy', position: Position): string {
    const entry = result.roster.find((r) => r.side === side && r.position === position);
    if (!entry) throw new Error(`no ${side}@${position} in the roster`);
    return entry.actorId;
}

/** The oracle's arm under the CANNED baseline (the pre-change behaviour). */
function cannedArmDiff(
    placement: BattlePlacement,
    compResult: BattleResult
): FingerprintDiff | null {
    const soloResult = runSeededBattle(buildStandardScenario(placement.ship), SEED);
    return runDifferential(
        soloResult,
        compResult,
        placement.ship.name,
        actorIdAt(soloResult, 'player', 'M4'),
        actorIdAt(compResult, 'player', placement.position)
    );
}

/** The oracle's arm under the SAME-ENEMY baseline (the post-change behaviour). */
function sameEnemyArmDiff(
    placement: BattlePlacement,
    compInput: BattleSimulationInput,
    compResult: BattleResult
): FingerprintDiff | null {
    const soloInput = buildSameEnemyBaseline(placement, compInput.enemyTeam, compInput.rounds);
    const soloResult = runSeededBattle(soloInput, SEED);
    return runDifferential(
        soloResult,
        compResult,
        placement.ship.name,
        actorIdAt(soloResult, 'player', placement.position),
        actorIdAt(compResult, 'player', placement.position)
    );
}

describe('same-enemy differential baseline — FINDING-003 (Makoli, seed 335)', () => {
    let minimized: BattleSimulationInput;
    let subject: BattlePlacement;

    beforeAll(() => {
        requireReferenceData();
        // The ddmin'd repro, rebuilt from the fuzz composition it came from rather than
        // hand-transcribed: at seed 335 the minimizer kept playerTeam[0] (Makoli) and
        // enemyTeam[0] (Nuqtu) and dropped the rest.
        const compInput = composeBattle(SEED, buildTaggedCorpus());
        expect(compInput.playerTeam[0].ship.name).toBe('Makoli');
        expect(compInput.enemyTeam[0].ship.name).toBe('Nuqtu');
        minimized = {
            playerTeam: [compInput.playerTeam[0]],
            enemyTeam: [compInput.enemyTeam[0]],
            rounds: compInput.rounds,
        };
        subject = minimized.playerTeam[0];
    });

    it('has no allies at all, so ally interference is impossible by construction', () => {
        expect(minimized.playerTeam).toHaveLength(1);
    });

    it('the CANNED baseline still reports a differential here (the case is live)', () => {
        const compResult = runSeededBattle(minimized, SEED);
        const diff = cannedArmDiff(subject, compResult);
        expect(diff).not.toBeNull();
        expect([...diff!.missingInComposition, ...diff!.extraInComposition]).toContain('cleanse');
    });

    it('the SAME-ENEMY baseline collapses it to no diff at all', () => {
        const compResult = runSeededBattle(minimized, SEED);
        expect(sameEnemyArmDiff(subject, minimized, compResult)).toBeNull();
    });

    it('reports no differential for ANY single-player-ship composition — the structural guarantee', () => {
        // Not specific to Makoli: with one player ship the baseline IS the composition, so the two
        // fingerprints are taken from byte-identical battles. Checked on a second, unrelated seed
        // so this is not just the seed-335 case restated.
        const other = composeBattle(336, buildTaggedCorpus());
        const solo: BattleSimulationInput = {
            playerTeam: [other.playerTeam[0]],
            enemyTeam: other.enemyTeam,
            rounds: other.rounds,
        };
        const soloResult = runSeededBattle(solo, 336);
        const baseline = buildSameEnemyBaseline(solo.playerTeam[0], solo.enemyTeam, solo.rounds);
        const baselineResult = runSeededBattle(baseline, 336);
        const position = solo.playerTeam[0].position;
        expect(
            runDifferential(
                baselineResult,
                soloResult,
                solo.playerTeam[0].ship.name,
                actorIdAt(baselineResult, 'player', position),
                actorIdAt(soloResult, 'player', position)
            )
        ).toBeNull();
    });
});
