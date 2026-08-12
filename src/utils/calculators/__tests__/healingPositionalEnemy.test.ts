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
    // A team actor's parsed axes are sourced ONLY from `teamTargetById`/`teamPatternById`
    // (engine.ts:1869-1885), so `position` alone is not enough: without target AND pattern the
    // actor's cast falls back to `legacyVictim` — the 10,000-defence sink — and every
    // `basis:'damage-dealt'` rider it owns computes off THAT defence (measured 2579 vs 7753 here,
    // a ~3× error surfacing as `teamHealing`). NO golden fixture covers this (every golden team
    // actor carries an empty or heal-only kit), so this is the only guard for it.
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

        // ANTI-VACUITY ANCHOR: on-footprint the heal is real, so the zero below is about coverage
        // and not about a kit that simply never heals.
        expect(run('M3').summary.totalHealing).toBeGreaterThan(0);
        // Off-footprint: nothing lands. INTENDED — see the block comment above.
        expect(run('M1').summary.totalHealing).toBe(0);
        // The DEFAULT (no explicit position anywhere) must land INSIDE the footprint, or the
        // out-of-the-box page reports zero healing. This is the regression guard for wiring
        // `defaultHealTargetSlot` into the adapter's player-slot resolution.
        expect(run().summary.totalHealing).toBeGreaterThan(0);
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
        const filler = (id: string): TeamActorInput => ({
            id,
            speed: 10,
            chargeCount: 0,
            startCharged: false,
            selfBuffs: [],
            enemyDebuffs: [],
            // Deliberately UNPOSITIONED — this is what makes them compete for default cells.
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
        const run = (crowded: boolean) => {
            idc = 0;
            return simulateHealing(
                BASE({
                    shipSkills: allyHeal(),
                    healTargetId: 'tank',
                    // The page's own shape: generic allies first, heal target LAST.
                    teamActors: crowded ? [filler('a0'), filler('a1'), filler('a2'), tank] : [tank],
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

        // Both legs pin the VALUE, not a floor. `toBeGreaterThan(0)` would stay green if a partial
        // regression evicted the heal target onto a DIFFERENT covered cell and the heal landed on
        // some other recipient instead — 20,000 is the caster's hp 50,000 x 40%, i.e. the full cast
        // landing on the heal target and nobody else.
        expect(run(false).summary.totalHealing).toBe(20_000);
        // Crowded: the same heal must still land — the heal target keeps its covered cell.
        expect(run(true).summary.totalHealing).toBe(20_000);
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
});
