import { describe, it, expect, beforeAll } from 'vitest';
import { buildInertAllyBaseline, buildStandardScenario } from '../traceScenario';
import { buildTraceShip } from '../traceShipFactory';
import { loadShipSkillRecords, csvAvailable } from '../shipSkillCsv';
import { loadShipDataByName, shipDataAvailable } from '../shipDataSnapshot';
import { tagShip } from '../../../src/utils/combat/audit/classes';
import { composeBattle, type TaggedShip } from '../../../src/utils/combat/audit/compose';
import { runSeededBattle } from '../../../src/utils/simulator/seededRuns';
import { runDifferential } from '../../../src/utils/combat/audit/fingerprint';
import { buildShipAbilities } from '../../../src/utils/abilities/buildShipAbilities';
import type {
    BattleResult,
    BattleSimulationInput,
} from '../../../src/utils/calculators/battleSimulator';
import type { AbilityConfig } from '../../../src/types/abilities';
import type { Position } from '../../../src/types/encounters';
import type { Ship } from '../../../src/types/ship';
import type { FingerprintDiff } from '../../../src/utils/combat/audit/types';

/**
 * FINDING-003 regression — the concrete case that moved the differential oracle off the canned
 * `buildStandardScenario` baseline.
 *
 * `scripts/auditInteractions.ts` reported a Makoli differential (originally at seed 335) whose OWN ddmin
 * reduced the composition to `player:[Makoli] / enemy:[Nuqtu]` — a single player ship, i.e. ZERO
 * allies, so the "ally interference" the oracle claims to detect was impossible by construction.
 * It was opponent variance leaking in: the canned baseline fought three synthetic fillers at
 * security 20 while the composition fought a real corpus ship.
 *
 * Both arms are asserted, deliberately. Asserting only the collapse would pass just as happily if
 * the seed stopped producing a Makoli, if the corpus drifted, or if the differential returned null
 * for some unrelated reason — the vacuous-but-green failure mode this repo keeps paying for. The
 * corpus DID drift (2026-08-22, 148 -> 149 ships) and this guard duly fired; the fix was to derive
 * the anchor seed rather than to weaken the assertion. See anchorSeed below. The
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

let corpusCache: TaggedShip[] | null = null;
function buildTaggedCorpus(): TaggedShip[] {
    if (corpusCache) return corpusCache;
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
    corpusCache = tagged;
    return tagged;
}

const inertPoolFrom = (tagged: TaggedShip[]): Ship[] =>
    tagged.filter((t) => t.classes.size === 0).map((t) => t.ship);

/**
 * The subject the finding was filed against. The SHIP is the load-bearing part, not the seed: the
 * canned arm's `cleanse` differential is Makoli's own cleanse firing in the canned baseline, where
 * `buildStandardScenario`'s debuffer filler always hands it something to remove. A re-anchor onto
 * a ship that does not cleanse would silently stop testing the reported case.
 */
const SUBJECT = 'Makoli';

/** The `AbilityConfig` variants that place a status on an ENEMY. Every other variant deals damage,
 *  acts on its own side, or only modifies a status already on the board, so it cannot by itself put
 *  anything on the subject. `tagShip`'s interaction classes cannot express this — there is no
 *  plain-debuff class, so a ship carrying `debuff` abilities can wear any tag set or none — which
 *  is why this reads the parsed kit that `tagShip` itself consumes. */
const ENEMY_STATUS_CONFIGS = new Set<AbilityConfig['type']>(['debuff', 'control', 'dot']);

/** True when `ship` can put a status on its enemy. A deliberate SUPERSET of what a cleanse removes
 *  — DoTs live in their own store, not the timed/accumulating ones `cleanse` gathers from — so
 *  screening an opponent out on this can only make a seed search stricter, never admit one that
 *  leaves the subject a debuff to cleanse. */
function appliesEnemyStatus(ship: Ship): boolean {
    return buildShipAbilities(ship).slots.some((slot) =>
        slot.abilities.some((a) => ENEMY_STATUS_CONFIGS.has(a.config.type))
    );
}

/**
 * The anchor seed is DERIVED, never pinned (#364). A pinned seed is good for exactly one corpus:
 * every ship added reshuffles `composeBattle`'s seeded draw, so the seed that composed this case
 * composes an unrelated battle instead, the `beforeAll` assertion throws, and all five tests in
 * this file report SKIPPED rather than red — a regression left with nothing running.
 *
 * The search returns the first seed whose composition carries all three properties the case needs.
 * Each is load-bearing:
 *   - playerTeam[0] is the SUBJECT, so the arms compare the ship the finding was filed against;
 *   - the composition has MORE than one player ship, which the actor-id test below needs;
 *   - enemyTeam[0] — the only opponent the minimized repro keeps — places NOTHING on the subject.
 *     The canned baseline hands the subject a debuff to remove on every run: its `enemyDebuffer`
 *     filler carries hacking 260, above every corpus ship's security, so its Defense Down II
 *     always lands. `cleanse` is therefore in the subject's canned fingerprint either way, and it
 *     survives into the DIFFERENTIAL only while the composition arm has nothing to cleanse. An
 *     opponent that debuffs the subject makes it cleanse in both arms and the token cancels out.
 * The minimized repro then keeps playerTeam[0] alone, which is what makes ally interference
 * impossible by construction.
 */
let cachedSeed: number | null = null;
const SEED_SEARCH_LIMIT = 5000;
function anchorSeed(): number {
    if (cachedSeed !== null) return cachedSeed;
    const tagged = buildTaggedCorpus();
    for (let seed = 1; seed <= SEED_SEARCH_LIMIT; seed++) {
        const c = composeBattle(seed, tagged);
        const opponent = c.enemyTeam[0]?.ship;
        if (
            c.playerTeam[0]?.ship.name === SUBJECT &&
            c.playerTeam.length > 1 &&
            opponent &&
            !appliesEnemyStatus(opponent)
        ) {
            cachedSeed = seed;
            return seed;
        }
    }
    throw new Error(
        `no seed in 1..${SEED_SEARCH_LIMIT} composes ${SUBJECT} at playerTeam[0], with allies, ` +
            `against an enemyTeam[0] that applies no status of its own — the corpus may no longer ` +
            `contain ${SUBJECT}, in which case this regression needs a new subject that CLEANSES ` +
            `(see SUBJECT above), not a wider search`
    );
}

function actorIdAt(result: BattleResult, side: 'player' | 'enemy', position: Position): string {
    const entry = result.roster.find((r) => r.side === side && r.position === position);
    if (!entry) throw new Error(`no ${side}@${position} in the roster`);
    return entry.actorId;
}

/** The oracle's arm under the CANNED baseline (the original behaviour). */
function cannedArmDiff(
    compInput: BattleSimulationInput,
    subjectIndex: number,
    compResult: BattleResult
): FingerprintDiff | null {
    const placement = compInput.playerTeam[subjectIndex];
    const soloResult = runSeededBattle(buildStandardScenario(placement.ship), anchorSeed());
    return runDifferential(
        soloResult,
        compResult,
        placement.ship.name,
        actorIdAt(soloResult, 'player', 'M4'),
        actorIdAt(compResult, 'player', placement.position)
    );
}

/** The oracle's arm under the INERT-ALLY baseline (the current behaviour). */
function inertArmDiff(
    compInput: BattleSimulationInput,
    subjectIndex: number,
    compResult: BattleResult,
    pool: readonly Ship[]
): FingerprintDiff | null {
    const placement = compInput.playerTeam[subjectIndex];
    const baseline = buildInertAllyBaseline(
        compInput.playerTeam,
        subjectIndex,
        compInput.enemyTeam,
        pool,
        anchorSeed(),
        compInput.rounds
    );
    const baselineResult = runSeededBattle(baseline, anchorSeed());
    return runDifferential(
        baselineResult,
        compResult,
        placement.ship.name,
        actorIdAt(baselineResult, 'player', placement.position),
        actorIdAt(compResult, 'player', placement.position)
    );
}

describe('differential baseline — FINDING-003 (Makoli, derived anchor seed)', () => {
    let minimized: BattleSimulationInput;
    let pool: Ship[];

    beforeAll(() => {
        requireReferenceData();
        // The ddmin'd repro, rebuilt from the fuzz composition it came from rather than
        // hand-transcribed: the minimizer kept playerTeam[0] and enemyTeam[0] and dropped the
        // rest. The OPPONENT is whatever the derived seed composes, and it IS load-bearing — the
        // canned arm reports a `cleanse` differential only while that opponent leaves the subject
        // nothing to cleanse, which is the property anchorSeed() screens for. It is a REAL corpus
        // ship, which is what made the canned baseline (three synthetic fillers at security 20)
        // differ in the first place.
        const tagged = buildTaggedCorpus();
        pool = inertPoolFrom(tagged);
        const compInput = composeBattle(anchorSeed(), tagged);
        expect(compInput.playerTeam[0].ship.name).toBe(SUBJECT);
        expect(compInput.enemyTeam[0]?.ship.name).toBeTruthy();
        minimized = {
            playerTeam: [compInput.playerTeam[0]],
            enemyTeam: [compInput.enemyTeam[0]],
            rounds: compInput.rounds,
        };
    });

    it('has no allies at all, so ally interference is impossible by construction', () => {
        expect(minimized.playerTeam).toHaveLength(1);
    });

    it('the CANNED baseline still reports a differential here (the case is live)', () => {
        const compResult = runSeededBattle(minimized, anchorSeed());
        const diff = cannedArmDiff(minimized, 0, compResult);
        expect(diff).not.toBeNull();
        expect([...diff!.missingInComposition, ...diff!.extraInComposition]).toContain('cleanse');
    });

    it('the INERT-ALLY baseline collapses it to no diff at all', () => {
        const compResult = runSeededBattle(minimized, anchorSeed());
        expect(inertArmDiff(minimized, 0, compResult, pool)).toBeNull();
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
        const baseline = buildInertAllyBaseline(solo.playerTeam, 0, solo.enemyTeam, pool, 336);
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

    // The property the baseline design turns on, checked end-to-end rather than argued: on a real
    // multi-ship composition the subject must mint the SAME actor id in both arms. If it did not,
    // the ownerId-keyed rate-gate RNG would re-draw every crit and landing roll between the arms
    // and the oracle would be comparing two different dice, not two different ally sets.
    it('gives the subject the same actor id in both arms, at every player index', () => {
        const compInput = composeBattle(anchorSeed(), buildTaggedCorpus());
        expect(compInput.playerTeam.length).toBeGreaterThan(1);
        const compResult = runSeededBattle(compInput, anchorSeed());
        for (let idx = 0; idx < compInput.playerTeam.length; idx++) {
            const placement = compInput.playerTeam[idx];
            const baseline = buildInertAllyBaseline(
                compInput.playerTeam,
                idx,
                compInput.enemyTeam,
                pool,
                anchorSeed(),
                compInput.rounds
            );
            const baselineResult = runSeededBattle(baseline, anchorSeed());
            expect(actorIdAt(baselineResult, 'player', placement.position)).toBe(
                actorIdAt(compResult, 'player', placement.position)
            );
        }
    });
});
