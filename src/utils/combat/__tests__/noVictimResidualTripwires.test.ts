/**
 * SP-4c-2b TRIPWIRES for the two named residuals the rung deliberately did NOT fix.
 *
 * A no-victim turn (an ally-targeted player cast, which now resolves nobody on the opposing side)
 * still answers two enemy-derived questions with a PHANTOM instead of "there is no enemy":
 *
 *   (a) `enemyHpPct` answers **100** — "a healthy enemy" — because `PlayerRoundCtx.enemyHpPct` is a
 *       required field (`playerTurn.ts` ~248) and the derivation divides a zero decline by the max
 *       HP. Byte-identical to what the dummy ghost used to report, so the rung inherits it rather
 *       than introducing it.
 *   (b) `enemiesHitThisCastByActor` books **1** for a cast that hit nobody (`engine.ts`, the focus
 *       site + its team and enemy mirrors), because `aoeVictimIds` is undefined and the site's
 *       default is `?? 1`. The honest value is 0.
 *   (c) the owner-vs-target STAT comparison reads the target at **0**, because `victimStatGateCtx`
 *       omits `targetSpeed`/`targetCurrentHp`/`targetCritPower` and `evaluateConditions`'s
 *       `stat-vs-target` arm defaults each to `?? 0`. A `gt` comparator ("more Crit Power than the
 *       target") is therefore TRUE against nobody. This one is the WEAKEST of the three: it is
 *       reachable through a deliberately unfenced consumer (`gateFiringAbilities`, which must keep
 *       gating the repair), and it rests on ONE leg — no ally-target ship carries the gate — where
 *       (b) rests on two.
 *
 * Neither was fixed because widening the first means changing a required context field (its own
 * rung) and both are MEASURED CORPUS-INERT: no shipped kit can observe either phantom today. That
 * measurement is the entire justification, and a measurement nobody re-runs is a stale claim waiting
 * to happen — the day a kit ships an enemy-HP-ABOVE gate, or an `enemies-hit-this-cast` gate on a
 * support ship, the phantom becomes live and silently wrong. These cases fail loudly on that day.
 *
 * They assert over the PARSED corpus abilities rather than the skill TEXT on purpose: the parser is
 * what the engine actually gates on, and a text regex would miss a phrasing it happens not to match
 * while a parsed-condition scan sees exactly what `evaluateConditions` will see.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { corpusNames } from '../audit/kitFingerprintScenarios';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import type { Condition } from '../../../types/abilities';

/**
 * The 24 ally-target ships (contract §A.2) — every healer, shielder and buffer, i.e. exactly the
 * ships whose cast resolves NO victim and therefore the only ones that can reach either phantom.
 * Hardcoded rather than derived because the derivation (parsed `activeTarget` → `TARGET_MAP` side)
 * lives in the targeting parser and a copy of it here would test the copy, not the corpus.
 */
const ALLY_TARGET_SHIPS: readonly string[] = [
    'AEGIS',
    'Chimei',
    'Cultivator',
    'Faust',
    'Flamel',
    'Graphite',
    'Grif',
    'Harvester',
    'Hayyan',
    'Heliodor',
    'Hermes',
    'Howler',
    'Makoli',
    'Meatshield',
    'Mender',
    'Nyxen',
    'Oleander',
    'Paracelsus',
    'Purifier',
    'Refine',
    'Salvation',
    'Sentinel',
    'Shelter',
    'Volk',
];

/** Every parsed condition in the corpus, tagged with where it came from. */
const allCorpusConditions = (): { ship: string; slot: string; cond: Condition }[] => {
    const rows: { ship: string; slot: string; cond: Condition }[] = [];
    for (const ship of corpusNames()) {
        const built = buildTraceShip(ship);
        if (!built) continue;
        for (const { slot, abilities } of buildShipAbilities(built).slots) {
            for (const ability of abilities) {
                for (const cond of ability.conditions ?? []) rows.push({ ship, slot, cond });
            }
        }
    }
    return rows;
};

describe('SP-4c-2b residual tripwires', () => {
    beforeAll(() => {
        if (!csvAvailable() || !shipDataAvailable()) {
            throw new Error(
                'docs/ship-skills.csv and/or docs/ship-data.json are missing from this worktree ' +
                    '(gitignored reference data) — these tripwires scan the real corpus.'
            );
        }
    });

    it('ALLY_TARGET_SHIPS is not stale: every name still resolves, and the count is pinned', () => {
        // The hardcoded list is this file's own staleness hole: legs 1 of cases (b) and (c) filter by
        // it, so a NEWLY SHIPPED ally-target ship would be invisible to them and their green would
        // mean nothing. A resolvability check plus a length pin is the cheap half of the guard — it
        // catches a renamed or removed ship, and it forces anyone who changes the corpus's support
        // roster to come here and re-read what the list is for.
        //
        // Deliberately NOT re-derived from the corpus (parsed `activeTarget` → `TARGET_MAP` side): a
        // derivation here would be a copy of the targeting parser's own logic, and the test would
        // then pass by agreeing with itself. A resolvability check is not a copy of the derivation.
        const unresolvable = ALLY_TARGET_SHIPS.filter((n) => buildTraceShip(n) === null);
        expect(
            unresolvable,
            `ally-target ship name(s) that no longer exist in the corpus: ${unresolvable.join(', ')} ` +
                '— a rename or removal. Update ALLY_TARGET_SHIPS.'
        ).toEqual([]);
        expect(
            ALLY_TARGET_SHIPS.length,
            'ALLY_TARGET_SHIPS changed length. If the corpus gained an ally-target ship, add it here ' +
                'AND re-read cases (b)/(c): their inertness rests on this list being complete.'
        ).toBe(24);
    });

    it('is non-vacuous: the corpus scan really produces conditions', () => {
        // Without this, a parser/loader change that yields zero abilities would make both tripwires
        // below pass trivially — the classic "green because nothing was observed" failure.
        const rows = allCorpusConditions();
        expect(rows.length).toBeGreaterThan(100);
        // And the shape both tripwires filter on must itself be present, or the filters prove nothing.
        expect(rows.filter((r) => r.cond.subject === 'hp-threshold').length).toBeGreaterThan(0);
    });

    it('(a) NO ship gates on the enemy being ABOVE an HP threshold — the phantom enemyHpPct 100 is unobservable', () => {
        // The phantom answers 100, so only an `above` comparator against the ENEMY could be
        // satisfied by it. `hpSubject` defaults to 'enemy' when absent (see the field's own doc in
        // types/abilities.ts), so an undefined subject counts as enemy here.
        const offenders = allCorpusConditions()
            .filter(
                (r) =>
                    r.cond.subject === 'hp-threshold' &&
                    r.cond.hpComparator === 'above' &&
                    (r.cond.hpSubject === undefined || r.cond.hpSubject === 'enemy')
            )
            .map((r) => `${r.ship}/${r.slot} (>${r.cond.hpPercent}%)`);

        expect(
            offenders,
            'A kit now gates on the ENEMY being ABOVE an HP threshold. On an ally-targeted cast ' +
                'there is no enemy, but `enemyHpPct` still answers 100, so that gate will read TRUE ' +
                'against nobody. Fix `PlayerRoundCtx.enemyHpPct` (playerTurn.ts ~248 — make it ' +
                'optional) and its derivation (the `enemyHpDecline` block), then delete this case. ' +
                'Do NOT relax the assertion: the phantom is a wrong answer, not a tolerable one.'
        ).toEqual([]);

        // The rung's own claim, pinned: the enemy-subject gates that DO exist are all `below`, and a
        // `below` gate against 100 reads false — which is the correct "there is no enemy" answer.
        const enemyBelow = allCorpusConditions().filter(
            (r) =>
                r.cond.subject === 'hp-threshold' &&
                r.cond.hpComparator === 'below' &&
                (r.cond.hpSubject === undefined || r.cond.hpSubject === 'enemy')
        );
        expect(enemyBelow.length).toBeGreaterThan(0);
    });

    it('(c) NO ally-target ship carries a GT stat-vs-target gate — the target-at-zero phantom is unobservable', () => {
        // The phantom reads the target at 0, so only a `gt` comparator can be satisfied by it: a
        // `lt` gate asks `self < 0`, which is never true, and is therefore safe by arithmetic rather
        // than by luck. Corpus today: Bayah (crit-power, gt) and Cobalt (hp, gt) are
        // phantom-satisfiable; Chakara (speed, lt) is not. None of the three is an ally-target ship.
        const gates = allCorpusConditions().filter((r) => r.cond.subject === 'stat-vs-target');
        expect(
            gates.length,
            'nobody carries a stat-vs-target gate any more — this scan has gone stale'
        ).toBeGreaterThan(0);
        // The `gt` half must be non-empty too, or the filter below proves nothing about comparators.
        expect(
            gates.filter((r) => r.cond.statComparator !== 'lt').length,
            'no GT stat-vs-target gate left in the corpus — re-check whether this residual can still bite'
        ).toBeGreaterThan(0);

        const offenders = gates
            .filter((r) => r.cond.statComparator !== 'lt' && ALLY_TARGET_SHIPS.includes(r.ship))
            .map((r) => `${r.ship}/${r.slot} (${r.cond.compareStat} ${r.cond.statComparator})`);
        expect(
            offenders,
            'An ALLY-TARGET ship now carries a GT owner-vs-target stat gate. Its ally-targeted cast ' +
                'resolves no victim, so the target stat defaults to 0 and the gate reads TRUE against ' +
                'nobody — and the consumer (gateFiringAbilities) is deliberately unfenced, so it really ' +
                'evaluates. Give ConditionContext.targetSpeed/targetCurrentHp/targetCritPower an ' +
                'explicit absent-target answer instead of `?? 0`, then delete this case. Do NOT relax ' +
                'the assertion.'
        ).toEqual([]);
    });

    it('(b) NO ally-target ship gates on enemies-hit-this-cast — the phantom booking of 1 is unobservable', () => {
        // Two conditions must BOTH hold for the phantom to matter: the same ship must take a
        // no-victim turn (i.e. be one of the 24) AND read this gate. Corpus today: Berserker and
        // Tygr read it, neither is an ally-target ship.
        const readers = allCorpusConditions().filter(
            (r) => r.cond.subject === 'enemies-hit-this-cast'
        );
        expect(
            readers.length,
            'nobody reads this gate any more — the scan has gone stale'
        ).toBeGreaterThan(0);

        const offenders = readers
            .filter((r) => ALLY_TARGET_SHIPS.includes(r.ship))
            .map((r) => `${r.ship}/${r.slot}`);
        expect(
            offenders,
            'An ALLY-TARGET ship now gates on enemies-hit-this-cast. Its ally-targeted cast hits ' +
                'nobody, but the engine books 1 for it, so the gate reads a phantom footprint. Book ' +
                '0 on a no-victim turn (the `enemiesHitThisCastByActor.set` sites in engine.ts) and ' +
                'delete this case.'
        ).toEqual([]);

        // Second, independent guard: every reader needs at least 2 enemies hit, so a phantom 1 could
        // not satisfy one even if an ally-target ship acquired the gate. If a `gte 1` (or a lte/eq)
        // reader ever appears, this rung's "inert twice over" claim loses its second leg.
        const satisfiableByOne = readers.filter(
            (r) =>
                r.cond.countComparator !== 'gte' ||
                r.cond.countThreshold === undefined ||
                r.cond.countThreshold <= 1
        );
        expect(
            satisfiableByOne.map((r) => `${r.ship}/${r.slot}`),
            'An enemies-hit-this-cast gate appeared that a phantom booking of 1 COULD satisfy. The ' +
                'residual now rests on the ally-target check alone — re-read the note at the ' +
                '`enemiesHitThisCastByActor.set` sites before shipping anything that relies on it.'
        ).toEqual([]);
    });
});
