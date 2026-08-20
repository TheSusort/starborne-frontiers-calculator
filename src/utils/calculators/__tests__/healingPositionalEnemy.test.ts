/**
 * healingPositionalEnemy.test.ts — SP-3b Task 6.
 *
 * The healing calculator now fights a REAL, POSITIONED enemy roster instead of the dummy
 * punching bag (a fixed 10,000-defence / 1,000,000-HP sink that never died and never really
 * participated). Three properties only a positional run can satisfy:
 *
 *   1. a `basis:'damage-dealt'` rider scales off the REAL enemy's defence, so a tougher enemy
 *      repairs the healer less;
 *   2. an enemy that can DIE stops contributing incoming damage;
 *   3. the focus's damage is credited PER VICTIM against the real enemy id.
 *
 * (3) is the only non-silent proof the positional apply actually ran: with a target but no
 * pattern the cast still resolves onto the real enemy and still credits a plausible cumulative
 * damage number, while `perTargetDealt` comes back EMPTY (engine.ts:8344).
 */
import { describe, it, expect } from 'vitest';
import { simulateHealing, HealingSimulationInput, HealerStats } from '../healingEngineAdapter';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { TeamActorInput } from '../../../types/calculator';
import type { Position } from '../../../types/encounters';
import { createEventBus } from '../../combat/events';
import { parsePattern, parseTarget } from '../../targetingParser';

/** The engine keys the focus actor as `'attacker'`, never the page's ship id. */
const FOCUS_ID_IN_ENGINE = 'attacker';

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `sp3b_${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

const HEALER: HealerStats = {
    hp: 50_000,
    attack: 10_000,
    defence: 2_000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    healModifier: 0,
    hacking: 200,
    speed: 300,
};

/** A damage cast that also repairs 50% of the damage it dealt — the F7 rider path. */
const damageWithRider = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                ab({
                    type: 'damage',
                    target: 'enemy',
                    config: { type: 'damage', multiplier: 100 },
                }),
                ab({
                    type: 'heal',
                    target: 'self',
                    config: { type: 'heal', pct: 50, basis: 'damage-dealt' },
                }),
            ],
        },
    ],
});

const enemy = (id: string, defence: number, hp: number) => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, speed: 1, defence, hp, security: 100 },
    chargeCount: 0,
    startCharged: false,
    position: 'M4' as const,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
});

const BASE = (o: Partial<HealingSimulationInput> = {}): HealingSimulationInput => ({
    healer: HEALER,
    chargeCount: 0,
    shipSkills: damageWithRider(),
    selfBuffs: [],
    healTargetId: 'healer',
    enemies: [enemy('enemy-1', 1_000, 500_000)],
    rounds: 1,
    healerPosition: 'M3',
    healerTargeting: {
        active: { target: parseTarget('front'), pattern: parsePattern('Pattern-Base') },
    },
    ...o,
});

describe('SP-3b: the healing calculator fights a real positioned enemy', () => {
    it("the damage-dealt rider bases off the REAL enemy's defence, not ENEMY_DEFENSE", () => {
        idc = 0;
        const low = simulateHealing(BASE({ enemies: [enemy('enemy-1', 1_000, 500_000)] }));
        const high = simulateHealing(BASE({ enemies: [enemy('enemy-1', 9_000, 500_000)] }));

        // Anti-vacuity: the two candidate bases must actually differ in this fixture, or the
        // assertion pins nothing. A tougher enemy takes less damage, so the rider repairs less.
        expect(low.summary.totalDirectHeal).toBeGreaterThan(0);
        expect(high.summary.totalDirectHeal).toBeGreaterThan(0);
        expect(low.summary.totalDirectHeal).not.toBe(high.summary.totalDirectHeal);
        expect(low.summary.totalDirectHeal).toBeGreaterThan(high.summary.totalDirectHeal);
    });

    it('a killable enemy stops contributing incoming damage', () => {
        idc = 0;
        // ⚠️ ANTI-VACUITY, load-bearing. The enemy must land at least one hit BEFORE dying, or
        // "no incoming damage after round 1" is trivially true and the test observes nothing.
        // Turn order is speed-driven, so the enemy is given speed 999 (> the healer's 300) to act
        // FIRST in round 1; it then dies to the healer's cast in that same round.
        // Window kept TIGHT (3 rounds): over a long window the focus kills everything and the
        // premise evaporates — SP-1's earned lesson.
        const glassCannon = {
            ...enemy('enemy-1', 0, 1),
            stats: {
                attack: 5_000,
                crit: 0,
                critDamage: 0,
                speed: 999,
                defence: 0,
                hp: 1,
                security: 100,
            },
        };
        // Tap `ship-destroyed` so the test asserts the CAUSE (the enemy died), not just the
        // symptom (incoming stopped). Without this, "no incoming after round 1" would also pass
        // if the enemy merely stopped resolving a target for some unrelated reason.
        const bus = createEventBus();
        const destroyed: string[] = [];
        bus.on('ship-destroyed', (e) => destroyed.push(e.actorId));
        const result = simulateHealing(BASE({ rounds: 3, enemies: [glassCannon], bus }));

        // Precondition: it DID hit in round 1. Without this the assertion below is vacuous.
        expect(result.rounds[0].incomingDamage).toBeGreaterThan(0);
        // It actually DIED — the cause of the silence below.
        expect(destroyed).toContain('enemy-1');
        // And it died, so rounds 2-3 take nothing.
        const laterIncoming = result.rounds.slice(1).reduce((n, r) => n + r.incomingDamage, 0);
        expect(laterIncoming).toBe(0);
    });

    it('credits damage per-victim against the REAL enemy, not the legacy sink', () => {
        idc = 0;
        const result = simulateHealing(BASE());
        // A non-empty perTargetDealt is the positional-apply proof. Asserting the damage TOTAL
        // alone would pass even if the cast fell back to the legacy sink, because the legacy path
        // still credits a plausible cumulative number (SP-1's silent-failure lesson).
        const dealt = result.rounds[0].perTargetDealt;
        expect(dealt).toBeDefined();
        expect(Object.keys(dealt![FOCUS_ID_IN_ENGINE] ?? {})).toContain('enemy-1');
    });

    // ── A TEAM actor's cast lands on the real enemy too, not the sink ────────────────
    //
    // A team actor's parsed axes are sourced ONLY from `teamTargetById`/`teamPatternById`, so
    // `position` alone was not enough: without target AND pattern the actor's cast fell back to
    // `legacyVictim` — the 10,000-defence sink — and every `basis:'damage-dealt'` rider it owns
    // computed off THAT defence (measured 2579 vs 7753 here, a ~3× error surfacing as
    // `teamHealing`). NO golden fixture covers this (every golden team actor carries an empty or
    // heal-only kit), so this is the only guard for it. SP-4b-1 note: the missing-axes premise is
    // no longer reachable through `runCombat` — `normalizeCombatRoster` fills both — so what this
    // test now guards is the ROUTING (a walked team actor's damage credits the real enemy), not
    // the adapter's fill.
    it("a walked team actor's damage credits the REAL enemy, not the legacy sink", () => {
        idc = 0;
        const allyDamage: TeamActorInput = {
            id: 'ally',
            speed: 50,
            chargeCount: 0,
            startCharged: false,
            selfBuffs: [],
            enemyDebuffs: [],
            position: 'M1',
            shipSkills: {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            ab({
                                type: 'damage',
                                target: 'enemy',
                                config: { type: 'damage', multiplier: 100 },
                            }),
                        ],
                    },
                ],
            },
            stats: {
                attack: 10_000,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 1_000,
                hp: 50_000,
            },
        };
        const result = simulateHealing(
            BASE({
                // The focus contributes nothing, so the only cast measured is the team actor's.
                shipSkills: { slots: [] },
                teamActors: [allyDamage],
                enemies: [enemy('enemy-1', 1_000, 500_000)],
            })
        );
        // Per-victim credit keyed by the REAL enemy id is the positional-apply proof: the sink path
        // credits a plausible cumulative number while leaving this map empty.
        expect(result.rounds[0].perTargetDealt?.ally).toBeDefined();
        expect(Object.keys(result.rounds[0].perTargetDealt!.ally)).toEqual(['enemy-1']);
        expect(result.rounds[0].perTargetDealt!.ally['enemy-1']).toBeGreaterThan(0);
    });

    // GROSS repair that landed on ONE recipient, from the RECIPIENT axis. Every actor on these
    // boards sits at full HP, so the landed share is 100% overheal and `totalEffectiveHealing`
    // alone reads 0 for everybody — the sum of the two is the observable.
    //
    // ⚠️ WHY NOT `summary.totalHealing` (which these cases used before SP-4e Task 4): that field is
    // the SOURCE axis — the healer's own gross output, summed over however many recipients its cast
    // reached. Task 4 made a plain `'ally'` heal route over the caster's target pattern instead of
    // to `[healing.targetId]`, and the healer stands on its OWN support footprint, so every board
    // below now has (at least) two recipients and the source-axis total doubled. That widening is
    // the new rule, not a regression; what these cases are actually about is whether the repair
    // reaches the HEAL TARGET, which is a recipient-axis question.
    const receivedBy = (
        summary: {
            perRecipient?: Record<string, { totalEffectiveHealing: number; totalOverheal: number }>;
        },
        id: string
    ): number => {
        const row = summary.perRecipient?.[id];
        return row === undefined ? 0 : row.totalEffectiveHealing + row.totalOverheal;
    };

    // ── The support footprint gates which allies a heal reaches ──────────────────────
    //
    // ⚠️ THE ZERO BELOW IS INTENDED BEHAVIOUR (owner ruling, 2026-08-12). `resolveSupportRecipients`
    // FILTERS the recipient list by the caster's support footprint and never expands it, so a heal
    // target standing off that footprint receives NOTHING AT ALL. Do NOT "fix" this by adding a
    // fallback recipient, widening the filter, or falling back to the configured target — it is
    // game-faithful. Correct DEFAULT placement (`defaultHealTargetSlot`) is the only permitted
    // mitigation, which is exactly what the third leg pins.
    it('a support pattern gates heal recipients; the DEFAULT slot lands inside the footprint', () => {
        const tank = (position?: 'M1' | 'M3'): TeamActorInput => ({
            id: 'tank',
            speed: 10,
            chargeCount: 0,
            startCharged: false,
            selfBuffs: [],
            enemyDebuffs: [],
            ...(position ? { position } : {}),
            // A walk bundle is REQUIRED for `stats` to reach the engine: `deriveTeamEngineActors`
            // classifies an actor with no `shipSkills` as LEGACY (`!t.shipSkills || !t.stats`) and
            // gives it hp 1 / defence 0, leaving the 200,000 below inert. Harmless for the raw
            // totals asserted here, but one edit from vacuity if anyone asserts on `targetHpPct` or
            // `overheal` — same reason the affinity fixture below walks a kit.
            shipSkills: { slots: [] },
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 0,
                hp: 200_000,
            },
        });
        /** Heals the configured ally for 40% of the CASTER's hp → 50,000 × 40% = 20,000. */
        const allyHeal = (): ShipSkills => ({
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({
                            type: 'heal',
                            target: 'ally',
                            config: { type: 'heal', pct: 40, basis: 'hp' },
                        }),
                    ],
                },
            ],
        });
        const run = (position?: 'M1' | 'M3') => {
            idc = 0;
            return simulateHealing(
                BASE({
                    shipSkills: allyHeal(),
                    healTargetId: 'tank',
                    teamActors: [tank(position)],
                    healerPosition: 'M2',
                    healerTargeting: {
                        active: {
                            target: parseTarget('front'),
                            // A real SUPPORT pattern — the whole point. Every other healing fixture
                            // uses a non-support pattern, which never filters ally recipients at all
                            // (`supportFootprintAllyIds` returns undefined), so none of them can
                            // observe this.
                            pattern: parsePattern('Pattern-Line-Support-Range-1'),
                        },
                    },
                })
            );
        };

        // ANTI-VACUITY ANCHOR: on-footprint the heal is real (the full 50,000 x 40%), so the zero
        // below is about coverage and not about a kit that simply never heals.
        expect(receivedBy(run('M3').summary, 'tank')).toBe(20_000);
        // Off-footprint: nothing lands ON THE TANK. INTENDED — see the block comment above.
        expect(receivedBy(run('M1').summary, 'tank')).toBe(0);
        // …and a SECOND anti-vacuity guard on that zero: the same run still pays the healer its own
        // share (it stands on its own footprint), so the cast demonstrably fired and the tank's
        // zero is the footprint filter's doing, not a dead run.
        expect(receivedBy(run('M1').summary, FOCUS_ID_IN_ENGINE)).toBe(20_000);
        // The DEFAULT (no explicit position anywhere) must land INSIDE the footprint, or the
        // out-of-the-box page reports zero healing for the ship the user is measuring. This is the
        // regression guard for wiring `defaultHealTargetSlot` into the adapter's player-slot
        // resolution.
        expect(receivedBy(run().summary, 'tank')).toBe(20_000);
    });

    // ── The heal target's covered cell SURVIVES a crowded board ──────────────────────
    //
    // `defaultHealTargetSlot` picks a cell the healer's support footprint covers, but that cell is
    // often one `defaultHealingTeamSlot` also hands out (its order starts 'M1','T2','T3','B2'). The
    // page appends the heal target LAST (`[...teamActors, targetActor]`), so without a priority pass
    // an earlier generic ally claims the cell first and the heal target gets EVICTED to the first
    // free cell in `ATTACKER_SLOT_OPTIONS` order — a cell chosen with no knowledge of coverage.
    // Measured before the fix, healer @ M2 with `Pattern-Cone-Support-Range-1`: a0→M1, a1→T2,
    // a2→T3, tank→T2 collides → evicted to T1, which is OUTSIDE the cone's covered set
    // {M2,T2,M3,B2} → totalHealing 0 where the same board alone yields 20,000.
    //
    // The fix is placement PRIORITY (the heal target's wanted cell is reserved before the generic
    // team slots), never a widened footprint or a fallback recipient — the off-footprint zero itself
    // stays intact (pinned by the fixture above).
    it('a crowded board does not evict the heal target off its covered cell', () => {
        const filler = (id: string, position?: Position): TeamActorInput => ({
            id,
            speed: 10,
            chargeCount: 0,
            startCharged: false,
            selfBuffs: [],
            enemyDebuffs: [],
            // UNPOSITIONED by default — that is what makes these allies compete for the
            // index-derived default cells, and it is the shape the page sends for a ship the user has
            // not placed. The third leg below passes EXPLICIT cells instead, which is a different
            // ruling entirely (the user wins, and the heal target may be left healing nobody).
            ...(position ? { position } : {}),
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 0,
                hp: 200_000,
            },
        });
        const tank: TeamActorInput = { ...filler('tank'), shipSkills: { slots: [] } };
        /** Heals the configured ally for 40% of the CASTER's hp → 50,000 × 40% = 20,000. */
        const allyHeal = (): ShipSkills => ({
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({
                            type: 'heal',
                            target: 'ally',
                            config: { type: 'heal', pct: 40, basis: 'hp' },
                        }),
                    ],
                },
            ],
        });
        const run = (allies: TeamActorInput[]) => {
            idc = 0;
            return simulateHealing(
                BASE({
                    shipSkills: allyHeal(),
                    healTargetId: 'tank',
                    // Generic allies first, heal target LAST — the order the page appends in.
                    teamActors: allies,
                    healerPosition: 'M2',
                    healerTargeting: {
                        active: {
                            target: parseTarget('front'),
                            // Cone @ M2 covers {M2,T2,M3,B2}; T2 is also defaultHealingTeamSlot(1).
                            pattern: parsePattern('Pattern-Cone-Support-Range-1'),
                        },
                    },
                })
            );
        };

        // Every leg pins the VALUE, not a floor. `toBeGreaterThan(0)` would stay green if a partial
        // regression evicted the heal target onto a DIFFERENT covered cell and the heal landed on
        // some other recipient instead — 20,000 is the caster's hp 50,000 x 40%, i.e. the full cast
        // landing ON THE HEAL TARGET. (Since Task 4 the same cast ALSO pays the healer its own
        // share; that is the plain-`'ally'` pattern rule and is not what these legs measure.)
        expect(receivedBy(run([tank]).summary, 'tank')).toBe(20_000);
        // Crowded, allies UNPOSITIONED: they compete for the index-derived defaults, and the heal
        // target's coverage-aware default still wins T2.
        expect(
            receivedBy(run([filler('a0'), filler('a1'), filler('a2'), tank]).summary, 'tank')
        ).toBe(20_000);
        // ⚠️ THE OTHER DIRECTION, AND IT IS A ZERO — pinned deliberately, and NOT a bug to fix here.
        // Same board, but the allies now carry EXPLICIT cells, one of them (T2) the very cell the
        // heal target's coverage-aware default wants. `contestedByExplicit` therefore drops the heal
        // target's nomination, the explicit ally keeps T2 (as `healingPlacement.test.ts` pins), and
        // the heal target lands on T1 — outside the cone → nothing lands. Owner-ruled game-faithful:
        // the user's placement is authoritative and the off-footprint zero is never softened.
        //
        // It is pinned because it is the CONSEQUENCE a caller must not manufacture. The healing page
        // used to send exactly this shape for allies the user had never touched — it seeded
        // `defaultHealingTeamSlot(index)` straight into team-ship state, so an untouched ship was
        // indistinguishable from a deliberate placement and a freshly-configured page reported 0.
        // The page-side guard is in `HealingCalculatorPage.test.tsx` ('a default team ship does not
        // evict the heal target off its covered cell'); this leg is why that guard has to exist.
        const explicit = run([
            filler('a0', 'M1'),
            filler('a1', 'T2'),
            filler('a2', 'T3'),
            tank,
        ]).summary;
        expect(receivedBy(explicit, 'tank')).toBe(0);
        // Anti-vacuity on that zero: `a1` holds the contested T2, which the cone DOES cover, so the
        // cast fired and paid a full share to the ally that took the heal target's cell.
        expect(receivedBy(explicit, 'a1')).toBe(20_000);
    });

    // ── The measured Volk board: one team ship, unplaced heal target ─────────────────
    //
    // The narrowest board the healing page can present — a single team ship and a heal target the
    // user has not placed — and the one where seeding display defaults into state cost EVERYTHING.
    // Volk's active pattern is `Pattern-Line-Support-from-centre-Range-1`, which from M2 covers
    // {M2, M1, M3}, so the heal target's coverage-aware default is M1 — and `defaultHealingTeamSlot(0)`
    // is ALSO M1. The two legs below differ ONLY in whether that team ship's M1 is presented as a
    // deliberate placement, and they differ by the whole cast.
    //
    // The cone fixture above cannot substitute: its covered set starts T2, which only collides with
    // `defaultHealingTeamSlot(1)`, so it needs a crowded board to reach the contest at all. This
    // pattern collides on the FIRST team ship, which is why a default page hit it.
    it('a single default team ship leaves the heal target covered; an explicit one takes its cell', () => {
        const ally = (position?: Position): TeamActorInput => ({
            id: 'a0',
            speed: 10,
            chargeCount: 0,
            startCharged: false,
            selfBuffs: [],
            enemyDebuffs: [],
            ...(position ? { position } : {}),
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 0,
                hp: 200_000,
            },
        });
        const tank: TeamActorInput = { ...ally(), id: 'tank', shipSkills: { slots: [] } };
        const run = (allyPosition?: Position) => {
            idc = 0;
            return simulateHealing(
                BASE({
                    shipSkills: {
                        slots: [
                            {
                                slot: 'active',
                                abilities: [
                                    ab({
                                        type: 'heal',
                                        target: 'ally',
                                        config: { type: 'heal', pct: 40, basis: 'hp' },
                                    }),
                                ],
                            },
                        ],
                    },
                    healTargetId: 'tank',
                    teamActors: [ally(allyPosition), tank],
                    healerPosition: 'M2',
                    healerTargeting: {
                        active: {
                            target: parseTarget('front'),
                            pattern: parsePattern('Pattern-Line-Support-from-centre-Range-1'),
                        },
                    },
                })
            );
        };

        // The shape the page sends: the team ship is UNPLACED, so the heal target's coverage-aware
        // default claims M1 and the generic ally is the one that gives way. Full share lands on it.
        expect(receivedBy(run().summary, 'tank')).toBe(20_000);
        // The shape the page used to send for a ship the user had never touched. The explicit M1 wins
        // (correctly — owner ruling), the heal target is pushed to T1, and the heal reaches IT not at
        // all. This measured 0 on a freshly configured page; it must only ever be reachable on
        // purpose. Anti-vacuity: the explicit ally at M1 is covered and takes a full share.
        const pushed = run('M1').summary;
        expect(receivedBy(pushed, 'tank')).toBe(0);
        expect(receivedBy(pushed, 'a0')).toBe(20_000);
    });

    // ── An ALLY-SIDE active target must not bind the dummy ───────────────────────────
    //
    // ⚠️ THE MAJORITY PRODUCTION CONFIG, and it silently delivered ZERO.
    // `resolvePositionalTarget` returns `null` for `target.side === 'ally'`
    // (positionalBinding.ts), so `selectTurnTarget` falls back to `tb.legacyVictim` — the
    // vestigial dummy. But `willApplyPositionally` (the focus cast site in engine.ts) checks only
    // `resolvesPositionalVictim && target != null && pattern != null` and NEVER the target's side,
    // so it stays TRUE while the bound victim is the position-less dummy; the positional apply then resolves
    // footprint victims from `tgt.position === undefined`, finds none, and delivers nothing.
    //
    // `docs/ship-targeting.csv` has 20 ships with an ally-side `active_target` — AEGIS, Chimei,
    // Cultivator, Flamel, Graphite, Grif, Harvester, Hayyan, Heliodor, Hermes, Howler, Makoli,
    // Meatshield, Nyxen, Oleander, Paracelsus, Salvation, Sentinel, Shelter, Volk — i.e. the whole
    // healer roster this calculator exists for, and the page passes each one's REAL parsed targeting.
    // Corpus-inert today only because all 20 wrap a repair/shield percentage in `<unit-damage>` rather
    // than carrying a real damage clause, so nothing pins it but the headline "nothing reaches the
    // dummy" claim. The adapter substitutes `DEFAULT_FRONT_ENEMY_TARGET` for the ally-side axis; the
    // support footprint rides `pattern`, which is threaded separately and untouched (proved by the
    // footprint fixtures above, which keep their ally-side `allies` targeting).
    it('an ally-side ACTIVE target still binds a real enemy: the rider tracks enemy defence', () => {
        /** The Volk shape: ally-side active target + a real support pattern. */
        const allyActive = (defence: number) =>
            simulateHealing(
                BASE({
                    enemies: [enemy('enemy-1', defence, 500_000)],
                    healerPosition: 'M2',
                    healerTargeting: {
                        active: {
                            target: parseTarget('allies'),
                            pattern: parsePattern('Pattern-Cone-Support-Range-1'),
                        },
                    },
                })
            );

        idc = 0;
        const low = allyActive(1_000);
        idc = 0;
        const high = allyActive(9_000);

        // THE TRIPWIRE: the `damage-dealt` rider must be SENSITIVE to the enemy's defence. Before the
        // substitution both legs were 0 — no sensitivity, and `toBeGreaterThan(0)` alone would not
        // have caught it either, which is why the pair is asserted and not just one leg.
        expect(low.summary.totalDirectHeal).toBeGreaterThan(0);
        expect(high.summary.totalDirectHeal).toBeGreaterThan(0);
        expect(low.summary.totalDirectHeal).toBeGreaterThan(high.summary.totalDirectHeal);
        // And the per-victim apply really ran against the REAL enemy — the only non-silent proof
        // (the dummy path credits a plausible number while leaving this map empty/undefined).
        expect(Object.keys(low.rounds[0].perTargetDealt?.[FOCUS_ID_IN_ENGINE] ?? {})).toContain(
            'enemy-1'
        );
    });

    // ── An enemy's OWN parsed pattern drives its footprint ───────────────────────────
    //
    // The axis the healing page fills from `targetingOf(getShipById(e.shipId))` since the SP-3b review
    // (spec decision 4: targeting comes from EVERY actor's parsed skill targeting, not just the
    // healer's). Before that, `enemyInputs` supplied `position` but never `target`/`pattern`, so every
    // enemy — including a real ship the user picked — defaulted to single-target FRONT and an enemy AoE
    // attacker hit exactly ONE player ship. That understates incoming pressure on a spread board and
    // makes defensive placement inert against the enemy side.
    it("an enemy's own AoE pattern hits its real footprint, not one ship", () => {
        const walked = (id: string, position: Position): TeamActorInput => ({
            id,
            speed: 10,
            chargeCount: 0,
            startCharged: false,
            selfBuffs: [],
            enemyDebuffs: [],
            position,
            // A walk bundle is REQUIRED for `stats` to reach the engine (`deriveTeamEngineActors`
            // classifies a bundle-less actor as LEGACY and hands it hp 1 / defence 0), so without it
            // both legs would kill the allies outright and observe nothing.
            shipSkills: { slots: [] },
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 0,
                hp: 200_000,
            },
        });
        /** Speed 999 so the enemy acts; `front` anchors on the player's front-most cell (col 4 = front,
         *  so among {M1, M2, M3} that is M3 — the healer). */
        const aoeEnemy = (pattern: 'Pattern-Base' | 'Pattern-Circle-Range-1') => ({
            id: 'enemy-1',
            stats: {
                attack: 5_000,
                crit: 0,
                critDamage: 0,
                speed: 999,
                defence: 0,
                hp: 1_000_000,
                security: 100,
            },
            chargeCount: 0,
            startCharged: false,
            position: 'M4' as const,
            target: parseTarget('front'),
            pattern: parsePattern(pattern),
        });
        const run = (pattern: 'Pattern-Base' | 'Pattern-Circle-Range-1') => {
            idc = 0;
            return simulateHealing(
                BASE({
                    rounds: 1,
                    shipSkills: { slots: [] },
                    healTargetId: 'ally-mid',
                    teamActors: [walked('ally-mid', 'M2'), walked('ally-back', 'M1')],
                    enemies: [aoeEnemy(pattern)],
                    healerPosition: 'M3',
                })
            );
        };

        // Single-target: only the anchor (the healer at M3) is hit.
        const single = run('Pattern-Base');
        expect(Object.keys(single.rounds[0].perTargetDealt?.['enemy-1'] ?? {})).toEqual([
            FOCUS_ID_IN_ENGINE,
        ]);
        // Circle-Range-1 from M3 also covers M2 — the ally the healer is keeping alive. The
        // difference between these two legs is exactly what the page's missing `pattern` erased.
        const aoe = run('Pattern-Circle-Range-1');
        const victims = Object.keys(aoe.rounds[0].perTargetDealt?.['enemy-1'] ?? {});
        expect(victims).toContain(FOCUS_ID_IN_ENGINE);
        expect(victims).toContain('ally-mid');
        // And it shows up where the user reads it: the heal target now takes incoming damage.
        expect(single.summary.totalIncomingDamage).toBe(0);
        expect(aoe.summary.totalIncomingDamage).toBeGreaterThan(0);
    });

    // ── healTargetAffinity reaches a TEAM heal target, not just the focus ────────────
    //
    // The adapter threads `healTargetAffinity` onto whichever actor IS the heal target. Every other
    // affinity fixture in the repo uses `healTargetId: 'healer'`, so they only ever exercise the
    // FOCUS branch (`focusAffinity`). This pins the TEAM branch — the page's non-self-heal path.
    //
    // ⚠️ TRAP: the raw affinity reaches the engine actor via `t.walk?.affinity`, so a team actor
    // with no `shipSkills`/`stats` (hence no walk) silently drops it and this fixture would measure
    // neutral in both legs. Both actors below therefore walk a kit.
    it('healTargetAffinity applies when the heal target is a TEAM actor, and only to it', () => {
        const walked = (id: string, position: 'M3' | 'M4'): TeamActorInput => ({
            id,
            speed: 10,
            chargeCount: 0,
            startCharged: false,
            selfBuffs: [],
            enemyDebuffs: [],
            position,
            // A walk bundle is REQUIRED for the raw affinity to reach the engine actor (see above).
            shipSkills: { slots: [] },
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 0,
                hp: 200_000,
            },
        });
        /** thermal enemy at speed 999 (acts first), hitting the FRONT cell — the tank at M4. */
        const thermalEnemy = {
            id: 'enemy-1',
            stats: {
                attack: 4_000,
                crit: 0,
                critDamage: 0,
                speed: 999,
                defence: 0,
                hp: 1_000_000,
            },
            chargeCount: 0,
            startCharged: false,
            affinity: 'thermal' as const,
            position: 'M4' as const,
            target: parseTarget('front'),
            pattern: parsePattern('Pattern-Base'),
        };
        const run = (healTargetId: 'tank' | 'ally') => {
            idc = 0;
            return simulateHealing(
                BASE({
                    shipSkills: { slots: [] },
                    healTargetId,
                    // chemical LOSES to thermal → +25% for the enemy vs whoever carries it.
                    healTargetAffinity: 'chemical',
                    teamActors: [walked('tank', 'M4'), walked('ally', 'M3')],
                    enemies: [thermalEnemy],
                    healerPosition: 'M2',
                })
            );
        };
        // Same board, same victim (the tank at the front) in both legs — the ONLY difference is
        // whether the tank is the heal target and therefore carries `healTargetAffinity`.
        const tankIsTarget = run('tank').rounds[0].perTargetDealt?.['enemy-1']?.tank;
        const allyIsTarget = run('ally').rounds[0].perTargetDealt?.['enemy-1']?.tank;

        // Positive leg: the team heal target carries chemical → thermal's +25% advantage lands.
        expect(tankIsTarget).toBe(5_000);
        // Negative leg: the SAME actor, now merely an ally and not the heal target, stays neutral.
        expect(allyIsTarget).toBe(4_000);
    });
    // ── An INVENTED enemy slot must yield to an EXPLICIT one (task 5d, Fix 4) ────────────
    //
    // `healingEngineAdapter` pre-resolved `e.position ?? defaultEnemySlot(i)` and handed the result
    // to `resolveEnemySlots` as a SINGLE argument, discarding which cells the caller actually asked
    // for. `resolvePlayerSlots` then reserved index 0 first unconditionally — so when enemy #0 is
    // UNPLACED, its INVENTED default (`defaultEnemySlot(0)` === 'M4') claimed M4 ahead of an enemy
    // the caller had EXPLICITLY put there, evicting that explicit enemy to the first free cell.
    //
    // This is the same defect class commit 3952a6a0 fixed inside the normalization boundary, one
    // layer up and reachable from the healing page (a user who places one enemy and leaves another
    // on "auto" hits it). The observable is WHICH enemy the healer's `front`-selecting cast lands on:
    // column 4 is the front, so the M4 occupant takes the hit.
    it('an UNPLACED enemy does not evict an explicitly-placed one from its cell', () => {
        idc = 0;
        // Identical stats so the two are distinguishable ONLY by id and by placement.
        const auto = { ...enemy('enemy-auto', 1_000, 500_000) } as Record<string, unknown>;
        delete auto.position; // caller left this one on auto → the adapter invents M4 for index 0
        const explicitFront = enemy('enemy-explicit', 1_000, 500_000); // caller asked for M4

        const result = simulateHealing(
            BASE({
                enemies: [auto, explicitFront] as HealingSimulationInput['enemies'],
            })
        );

        const dealt = result.rounds[0].perTargetDealt?.[FOCUS_ID_IN_ENGINE] ?? {};
        // The caller's explicit M4 must win the cell, so the front-selecting cast hits IT.
        expect(Object.keys(dealt)).toEqual(['enemy-explicit']);
        // Anti-vacuity: the run really did land a positional hit, so the assertion above is a
        // statement about WHICH enemy, not about an empty map.
        expect(dealt['enemy-explicit']).toBeGreaterThan(0);
    });
});
