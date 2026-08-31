/**
 * Phase 4c (enemy-team PR1) — enemy attacker REACTIVE self-buffs.
 *
 * An enemy attacker walks the full runPlayerTurn pipeline bound to the heal target.
 * Its CAST abilities fire, but before this PR its REACTIVE abilities (e.g. a
 * `start-of-round` self Attack Up — Chakara-shaped) never fired:
 * buildEnemyPlayerActorRuntime partitions the enemy's reactive abilities onto the
 * runtime, but they were never registered as listeners (only the player-side
 * registerReactiveListeners ran), and even an enqueued enemy intent would throw in
 * the executor because enemy ids are absent from the player runtimes map.
 *
 * This is the RED characterization test: an enemy whose shipSkills carry a
 * `start-of-round` self Attack Up buff should hit HARDER than a control enemy with
 * no such buff, because the buff folds into its outgoing damage at its turn. The
 * assertion is on the per-round incoming damage to the tank (healing.rounds[].incomingDamage),
 * NOT internal state.
 *
 * RED baseline (before Task 2): the enemy's reactive `start-of-round` buff is never
 * registered/executed, so the buffed enemy deals the SAME incoming damage as the
 * control → `toBeGreaterThan` FAILS (equal values). (No throw is observed because
 * nothing enqueues an enemy intent in the first place — the listener was never
 * registered, so the executor's "no runtime for intent ownerId" path is never reached.)
 * After Task 2 the buff folds in and the buffed enemy hits harder → PASS.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { setRateGateRng, resetRateGateRng } from '../../calculators/rateAccumulator';
import { runCombat, CombatEngineInput } from '../engine';
import { Ability, ShipSkills } from '../../../types/abilities';
import { Ship } from '../../../types/ship';
import { GearPiece } from '../../../types/gear';
import { simulateBattle, BattlePlacement } from '../../calculators/battleSimulator';
import type { Position } from '../../../types/encounters';
import { flattenCombatLog } from '../log/__testutils__/flattenCombatLog';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `era${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

// A basic-attack active slot (100% / 1 hit). Folds the enemy's CURRENT effective attack —
// so a live self Attack Up buff couples straight into this hit's incoming damage.
const basicAttack = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } }),
    ],
});

// Chakara-shaped enemy: basic attack + a `start-of-round` self Attack Up (+100% attack,
// 99 turns). The reactive buff fires at the round head and folds into this same round's hit.
const buffedEnemy = (): EnemyAttacker => ({
    id: 'chakara',
    stats: { attack: 5000, crit: 0, critDamage: 0, speed: 50 },
    chargeCount: 0,
    startCharged: false,
    shipSkills: {
        slots: [
            basicAttack(),
            {
                slot: 'passive',
                abilities: [
                    ab({
                        type: 'buff',
                        target: 'self',
                        trigger: 'start-of-round',
                        config: {
                            type: 'buff',
                            buffName: 'Attack Up',
                            parsedEffects: { attack: 100 },
                            stacks: 1,
                            isStackable: false,
                            duration: 99,
                        },
                    }),
                ],
            },
        ],
    },
});

// Control: identical basic attack, NO reactive self-buff.
const controlEnemy = (): EnemyAttacker => ({
    id: 'control',
    stats: { attack: 5000, crit: 0, critDamage: 0, speed: 50 },
    chargeCount: 0,
    startCharged: false,
    shipSkills: { slots: [basicAttack()] },
});

// A `lowest-speed-ally`-gated (derivable) start-of-round self Attack Up — Chakara's REAL gate.
// The buff only folds in when the owner is the slowest on its (enemy) side.
const lowestSpeedGatedBuffSlot = (): ShipSkills['slots'][number] => ({
    slot: 'passive',
    abilities: [
        ab({
            type: 'buff',
            target: 'self',
            trigger: 'start-of-round',
            conditions: [{ subject: 'lowest-speed-ally', derivable: true }],
            config: {
                type: 'buff',
                buffName: 'Attack Up',
                parsedEffects: { attack: 100 },
                stacks: 1,
                isStackable: false,
                duration: 99,
            },
        }),
    ],
});

// Enemy carrying the `lowest-speed-ally`-gated start-of-round self Attack Up, at a given speed.
const gatedEnemy = (id: string, speed: number): EnemyAttacker => ({
    id,
    stats: { attack: 5000, crit: 0, critDamage: 0, speed },
    chargeCount: 0,
    startCharged: false,
    shipSkills: {
        slots: [basicAttack(), lowestSpeedGatedBuffSlot()],
    },
});

// Enemy carrying an UNGATED start-of-round self Attack Up (the existing buffedEnemy shape),
// at a given speed/id — used as the "everyone gets the buff" baseline.
const ungatedBuffedEnemy = (id: string, speed: number): EnemyAttacker => ({
    id,
    stats: { attack: 5000, crit: 0, critDamage: 0, speed },
    chargeCount: 0,
    startCharged: false,
    shipSkills: {
        slots: [
            basicAttack(),
            {
                slot: 'passive',
                abilities: [
                    ab({
                        type: 'buff',
                        target: 'self',
                        trigger: 'start-of-round',
                        config: {
                            type: 'buff',
                            buffName: 'Attack Up',
                            parsedEffects: { attack: 100 },
                            stacks: 1,
                            isStackable: false,
                            duration: 99,
                        },
                    }),
                ],
            },
        ],
    },
});

// A plain enemy with NO start-of-round buff, at a given speed/id.
const plainEnemy = (id: string, speed: number): EnemyAttacker => ({
    id,
    stats: { attack: 5000, crit: 0, critDamage: 0, speed },
    chargeCount: 0,
    startCharged: false,
    shipSkills: { slots: [basicAttack()] },
});

// An enemy whose ACTIVE slot grants an on-cast (no trigger) self Attack Up alongside its hit.
// This is the NON-reactive cast path, which already worked before PR1 — guards against regression.
const onCastSelfBuffEnemy = (): EnemyAttacker => ({
    id: 'oncast',
    stats: { attack: 5000, crit: 0, critDamage: 0, speed: 50 },
    chargeCount: 0,
    startCharged: false,
    shipSkills: {
        slots: [
            {
                slot: 'active',
                abilities: [
                    ab({
                        type: 'buff',
                        target: 'self',
                        config: {
                            type: 'buff',
                            buffName: 'Attack Up',
                            parsedEffects: { attack: 100 },
                            stacks: 1,
                            isStackable: false,
                            duration: 99,
                        },
                    }),
                    ab({
                        type: 'damage',
                        target: 'enemy',
                        config: { type: 'damage', multiplier: 100 },
                    }),
                ],
            },
        ],
    },
});

// Variant of BASE that accepts an arbitrary list of enemy attackers (multi-enemy scenarios).
const BASE_MULTI = (enemyAttackers: EnemyAttacker[]): CombatEngineInput => ({
    ...BASE(enemyAttackers[0]),
    enemyAttackers,
});

const BASE = (enemyAttacker: EnemyAttacker): CombatEngineInput => ({
    attack: 1000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [] },
    numRounds: 2,
    selfBuffs: [],
    enemyDebuffs: [],
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: 1_000_000_000, // huge tank HP so it survives both rounds and incoming damage is observable
    healTargetId: 'attacker',
    mode: 'healing',
    enemyAttackers: [enemyAttacker],
});

describe('enemy attacker reactive self-buffs (Chakara-as-enemy)', () => {
    it('a start-of-round self Attack Up makes the enemy hit the tank HARDER than a control', () => {
        idc = 0;
        const buffed = runCombat(BASE(buffedEnemy()));
        idc = 0;
        const control = runCombat(BASE(controlEnemy()));

        const buffedR1 = buffed.healing!.rounds[0].incomingDamage;
        const controlR1 = control.healing!.rounds[0].incomingDamage;
        const buffedR2 = buffed.healing!.rounds[1].incomingDamage;
        const controlR2 = control.healing!.rounds[1].incomingDamage;

        // The `start-of-round` buff lands at the round-1 head, BEFORE the enemy folds its
        // turn, so it already couples into the round-1 hit — pinning "fires at the round
        // head before the enemy acts".
        expect(buffedR1).toBeGreaterThan(controlR1);

        // The reactive buff folds +100% attack into the enemy's round-2 hit, so the buffed
        // enemy deals strictly more incoming damage to the tank than the un-buffed control.
        expect(buffedR2).toBeGreaterThan(controlR2);
    });

    // ── Task 3: lowest-speed-ally gate for enemies ────────────────────────────

    it('a lone enemy passes the lowest-speed-ally gate (it is trivially the slowest)', () => {
        // A single gated enemy: lowestSpeedEnemyIds = {its id}, so isLowestSpeedAlly → true,
        // the start-of-round Attack Up applies, and incoming damage exceeds a plain control
        // (no buff at all). This pins the lone-actor "trivially slowest" semantics on the
        // ENEMY side (mirroring the player-side default-true lone-actor assumption).
        idc = 0;
        const gated = runCombat(BASE(gatedEnemy('chakara', 50)));
        idc = 0;
        const control = runCombat(BASE(controlEnemy()));

        const gatedTotal =
            gated.healing!.rounds[0].incomingDamage + gated.healing!.rounds[1].incomingDamage;
        const controlTotal =
            control.healing!.rounds[0].incomingDamage + control.healing!.rounds[1].incomingDamage;

        // Gate resolves true for the lone enemy → buff folds in → harder hits than the
        // un-buffed control.
        expect(gatedTotal).toBeGreaterThan(controlTotal);
    });

    it('with two enemies of different speeds, only the SLOWER one passes the gate', () => {
        // Both enemies carry the SAME lowest-speed-ally-gated self Attack Up but at DIFFERENT
        // speeds. lowestSpeedEnemyIds = {the slower id only}, so the gate resolves:
        //   - slow enemy (speed 40): isLowestSpeedAlly → true  → buff folds in
        //   - fast enemy (speed 80): isLowestSpeedAlly → false → buff does NOT fold in
        //
        // Per-enemy incoming damage is not separable through the healing harness (it sums all
        // enemy hits into rounds[].incomingDamage). So we bracket the gated outcome between two
        // baselines that ARE observable:
        //   - BOTH ungated-but-buffed  → both enemies buffed (upper bound)
        //   - NEITHER buffed (plain)   → neither enemy buffed (lower bound)
        // If exactly ONE of the two gets the buff (the slowest), total incoming must sit
        // strictly between: less than "both buffed", more than "neither buffed". That window
        // is only reachable when exactly one enemy's buff folds in — proving "exactly the
        // slowest gets it".
        idc = 0;
        const gated = runCombat(BASE_MULTI([gatedEnemy('slow', 40), gatedEnemy('fast', 80)]));
        idc = 0;
        const bothBuffed = runCombat(
            BASE_MULTI([ungatedBuffedEnemy('slow', 40), ungatedBuffedEnemy('fast', 80)])
        );
        idc = 0;
        const neitherBuffed = runCombat(
            BASE_MULTI([plainEnemy('slow', 40), plainEnemy('fast', 80)])
        );

        const total = (r: ReturnType<typeof runCombat>) =>
            r.healing!.rounds.reduce((sum, round) => sum + round.incomingDamage, 0);

        const gatedTotal = total(gated);
        const bothTotal = total(bothBuffed);
        const neitherTotal = total(neitherBuffed);

        // Sanity: the two baselines bracket as expected (both-buffed hits hardest).
        expect(bothTotal).toBeGreaterThan(neitherTotal);

        // Exactly one enemy buffed → strictly between the two baselines.
        expect(gatedTotal).toBeGreaterThan(neitherTotal);
        expect(gatedTotal).toBeLessThan(bothTotal);
    });

    // ── Task 4: regression + isolation guards ─────────────────────────────────

    it('an enemy on-cast (non-reactive) self-buff still folds into its own hit', () => {
        // The on-cast self-buff path already worked before PR1; only the reactive
        // start-of-round path was dead. This guards the cast path against the
        // partition/registration change. The active slot applies a self Attack Up then hits,
        // so the buff couples into the SAME cast's outgoing damage → harder than a plain control.
        idc = 0;
        const onCast = runCombat(BASE(onCastSelfBuffEnemy()));
        idc = 0;
        const control = runCombat(BASE(controlEnemy()));

        const onCastTotal =
            onCast.healing!.rounds[0].incomingDamage + onCast.healing!.rounds[1].incomingDamage;
        const controlTotal =
            control.healing!.rounds[0].incomingDamage + control.healing!.rounds[1].incomingDamage;

        expect(onCastTotal).toBeGreaterThan(controlTotal);
    });

    it('an enemy start-of-round self-buff does NOT leak onto the player team', () => {
        // The enemy buff lands on the enemy id only; enemy recipient routing never touches
        // player ids. So a PLAYER-side figure — the player attacker's OWN outgoing damage
        // (result.rounds, the damage it deals into the enemy HP pool) — must be byte-identical
        // WITH vs WITHOUT the enemy self-buff. (incomingDamage WOULD differ, since that is the
        // enemy's own output folding the buff; the player's outgoing damage must be untouched.)
        idc = 0;
        const withBuff = runCombat(BASE(buffedEnemy()));
        idc = 0;
        const withoutBuff = runCombat(BASE(controlEnemy()));

        const playerDamage = (r: ReturnType<typeof runCombat>) =>
            r.rounds.map((round) => ({
                totalRoundDamage: round.totalRoundDamage,
                cumulativeDamage: round.cumulativeDamage,
                directDamage: round.directDamage,
            }));

        // Sanity: the enemy buff DID change the enemy's output (otherwise this guard is vacuous).
        expect(withBuff.healing!.rounds[1].incomingDamage).toBeGreaterThan(
            withoutBuff.healing!.rounds[1].incomingDamage
        );

        // Player-side outgoing damage is byte-identical — the enemy buff never leaked across.
        expect(playerDamage(withBuff)).toEqual(playerDamage(withoutBuff));
    });
});

// ---------------------------------------------------------------------------
// D-PR9 — team-agnostic mirror: Spearhead + Font of Power on the ENEMY side
// ---------------------------------------------------------------------------
//
// Tasks 1 & 3 added two implant abilities that ride team-agnostic engine machinery:
//   - Spearhead       — trigger `on-charged-cast` → grant all allies `Attack Up I` (1 turn)
//                        after a charged-skill cast (per-rarity proc).
//   - Font of Power   — trigger `on-own-repair-to-ally` → grant `Power Infused Nanobots`
//                        (flat attack = 100% of caster's attack, D-PR10) to every repaired NON-self ally (per-rarity proc).
//
// The engine registers reactive listeners for BOTH sides; the listeners self-scope via
// `e.actorId === ownerId` / `e.casterId === ownerId`. So an ENEMY-side carrier of either
// implant must produce the SAME behaviour on the enemy team. These tests are the mirror of
// the player-side D-PR9 tests in equipmentAbilities.integration.test.ts, with the carrier +
// the repaired/buffed ally moved onto the ENEMY team (a plain ship anchors the player team).
//
// Determinism: same back-loaded makeRateGate accumulator keyed `${ownerId}:${abilityId}`.
// There is NO proc=1 hook — we run enough qualifying casts that the accumulator fires and
// assert PRESENCE of the grant (Power Infused Nanobots now grants flat attack = 100% of caster's
// attack, D-PR10; magnitude is covered by the dedicated snapshot test in
// equipmentAbilities.integration.test.ts).
//
// EXPECTED: these tests PASS immediately if the engine is truly team-agnostic. A FAILURE
// here indicates a real side-routing regression, NOT a test bug.

describe('D-PR9 team-agnostic mirror — enemy-side Spearhead + Font of Power', () => {
    /** Minimal Ship stub (mirrors the integration-test harness). */
    const makeShip = (over: Partial<Ship>): Ship => ({
        id: 'test-ship',
        name: 'Test Ship',
        rarity: 'legendary',
        faction: 'TERRAN_COMBINE',
        type: 'Attacker',
        baseStats: {} as Ship['baseStats'],
        equipment: {},
        implants: {},
        refits: [],
        ...over,
    });

    /** Minimal legendary implant_major GearPiece stub for the given set bonus. */
    const makeImplant = (id: string, setBonus: string): GearPiece => ({
        id,
        slot: 'implant_major',
        level: 16,
        stars: 6,
        rarity: 'legendary',
        mainStat: null,
        subStats: [],
        setBonus,
    });

    const place = (
        ship: Ship,
        position: Position,
        attack: number,
        hp: number
    ): BattlePlacement => ({
        ship,
        position,
        statOverrides: {
            attack,
            crit: 0, // no crit variance
            critDamage: 0,
            defensePenetration: 0,
            hacking: 200,
            defence: 0,
            hp,
        },
    });

    /** Every actorId that ever received a GRANT of `label` (hierarchical combatLog).
     *  `entry.actorId` on a 'buff' entry is the GRANTER (post-granter-attribution); the
     *  recipient lives in `entry.targets`. */
    const buffedActors = (
        result: ReturnType<typeof simulateBattle>,
        label: string
    ): Set<string> => {
        const set = new Set<string>();
        for (const entry of flattenCombatLog(result)) {
            if (entry.kind === 'buff' && entry.note === label) {
                for (const t of entry.targets) set.add(t.targetId);
            }
        }
        return set;
    };

    const idsBySide = (
        result: ReturnType<typeof simulateBattle>,
        side: 'player' | 'enemy'
    ): string[] => result.roster.filter((r) => r.side === side).map((r) => r.actorId);

    const ROUNDS = 16;

    // ── Spearhead mirror ───────────────────────────────────────────────────
    describe('Spearhead on the ENEMY side', () => {
        // Spearhead's all-allies grant is procChance-gated (0.32). Force always-fire so the
        // grant fans on each charged cast, recovering the deterministic "fires ≥ once" intent.
        afterEach(() => resetRateGateRng());
        const ATTACK_UP_I = 'Attack Up I';
        const getGearPiece = (id: string): GearPiece | undefined =>
            id === 'spearhead-legendary'
                ? makeImplant('spearhead-legendary', 'SPEARHEAD')
                : undefined;

        const makeEnemyShip = (
            id: string,
            name: string,
            opts: { withSpearhead?: boolean; withCharge?: boolean } = {}
        ): Ship =>
            makeShip({
                id,
                name,
                type: 'Attacker',
                baseStats: {
                    hp: 0,
                    attack: 0,
                    defence: 0,
                    hacking: 200,
                    security: 100,
                    crit: 0,
                    critDamage: 0,
                    speed: 100,
                },
                implants: opts.withSpearhead ? { implant_major: 'spearhead-legendary' } : {},
                affinity: 'antimatter',
                activeSkillText: 'This Unit deals <unit-damage>100% damage</unit-damage>.',
                ...(opts.withCharge
                    ? {
                          chargeSkillText:
                              'This Unit deals <unit-damage>100% damage</unit-damage>.',
                          chargeSkillCharge: 1,
                      }
                    : { chargeSkillCharge: 0 }),
                activeTarget: 'front',
                activePattern: 'Pattern-Base',
            });

        it('an enemy carrier firing its CHARGED skill grants Attack Up I to every ENEMY ally; no PLAYER actor gets it', () => {
            setRateGateRng(() => 0); // always-fire the Spearhead procChance gate
            // Carrier + a plain ally on the ENEMY team. A plain ship anchors the PLAYER team.
            // Over 16 rounds the carrier fires CHARGED on even rounds → 8 charged casts →
            // floor(8 × 0.32) = 2 accumulator fires. Each fire fans the all-allies grant to
            // every ENEMY id (carrier + enemy ally).
            const result = simulateBattle(
                {
                    playerTeam: [
                        place(makeEnemyShip('pfocus', 'PlayerFocus'), 'M4', 5000, 1_000_000_000),
                    ],
                    enemyTeam: [
                        place(
                            makeEnemyShip('carrier', 'Carrier', {
                                withSpearhead: true,
                                withCharge: true,
                            }),
                            'M4',
                            5000,
                            1_000_000_000
                        ),
                        place(makeEnemyShip('ally', 'EnemyAlly'), 'M3', 5000, 1_000_000_000),
                    ],
                    rounds: ROUNDS,
                },
                getGearPiece
            );

            const buffed = buffedActors(result, ATTACK_UP_I);
            const enemyIds = idsBySide(result, 'enemy');
            const playerIds = idsBySide(result, 'player');

            // Two enemy allies on the roster (carrier + ally).
            expect(enemyIds.length).toBe(2);

            // Every ENEMY ally — including the carrier — got the buff at least once.
            for (const id of enemyIds) {
                expect(buffed.has(id)).toBe(true);
            }

            // Non-vacuous: at least one player actor exists, and NONE of them received it
            // (all-allies = the enemy carrier's OWN side only — never leaks to the player team).
            expect(playerIds.length).toBeGreaterThan(0);
            for (const id of playerIds) {
                expect(buffed.has(id)).toBe(false);
            }
        });
    });

    // ── Font of Power mirror ─────────────────────────────────────────────────
    describe('Font of Power on the ENEMY side', () => {
        const NANOBOTS = 'Power Infused Nanobots';
        const getGearPiece = (id: string): GearPiece | undefined =>
            id === 'font-legendary' ? makeImplant('font-legendary', 'FONT_OF_POWER') : undefined;

        const makeEnemyShip = (
            id: string,
            name: string,
            opts: { repair?: 'all-allies' | 'damage'; withFont?: boolean } = {}
        ): Ship => {
            const repair = opts.repair ?? 'damage';
            const activeSkillText =
                repair === 'all-allies'
                    ? 'This Unit repairs all allies for 30% of their Max HP.'
                    : 'This Unit deals <unit-damage>100% damage</unit-damage>.';
            return makeShip({
                id,
                name,
                type: repair === 'damage' ? 'Attacker' : 'Support',
                baseStats: {
                    hp: 0,
                    attack: 0,
                    defence: 0,
                    hacking: 200,
                    security: 100,
                    crit: 0,
                    critDamage: 0,
                    speed: 100,
                },
                implants: opts.withFont ? { implant_major: 'font-legendary' } : {},
                affinity: 'antimatter',
                activeSkillText,
                chargeSkillCharge: 0,
                activeTarget: repair === 'damage' ? 'front' : 'allies',
                activePattern: 'Pattern-Base',
            });
        };

        it('an enemy carrier that repairs its own side grants Power Infused Nanobots to that ally AND to itself; no PLAYER actor gets it', () => {
            // ENEMY carrier (support, AoE all-allies repair) + a plain enemy ally that is the
            // repaired NON-self recipient. A plain ship anchors the PLAYER team. The carrier
            // repairs every enemy ally each round → the OTHER enemy ally is a non-self
            // recipient. Over 16 casts the accumulator fires → that ally carries the buff.
            // PRESENCE only — this test covers the grant mechanic (correct ally, correct side).
            // Power Infused Nanobots now grants flat attack = 100% of caster's attack (D-PR10);
            // magnitude is covered by the dedicated snapshot test in equipmentAbilities.integration.test.ts.
            const result = simulateBattle(
                {
                    playerTeam: [
                        place(makeEnemyShip('pfocus', 'PlayerFocus'), 'M4', 5000, 1_000_000_000),
                    ],
                    enemyTeam: [
                        place(
                            makeEnemyShip('carrier', 'Carrier', {
                                repair: 'all-allies',
                                withFont: true,
                            }),
                            'M3',
                            0,
                            1_000_000_000
                        ),
                        place(makeEnemyShip('ally', 'EnemyAlly'), 'M4', 5000, 1_000_000_000),
                    ],
                    rounds: ROUNDS,
                },
                getGearPiece
            );

            const buffed = buffedActors(result, NANOBOTS);
            // Enemy ids are minted `e:<shipId>:<idx>` in placement order.
            const CARRIER = 'e:carrier:0';
            const ENEMY_ALLY = 'e:ally:1';
            const playerIds = idsBySide(result, 'player');

            // The repaired ENEMY ally carries the buff at least once.
            expect(buffed.has(ENEMY_ALLY)).toBe(true);
            // …and so does the carrier: its own all-allies repair reaches itself, and #444 ruled
            // that a self-heal procs the implant. Team-symmetric with the player-side case in
            // equipmentAbilities.integration.test.ts.
            expect(buffed.has(CARRIER)).toBe(true);
            // Non-vacuous: a player actor exists, and NONE received it (ally-side only,
            // and the enemy carrier's own side at that — never leaks to the player team).
            expect(playerIds.length).toBeGreaterThan(0);
            for (const id of playerIds) {
                expect(buffed.has(id)).toBe(false);
            }
        });
    });
});
