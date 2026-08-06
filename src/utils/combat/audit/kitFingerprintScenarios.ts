import type { Ship } from '../../../types/ship';
import type { Position } from '../../../types/encounters';
import type { CombatActor } from '../state';
import type { BattlePlacement, BattleSimulationInput } from '../../calculators/battleSimulator';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';
import { calculateDamageReduction } from '../../autogear/priorityScore';
import { canonicalPlacement } from './fixtures';
import { runSeededBattle } from './seededBattle';
import { fingerprintActorTokens } from './fingerprint';

export type ScenarioName = 'plain' | 'richEnemy' | 'wounded';

/** The three scenarios EVERY corpus ship runs. Deliberately narrower than `FingerprintScenario`:
 *  the corpus-wide live invariants (focus takes real damage, focus survives) are asserted over this
 *  array, and the support-anchor board cannot satisfy the first one by construction. Keeping it out
 *  of `SCENARIOS` excludes it from those invariants with no exemption list to go stale. */
export const SCENARIOS: readonly ScenarioName[] = ['plain', 'richEnemy', 'wounded'] as const;

/** Every scenario a ship MAY run. `supportAnchor` is conditional — see `scenariosFor`. */
export type FingerprintScenario = ScenarioName | 'supportAnchor';

/** Pinned RNG seed for every scenario battle. One seed for all of them: the scenarios are meant
 *  to differ by initial STATE, not by RNG stream. */
export const SEED = 20260805;

/** 20 rounds, matching the ablation harness — long enough for charge skills to fire, DoTs to
 *  tick more than once, and cooldown-gated grants to re-arm. */
export const ROUNDS = 20;

/** One board geometry: where the focus sits, and where its filler allies and enemies sit. */
export interface BoardLayout {
    focus: Position;
    allies: readonly Position[];
    enemies: readonly Position[];
}

/**
 * THE PRIMARY BOARD — the single most load-bearing choice in this fixture, because it decides
 * whether the focus ship is ever ATTACKED. `selectTargets` scans rows starting at the CASTER's own
 * row (`rowScanOrder`: caster row → next → wrap) and takes the front-most occupied column (col 4 =
 * front) of the first row that holds a target. Consequences:
 *
 *  - Three enemies share the focus's OWN row (M3/M2/M1 against the focus at M4). Their scan starts
 *    at row M, finds exactly one player there — the focus, front-most at col 4 — so all three
 *    single-target attacks land on the focus, every round. That is what makes on-damaged kit
 *    (counterattack, reflect, revenge, on-damaged grants, Barrier hit-counting) observable at all:
 *    an earlier layout parked the focus behind an ally in another row and it took ZERO incoming
 *    damage in 136 of 147 fingerprints.
 *  - Sharing the row also keeps the focus's OWN offence multi-target: scanning from M it finds
 *    M3/M2/M1 front-to-back, so front/back/skip/adjacent patterns still differentiate, and `all`
 *    still reaches four enemies (row M, then T3).
 *  - The fourth enemy sits at T3, whose scan starts at row T where the front-most player is the
 *    ALLY at T4 — the slot the fragile ally occupies in `wounded`. That is the only way an ally
 *    can be attacked (and so die) while the focus is itself front-most in its own row.
 *  - The third ally at T2 backs up T4: when the fragile ally dies, the T3 enemy retargets to T2
 *    rather than joining the three already hitting the focus, so the focus's incoming-damage
 *    budget is the same in all three scenarios.
 *  - Allies at T4/B4 flank the focus's column-4 cell, so column/adjacency support footprints
 *    reach real allies.
 *
 * All eight cells are distinct: an ally and an enemy on the same cell would be indistinguishable
 * in position-keyed engine state.
 *
 * WHAT THIS BOARD CANNOT DO, and why there is a second one: anchoring at the FRONT column means a
 * forward-extending support pattern (`Pattern-Line-Support-*`, which extends +q toward col 4) has
 * no cells ahead of it and resolves to ZERO. Three corpus ships are affected, in BOTH their active
 * and charged slots (charged targeting inherits active when the charged columns are blank —
 * `targetingParser.ts`). It cannot be fixed by moving this anchor: for such a caster to have
 * anyone to support, allies must sit forward of it in its own row, which makes one of THEM
 * front-most and stops the focus being attacked. The two requirements are mutually exclusive on one
 * board, so they get one board each. See SUPPORT_ANCHOR_BOARD.
 */
export const PRIMARY_BOARD: BoardLayout = {
    focus: 'M4',
    allies: ['T4', 'T2', 'B4'],
    enemies: ['M3', 'M2', 'M1', 'T3'],
};

/**
 * THE SUPPORT-ANCHOR BOARD — run only by ships the primary board cannot reach (see
 * `scenariosFor`). The focus sits at the BACK of the middle row with three allies forward of it,
 * giving forward-extending support patterns three occupied cells to cover (ranges 1 through 3).
 *
 * Enemies stay OUT of row M, so the support line is all allies. The focus's own row scan is
 * M → B → T, so with row M holding no enemies it finds B4 front-most and still reaches all four
 * under an `all` pattern — its enemy-directed kit stays live.
 *
 * ACCEPTED LIMITATION: the focus takes zero incoming damage here, because the allies forward of it
 * are front-most and absorb every attack. Nothing is lost — the affected ships keep their full
 * primary-board fingerprints, which is where their on-damaged coverage lives. This board answers
 * one narrow question: does this ship's support footprint reach anyone, and what does it do when
 * it does.
 */
export const SUPPORT_ANCHOR_BOARD: BoardLayout = {
    focus: 'M1',
    allies: ['M2', 'M3', 'M4'],
    enemies: ['B4', 'B3', 'B2', 'T4'],
};

export function boardFor(scenario: FingerprintScenario): BoardLayout {
    return scenario === 'supportAnchor' ? SUPPORT_ANCHOR_BOARD : PRIMARY_BOARD;
}

/** The primary board's focus cell. Kept as a named export because the reachability derivation and
 *  several board tests read it directly. */
export const FOCUS_POSITION: Position = PRIMARY_BOARD.focus;

/** How many enemies resolve onto the focus each round under the layout above (M3/M2/M1). Drives
 *  the incoming-damage budget in `fillerAttackFor`; verified by the "focus is the one being
 *  attacked" scenario test. */
const ATTACKERS_ON_FOCUS = 3;

/** Seven corpus ships verified inert: no passives, no charge skill, and a bare
 *  "This Unit deals 90% damage" active (see the inertness guard test, which fails loudly if a data
 *  refresh changes that). Because they carry no kit, a focus ship's fingerprint is a function of
 *  its OWN kit plus the engine — nothing here can perturb it.
 *
 *  First 4 are the enemy side, last 3 the ally side. Distinct WITHIN each side because a repeated
 *  ship on one side is an illegal in-game state (compose.ts's pickDistinctShip); repeats across
 *  sides would be legal but are unnecessary given 10 candidates exist. */
export const FILLER_NAMES: readonly string[] = [
    'Bedrock',
    'Crusher',
    'Custodian',
    'Forsythia',
    'Jempol',
    'Krysa',
    'Rookie',
] as const;

/** Filler survive the whole window: without this, a damage-formula change shifts kill timing,
 *  which shifts which clauses get to fire — numeric sensitivity leaking into a structural suite.
 *  Deliberately absurd rather than merely large: the corpus's per-battle damage output spans more
 *  than an order of magnitude, so no single finite HP value both keeps the hardest hitter from
 *  killing and lets the softest one dent anything. HP% STATE is therefore seeded directly (see
 *  HURT_FRACTION) instead of being produced by damage — that decouples "which hp-threshold gates
 *  can read true" from "how hard this particular focus ship hits". */
export const FILLER_HP = 500_000_000;

/** Share of the focus ship's MAX HP that the whole 20-round battle should take off it.
 *
 *  Absolute filler attack cannot work here: the corpus spans 7.3k–23.9k HP and 972–4047 defence
 *  (22%–53% mitigation), so one attack value either leaves the tanks untouched or kills the
 *  squishies. `fillerAttackFor` inverts the damage formula per focus ship instead, so every
 *  fingerprint is taken at the same RELATIVE pressure.
 *
 *  0.2 is chosen against the `wounded` scenario, the binding constraint: the focus starts there at
 *  FOCUS_HURT_FRACTION (45%) and must still be alive at round 20, since its death would truncate
 *  its own fingerprint. Measured worst case across the corpus is a 22.4% HP decline (Isha), so the
 *  thinnest survivor still ends around 23% — real, sustained incoming damage with a genuine margin,
 *  and enough of a decline to cross 40%-HP self-gates part-way through the battle. */
const INCOMING_FRACTION = 0.2;

/** The filler active is a bare single-hit "deals 90% damage", so one filler attack point yields
 *  `0.9 × (1 − mitigation)` damage per hit against this focus ship. Invert that over the whole
 *  battle's hit count to hit INCOMING_FRACTION of its max HP.
 *
 *  An ESTIMATE, not a guarantee: the focus's own defence buffs/debuffs, incoming-damage modifiers,
 *  shields, dodges and self-heals all move the realised total. It only has to land in the band
 *  "clearly nonzero, comfortably survivable", which the scenario tests assert directly.
 *
 *  Because this inverts the engine's OWN `calculateDamageReduction`, a change to the mitigation
 *  formula is COMPENSATED here rather than surfaced — this suite is deliberately blind to
 *  mitigation-formula changes, consistent with it being a structural (does-this-clause-fire) suite,
 *  not a numeric one (that's dpsGoldenParity / healingGoldenParity's job). */
function fillerAttackFor(focus: Ship): number {
    const defence = focus.baseStats.defence;
    const mitigation = defence > 0 ? calculateDamageReduction(defence) : 0;
    const perHitPerAttackPoint = 0.9 * (1 - mitigation / 100);
    const hits = ROUNDS * ATTACKERS_ON_FOCUS;
    return Math.max(
        1,
        Math.round((INCOMING_FRACTION * focus.baseStats.hp) / (perHitPerAttackPoint * hits))
    );
}

/** The fragile ally: dies early and deterministically so on-ally-destroyed / revive / cheat-death
 *  clauses fire. The ONE intentional exception to filler survival. Verified (traceShipFactory +
 *  battleSimulator.resolveStats pass overrides straight through with no scaling) that hp: 1
 *  resolves to stats.hp = 1 and currentHp = 1 at actor construction — the ally starts ALIVE, then
 *  dies to the very first hit it takes. It sits at T4, the only ally cell an enemy resolves onto,
 *  and 1 HP makes the kill timing immune to any damage-formula change: ANY hit is lethal. */
const FRAGILE_ALLY_HP = 1;

let cache: Map<string, Ship> | null = null;

function fillerShip(name: string): Ship {
    if (!cache) cache = new Map();
    const hit = cache.get(name);
    if (hit) return hit;
    const ship = buildTraceShip(name);
    if (!ship) {
        throw new Error(
            `kitFingerprintScenarios: filler ship "${name}" did not resolve — ` +
                'docs/ship-skills.csv / docs/ship-data.json are gitignored reference data ' +
                'expected on dev machines (see CLAUDE.md).'
        );
    }
    cache.set(name, ship);
    return ship;
}

/** A filler placement: canonical base stats, then HP and attack overridden. Attack is per-battle
 *  (derived from the focus ship), not a constant — see `fillerAttackFor`. */
function fillerPlacement(
    name: string,
    position: Position,
    attack: number,
    hp = FILLER_HP
): BattlePlacement {
    const base = canonicalPlacement(fillerShip(name), position);
    return { ...base, statOverrides: { ...base.statOverrides, hp, attack } };
}

/** `richEnemy`'s seeded enemy shield, as a multiple of the focus ship's base attack — an ABSOLUTE
 *  pool, not a fraction of the filler's (absurd) max HP. A fraction was the original choice and it
 *  was inert: 20% of 500M is 100M against ~1.2k hits, so `enemy-shield` gates read true for the
 *  entire battle and nothing ever punched through. Three attack points' worth survives the first
 *  cast or two — long enough for a shield-gated clause to fire at least once — then depletes, so
 *  shield-removal and punch-through clauses see the other side of the gate too. */
const SHIELD_POOL_HITS = 3;

/** `wounded` seeds every filler on BOTH sides to 35% HP: under the corpus's 40%- and 50%-HP gates
 *  (ally-repair triggers, execute/threshold damage, Stealth-below-40 grants) while still inside the
 *  30–70% band, i.e. hurt enough to read as hurt and far enough from 0 that nothing dies to a
 *  rounding-level change. Seeding the ENEMY side too moved zero fingerprints on today's corpus
 *  (measured) — it is kept because the scenario's whole purpose is to put the board in the state
 *  its name claims, and the next kit with an enemy-HP gate is then covered for free. */
const HURT_FRACTION = 0.35;

/** ...but the FOCUS starts higher than its allies, because it is the only actor under sustained
 *  attack: 45% leaves INCOMING_FRACTION's worth of decline plus margin, and it means the focus
 *  CROSSES the 40% line mid-battle rather than starting below it — a transition that "when HP
 *  drops below 40%" clauses (Tycho) require and a static low start would never produce. */
const FOCUS_HURT_FRACTION = 0.45;

/** The focus ship is always the first player placement, and simulateBattle mints the first player
 *  actor with the reserved id 'attacker' (battleSimulator's minting scheme; the rest are
 *  `p:<shipId>:<idx>`). So the focus actor id is fixed. */
export const FOCUS_ACTOR_ID = 'attacker';

const maxHpOf = (a: CombatActor): number => a.stats.hp;

function seedFor(
    focus: Ship,
    scenario: FingerprintScenario
): ((actors: CombatActor[]) => void) | undefined {
    switch (scenario) {
        case 'plain':
            return undefined;
        case 'richEnemy': {
            const pool = SHIELD_POOL_HITS * focus.baseStats.attack;
            return (actors) => {
                for (const a of actors) {
                    if (a.side === 'enemy') a.shieldPool = pool;
                }
            };
        }
        // `supportAnchor` shares wounded's seeding VERBATIM — one new variable (geometry), not two.
        // It is also load-bearing: the ships this board exists for repair their allies, and a
        // repair aimed at a full-HP filler is an overheal that may log nothing at all.
        case 'wounded':
        case 'supportAnchor':
            return (actors) => {
                for (const a of actors) {
                    const fraction = a.id === FOCUS_ACTOR_ID ? FOCUS_HURT_FRACTION : HURT_FRACTION;
                    a.currentHp = maxHpOf(a) * fraction;
                }
            };
        default: {
            // Exhaustiveness guard: `undefined` is a legitimate return for 'plain', so a fourth
            // ScenarioName falling through the switch would silently run unseeded and still
            // produce a plausible-looking (but vacuous) snapshot. Force a compile error instead —
            // the spec DEFERS a status-seeded scenario, it does not cancel it.
            const exhaustive: never = scenario;
            throw new Error(`kitFingerprintScenarios: unhandled scenario ${String(exhaustive)}`);
        }
    }
}

/**
 * The scenario battle for one focus ship: the focus at FOCUS_POSITION on the player side with 3
 * inert filler allies, against 4 inert filler enemies (see FOCUS_POSITION for why those cells).
 * Only the seeded initial state varies by scenario. The focus ship keeps `canonicalPlacement`'s
 * un-modified level-60 base stats — no gear, no refits, no engineering — so its fingerprint
 * reflects its kit, not a gearing choice. The FILLER stats, by contrast, are tuned (HP, attack)
 * and are the only lever this fixture pulls on how hard the battle presses.
 */
export function buildScenarioBattle(
    focus: Ship,
    scenario: FingerprintScenario
): BattleSimulationInput {
    const board = boardFor(scenario);
    const enemyNames = FILLER_NAMES.slice(0, 4);
    const allyNames = FILLER_NAMES.slice(4, 7);
    const tap = seedFor(focus, scenario);
    const attack = fillerAttackFor(focus);
    return {
        playerTeam: [
            canonicalPlacement(focus, board.focus),
            ...allyNames.map((name, i) =>
                fillerPlacement(
                    name,
                    board.allies[i],
                    attack,
                    // Note `scenario === 'wounded'` and NOT the seeding branch: supportAnchor
                    // reuses wounded's HP seeding but must NOT get its fragile ally, because a
                    // dying support target would make reach flaky.
                    scenario === 'wounded' && i === 0 ? FRAGILE_ALLY_HP : FILLER_HP
                )
            ),
        ],
        enemyTeam: enemyNames.map((name, i) => fillerPlacement(name, board.enemies[i], attack)),
        rounds: ROUNDS,
        ...(tap ? { __testTapActors: tap } : {}),
    };
}

/** Fingerprint one ship across all three scenarios. Every battle goes through runSeededBattle —
 *  its `finally` restores Math.random rather than any ambient seed, so a raw simulateBattle call
 *  afterwards would be nondeterministic.
 *
 *  Lives here (rather than in the `.test.ts` file that consumes it) so both the vitest suite and
 *  `scripts/reportThinKitFingerprints.ts` (run under plain `tsx`, no vitest globals) can import it
 *  without importing a `.test.ts` module. */
export function fingerprintShip(ship: Ship): Record<ScenarioName, string[]> {
    const out = {} as Record<ScenarioName, string[]>;
    for (const scenario of SCENARIOS) {
        const result = runSeededBattle(buildScenarioBattle(ship, scenario), SEED);
        out[scenario] = fingerprintActorTokens(result, FOCUS_ACTOR_ID);
    }
    return out;
}

/** Corpus ship names, sorted for a stable order (CSV row order is not guaranteed). */
export function corpusNames(): string[] {
    return loadShipSkillRecords()
        .map((r) => r.name)
        .sort((a, b) => a.localeCompare(b));
}
