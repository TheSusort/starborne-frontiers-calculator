/**
 * Real-kit behaviour fingerprints — the golden suite's ONLY real-ship coverage.
 *
 * Every other golden fixture in this directory is synthetic (see simGoldenFixtures.ts's header:
 * the author had no local corpus), which is why 22 commits of real ship-behaviour change in #296
 * and the Malvex gate fix in #297 moved zero snapshots.
 *
 * Each of the 147 corpus ships is run through three fixed scenarios and reduced to the SET of
 * `kind[:slot]` behaviour tokens it produced. A diff means that ship's behaviour changed. The
 * suite is deliberately STRUCTURAL, not numeric: it answers "does this clause still fire", which
 * is the dominant defect class in the changelog ("now does something", "was a name in the buff
 * list with no effect", "the condition was not being read at all"). Numeric drift is
 * dpsGoldenParity / healingGoldenParity's job.
 *
 * `vitest -u` on this file is FORBIDDEN except as a deliberate, audited behaviour move. A moved
 * snapshot is a real behaviour change and must be explained in the commit that moves it.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
    SCENARIOS,
    fingerprintShip,
    corpusNames,
    buildScenarioBattle,
    FOCUS_ACTOR_ID,
    ROUNDS,
    SEED,
    scenariosFor,
    darkSlotsOnPrimaryBoard,
    type ScenarioName,
    type FingerprintScenario,
} from '../../combat/audit/kitFingerprintScenarios';
import { runSeededBattle } from '../../combat/audit/seededBattle';
import { fingerprintActorTokens } from '../../combat/audit/fingerprint';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';

function requireReferenceData(): void {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'docs/ship-skills.csv and/or docs/ship-data.json are missing from this worktree ' +
                '(gitignored reference data) — tests need them to resolve real ship skill text/stats.'
        );
    }
}

/** Filled by the snapshot pass below and consumed by `suite health` — 441 battles are expensive
 *  (~7s), so the health assertions read what the snapshot pass already computed instead of
 *  re-running the whole roster. `suite health` is declared AFTER the snapshot describe on purpose:
 *  vitest runs describes in declaration order. */
const observed = new Map<string, Partial<Record<FingerprintScenario, string[]>>>();

/** The two LIVE invariants every fingerprint rests on (see `kitFingerprintScenarios.test.ts`'s
 *  "live battle invariants" describe, which spot-checks only Xiaodao/Malvex): the focus must take
 *  real incoming damage, or all on-damaged kit is silent; and it must survive to round `ROUNDS`,
 *  or its fingerprint is truncated at an arbitrary round. Captured here, corpus-wide, from the SAME
 *  441 battle results the snapshot pass below already runs — reading a couple more fields off a
 *  result that's already sitting in memory, not an extra battle run. Consumed by `suite health`. */
interface LiveInvariant {
    taken: number;
    alive: boolean;
    lastRound: number;
}
const observedInvariants = new Map<string, Record<ScenarioName, LiveInvariant>>();

describe('kit fingerprints', () => {
    beforeAll(requireReferenceData);

    it.each(corpusNames().map((n) => [n] as const))('%s', (name) => {
        const ship = buildTraceShip(name);
        expect(ship, `${name} did not resolve from the corpus`).not.toBeNull();
        // Inlines fingerprintShip's own loop (rather than calling it) so the invariant fields can
        // be read off the same BattleResult instead of running each of the 441 battles twice.
        const fp: Partial<Record<FingerprintScenario, string[]>> = {};
        const invariants = {} as Record<ScenarioName, LiveInvariant>;
        for (const scenario of scenariosFor(ship!)) {
            const result = runSeededBattle(buildScenarioBattle(ship!, scenario), SEED);
            fp[scenario] = fingerprintActorTokens(result, FOCUS_ACTOR_ID);
            // The support-anchor board's focus takes zero incoming damage BY CONSTRUCTION (allies
            // forward of it are front-most and absorb every attack), so it cannot satisfy the
            // incoming-damage invariant and is deliberately excluded from it. Its own guard is
            // "the previously-dark slot produced fresh tokens", asserted in `suite health`.
            if (scenario === 'supportAnchor') continue;
            const rows = result.rounds
                .flatMap((r) => r.ships)
                .filter((s) => s.actorId === FOCUS_ACTOR_ID);
            invariants[scenario] = {
                taken: rows.reduce((sum, s) => sum + s.damageTaken, 0),
                alive: rows.every((s) => s.alive),
                lastRound: result.outcome.lastRound,
            };
        }
        observed.set(name, fp);
        observedInvariants.set(name, invariants);
        expect(fp).toMatchSnapshot();
    });
});

describe('pinned regression: Malvex target-shield gates (#296, #297)', () => {
    beforeAll(requireReferenceData);

    it('gates BOTH the active self-shield and the charged Barrier on a shielded target', () => {
        // The case the whole suite exists for. Pre-#297 the active self-shield fired on every cast
        // regardless of target, and pre-#296 the charged Barrier did too — so both tokens sat in
        // all three scenarios. They must now appear ONLY where the target actually carries a
        // Shield.
        //
        // Malvex ALSO has an on-damaged passive self-shield ("gains Shield equal to 15% of the
        // damage dealt to them"), and the focus is now genuinely under fire in every scenario, so
        // that passive fires everywhere. It is still not visible as a bare `shield` token: the
        // reactive grant emits no shield log entry, only its later destruction does — which is why
        // `shield-destroyed` sits in plain/wounded while `shield` does not. So a bare-`kind`
        // fingerprint WOULD also have caught #296/#297 here (bare `shield` is richEnemy-only). The
        // `:slot` suffix's value is narrower than "it caught this": it separates two same-kind
        // entries when both are logged, and it names WHICH slot regressed in the diff.
        const malvex = buildTraceShip('Malvex');
        expect(malvex).not.toBeNull();
        const fp = fingerprintShip(malvex!);

        expect(fp.richEnemy).toContain('shield:active');
        expect(fp.plain).not.toContain('shield:active');
        expect(fp.wounded).not.toContain('shield:active');

        expect(fp.richEnemy).toContain('buff:charged');
        expect(fp.plain).not.toContain('buff:charged');
        expect(fp.wounded).not.toContain('buff:charged');

        // The on-damaged passive really is live in the un-shielded scenarios (see above): a pool
        // it never granted could not be destroyed.
        expect(fp.plain).toContain('shield-destroyed');
        expect(fp.wounded).toContain('shield-destroyed');
    });
});

describe('pinned regression: ally-directed kit is visible (buff granter attribution)', () => {
    beforeAll(requireReferenceData);

    it("sees Purifier's ally grants, which booked to the RECEIVER before granter attribution", () => {
        // Purifier's whole active is other-directed: it grants Hacking Up II + Binderburg
        // Resilience II to allies covered by Pattern-Wings-Support-Not-Self-Range-2 and never
        // touches itself. Because `buff` was the one grant-style log kind booked to its
        // recipient, its entire fingerprint was `charge-changed` — correct code that looked
        // dead. This pins the fix: an ally-only support kit must produce a `buff` token of its
        // own. A bare snapshot would also catch it, but only this test says WHY it moved.
        const purifier = buildTraceShip('Purifier');
        expect(purifier).not.toBeNull();
        const fp = fingerprintShip(purifier!);
        for (const scenario of SCENARIOS) {
            expect(fp[scenario], `${scenario} lost Purifier's ally grants`).toContain('buff');
        }
    });
});

describe('pinned regression: Line-Support kit reaches allies on the support-anchor board', () => {
    beforeAll(requireReferenceData);

    // Pattern-Line-Support-* extends FORWARD, so anchored on the primary board's front column it
    // resolved to zero cells and these three ships' actives AND charges were structurally
    // unobservable — Faust and Mender fingerprinted as a bare ['charge-changed']. The snapshot
    // catches any future regression; this test says WHY those entries exist.
    //
    // Kinds, not kind:slot tokens — see the note above: the suffix tracks emission order, the kind
    // tracks the kit. `charge-changed` is never valid evidence here: it is emitted on cast whether
    // or not the ability found a target, which is exactly what made the old fingerprints look
    // alive when they were not.
    //
    // Mender has no `:active`-suffixed token below, yet its active heal fires correctly every
    // round — verified by tracing the raw combat log (two allies healed for 4,179.35 each, rounds
    // 1-20, the only entry in Mender's own turn, so there is no competing handler to lose the
    // `ctx.consumePendingSkill()` race to). That heal code path simply never calls
    // `consumePendingSkill()`; it is a pre-existing engine tag-attribution characteristic, not a
    // fixture defect. This is exactly why the assertions below are kind-level, not slot-level.
    const EXPECTED_KINDS: Record<string, string[]> = {
        Faust: ['heal', 'buff'],
        Mender: ['heal'],
        Refine: ['buff'],
    };

    it.each(Object.keys(EXPECTED_KINDS))('%s supports its allies from M1', (name) => {
        const ship = buildTraceShip(name);
        expect(ship).not.toBeNull();
        const fp = fingerprintShip(ship!);
        expect(fp.supportAnchor, `${name} ran no supportAnchor scenario`).toBeDefined();

        const anchor = fp.supportAnchor ?? [];
        const primary = new Set(SCENARIOS.flatMap((s) => fp[s]));
        for (const kind of EXPECTED_KINDS[name]) {
            const matching = anchor.filter((t) => t.split(':')[0] === kind);
            expect(
                matching,
                `${name} produced no ${kind} entry on the support-anchor board — its support ` +
                    'clause stopped reaching its allies'
            ).not.toEqual([]);
            // ...and it must be NEW. Without this, a kind the ship already emitted on the primary
            // board (Refine's passive `buff`) would satisfy the test without the active firing.
            expect(
                matching.some((t) => !primary.has(t)),
                `${name}'s ${kind} entries are all ones it already produced on the primary board ` +
                    '— either the support-anchor board added nothing, or the primary board now ' +
                    'sees this kit and the second board no longer earns its keep'
            ).toBe(true);
        }
    });
});

describe('suite health', () => {
    beforeAll(() => {
        requireReferenceData();
        if (observed.size !== corpusNames().length) {
            throw new Error(
                `suite health consumes the snapshot pass, which recorded ${observed.size} of ` +
                    `${corpusNames().length} ships — run the whole file (no -t filter).`
            );
        }
        if (observedInvariants.size !== corpusNames().length) {
            throw new Error(
                `suite health consumes the snapshot pass, which recorded live invariants for ` +
                    `${observedInvariants.size} of ${corpusNames().length} ships — run the whole ` +
                    'file (no -t filter).'
            );
        }
    });

    // Two corpus ships are documented, kit-explained exceptions to "the focus takes real incoming
    // damage" — not a fixture failure (see final-fix-report.md's "before → after measurements"):
    // Meiying gains Stealth "at the start of combat and every turn", so it is permanently
    // untargetable; Voron "transforms the damage into a Damage over Time effect", so its intake
    // books 0 at the instant of the hit even though it demonstrably IS being hit (it carries a
    // `dot-ticked` token it would not otherwise have).
    const KNOWN_ZERO_DAMAGE: readonly string[] = ['Meiying', 'Voron'];

    it('every corpus ship takes real incoming damage and survives all 20 rounds, in every scenario', () => {
        // The corpus-wide version of the two-ship spot-check in kitFingerprintScenarios.test.ts's
        // "live battle invariants" (Xiaodao/Malvex) — cheap here because observedInvariants was
        // collected as a side effect of the snapshot pass's own 441 battles, not by re-running them.
        const noDamage: string[] = [];
        const died: string[] = [];
        const truncated: string[] = [];
        for (const [name, byScenario] of observedInvariants) {
            for (const scenario of SCENARIOS) {
                const inv = byScenario[scenario];
                if (inv.taken <= 0 && !KNOWN_ZERO_DAMAGE.includes(name)) {
                    noDamage.push(`${name}/${scenario}`);
                }
                if (!inv.alive) died.push(`${name}/${scenario}`);
                if (inv.lastRound !== ROUNDS) truncated.push(`${name}/${scenario}`);
            }
        }
        expect(
            noDamage,
            'ship/scenario pairs where the focus took NO damage — the enemies are not resolving ' +
                'onto it, so every on-damaged clause is silent there'
        ).toEqual([]);
        expect(
            died,
            'ship/scenario pairs where the focus died — its fingerprint is truncated at the round ' +
                'it fell, so kill timing leaks into the snapshot'
        ).toEqual([]);
        expect(truncated, `ship/scenario pairs whose battle ended before round ${ROUNDS}`).toEqual(
            []
        );
    });

    it('every KNOWN_ZERO_DAMAGE exemption is STILL warranted (a kit/board fix must remove the ship, not leave a stale exemption)', () => {
        // KNOWN_ZERO_DAMAGE is the last hand-maintained exemption list in this suite — its sibling,
        // KNOWN_UNREACHABLE, was replaced by a derivation (see kitFingerprintScenarios.test.ts's
        // 'pattern reachability'). Without this guard, a kit or board change that makes Meiying or
        // Voron take real damage would pass silently: the exemption would keep suppressing a
        // failure that no longer exists to suppress.
        //
        // `some`, not `every`: the exemption asserts "this ship takes no damage", a claim `some`
        // falsifies on the first counterexample. `every` would only flag a ship once it takes
        // damage in ALL three scenarios, staying silent indefinitely if a fix only partially
        // restores damage (e.g. two scenarios fixed, one still silently zero) — exactly the kind
        // of half-fixed state this suite exists to catch, not wave through.
        const stale = KNOWN_ZERO_DAMAGE.filter((name) => {
            const inv = observedInvariants.get(name);
            return !!inv && SCENARIOS.some((scenario) => inv[scenario].taken > 0);
        });
        expect(
            stale,
            `KNOWN_ZERO_DAMAGE exemption(s) that now take real damage in at least one scenario: ` +
                `${stale.join(', ')} — the ship's kit or the board changed; remove it from ` +
                'KNOWN_ZERO_DAMAGE (or re-document the reasoning for the scenarios still zero) ' +
                'rather than leaving a stale exemption.'
        ).toEqual([]);
    });

    /** The coverage LEDGER. Every kind listed here is produced by at least one corpus ship today;
     *  losing any one of them is a coverage regression that must be explained, not re-blessed.
     *
     *  The five `CombatLogEntryKind`s NOT here, and why none is a tuning failure:
     *   - `cleanse` / `purge`: need a debuff on the player side / a buff on the enemy side to
     *     remove. The filler ships apply neither, and status seeding is the deliberately deferred
     *     fourth scenario. 21 corpus ships cleanse and 15 purge, so this is the single biggest
     *     remaining hole.
     *   - `detonation`: `buildCombatLog` books that entry to the bomb's VICTIM, not to the actor
     *     that detonated it, so it can never appear in a focus-actor fingerprint unless the focus
     *     is itself bombed — which needs an enemy that plants bombs, i.e. non-inert filler.
     *   - `death`: booked to the actor that died. The focus surviving all 20 rounds is a hard
     *     requirement (its death truncates its own fingerprint), so this one is unreachable by
     *     construction.
     *   - `cheat-death`: booked to the actor whose death was prevented, i.e. it needs the focus to
     *     take LETHAL damage. Same conflict as `death`. Only 4 corpus ships carry Cheat Death
     *     (Hayyan, Hermes, Tycho, Yazid) and an ally's cheat-death books to the ally. */
    const EXPECTED_KINDS = [
        'attack',
        'bomb',
        'buff',
        'buff-expired',
        'charge-changed',
        'control',
        'debuff',
        'debuff-resisted',
        'dot-applied',
        'dot-ticked',
        'heal',
        'shield',
        'shield-destroyed',
    ] as const;

    it('is non-vacuous: every ship produces tokens', () => {
        // Without this, a harness bug that fingerprints nothing yields 147 empty snapshots and
        // reads as passing.
        const empty = [...observed.entries()]
            .filter(([, fp]) => SCENARIOS.every((s) => (fp[s] ?? []).length === 0))
            .map(([name]) => name);
        expect(empty, `ships producing NO tokens in any scenario: ${empty.join(', ')}`).toEqual([]);
    });

    it('covers every log kind the roster is expected to reach', () => {
        const kinds = new Set<string>();
        for (const fp of observed.values()) {
            for (const tokens of Object.values(fp)) {
                for (const token of tokens) kinds.add(token.split(':')[0]);
            }
        }
        const missing = EXPECTED_KINDS.filter((k) => !kinds.has(k));
        expect(
            missing,
            `log kinds that stopped appearing anywhere in the roster: ${missing.join(', ')} — ` +
                'a whole behaviour family went silent, or the scenarios stopped putting the board ' +
                'in the state it needs (see EXPECTED_KINDS for what each one requires).'
        ).toEqual([]);
        // The other direction: a NEW kind showing up is also news — it means the roster reached a
        // state the ledger does not describe. Update EXPECTED_KINDS and say why.
        const unexpected = [...kinds].filter(
            (k) => !(EXPECTED_KINDS as readonly string[]).includes(k)
        );
        expect(
            unexpected,
            `log kinds appearing that the ledger does not list: ${unexpected.join(', ')}`
        ).toEqual([]);
    });

    it('is deterministic: fingerprinting the same ship twice gives identical tokens', () => {
        // Guards against RNG leaking across scenarios — runSeededBattle restores Math.random in
        // its finally, so a battle run outside it would drift between calls.
        const ship = buildTraceShip('Malvex');
        expect(ship).not.toBeNull();
        expect(fingerprintShip(ship!)).toEqual(fingerprintShip(ship!));
    });

    it('pins the corpus shape so a data refresh announces itself in ONE diff', () => {
        // 147 snapshots derived from gitignored data would otherwise churn with no explanation.
        // This entry moving ALONGSIDE many ship entries means "the corpus changed"; ship entries
        // moving while this one holds still means "the engine changed".
        //
        // Hashes the raw skill TEXT, not its length: a same-length edit ("40%" -> "50%") is a real
        // behaviour change and must move this digest, or the ship's own moved fingerprint would be
        // misread as an engine change.
        const rows = loadShipSkillRecords();
        const digest = rows
            .map((r) => `${r.name} ${r.active} ${r.charge} ${r.passives.join('')}`)
            .sort()
            .join('\n');
        let hash = 0;
        for (let i = 0; i < digest.length; i++) hash = (hash * 31 + digest.charCodeAt(i)) | 0;
        expect({ shipCount: rows.length, digest: hash }).toMatchSnapshot();
    });

    it('every support-anchor ship produces behaviour there that the primary board never showed', () => {
        // The #298 lesson, applied to the new board: a fixture that RUNS is not a fixture that
        // OBSERVES. Without this, routing three ships onto a second board could snapshot three
        // more vacuous entries and read as a fix.
        //
        // Compared against the UNION of all three primary scenarios, which controls for seeding:
        // supportAnchor reuses `wounded`'s HP seeding, so anything the ship already does when
        // wounded is not evidence that its support footprint reached anyone.
        //
        // `charge-changed` is excluded as evidence: it is emitted on cast regardless of whether
        // the ability found any target, and it is exactly the token Faust and Mender's vacuous
        // primary fingerprints already consisted of.
        //
        // Asserted per SHIP, not per slot, on purpose: `ctx.consumePendingSkill()` is single-use
        // per cast, so only the first log entry of a cast carries `{skillName, slot}` and a
        // later entry from the same cast legitimately lands bare. Per-slot evidence would be
        // flaky for reasons unrelated to the kit. Per-SLOT geometry is guard 1's job, in
        // kitFingerprintScenarios.test.ts.
        const EVIDENCE_EXCLUDED = new Set(['charge-changed']);
        const darkNames = [...new Set(darkSlotsOnPrimaryBoard().map((d) => d.name))].sort();
        expect(
            darkNames.length,
            'the derivation found no dark ships — the sweep is broken'
        ).toBeGreaterThan(0);

        const barren: string[] = [];
        for (const name of darkNames) {
            const fp = observed.get(name);
            expect(fp, `${name} was never fingerprinted`).toBeDefined();
            expect(
                fp!.supportAnchor,
                `${name} is dark on the primary board but ran no supportAnchor scenario — ` +
                    'scenariosFor did not route it'
            ).toBeDefined();
            const primary = new Set(SCENARIOS.flatMap((s) => fp![s] ?? []));
            const fresh = (fp!.supportAnchor ?? []).filter(
                (t) => !primary.has(t) && !EVIDENCE_EXCLUDED.has(t.split(':')[0])
            );
            if (fresh.length === 0) barren.push(name);
        }
        expect(
            barren,
            `ship(s) whose supportAnchor fingerprint adds NOTHING over their primary one: ` +
                `${barren.join(', ')} — the second board reached their pattern geometrically ` +
                '(guard 1 proves that) but their kit still produced no new behaviour. That is a ' +
                'FINDING to investigate and report, not a reason to relax this assertion.'
        ).toEqual([]);
    });
});
