// ─────────────────────────────────────────────────────────────────────────────
// HEALING GOLDEN PARITY SUITE — the referee for `simulateHealing`.
//
// This is the healing analogue of `dpsGoldenParity.test.ts`. Each scenario is a
// minimal, hand-traceable `simulateHealing` fixture whose full result is locked
// with `toMatchSnapshot()`. The snapshots are the contract: they freeze the exact
// per-round healing shape (direct/HoT/shield/cleanse buckets, effective vs overheal
// split, intake/absorb/HP flow, cadence, death) so that ANY behavioural drift in the
// healing engine or the adapter surfaces as a snapshot diff.
//
// REFEREE DISCIPLINE — read before touching this file:
//   • ZERO CHURN. These snapshots must not move under normal development. A diff here
//     means behaviour changed; treat it as a finding, not a chore.
//   • REGENERATION IS DELETE-AND-RERUN, NEVER `vitest -u`. To intentionally re-bless
//     the suite, DELETE `__snapshots__/healingGoldenParity.test.ts.snap` and run the
//     suite once. Blanket `-u` would silently paper over an unintended change in an
//     unrelated scenario. (This mirrors the DPS suite's convention, enforced by project
//     docs/process rather than by a header there.)
//   • HAND-VERIFICATION PROVENANCE. Scenarios 1, 6, 7, 9 and 12 are traced round-by-round in
//     the commit that introduced this file (formula, gate schedule, shield drain order,
//     death round). The other scenarios are spot-checked for plausibility (no NaN,
//     cumulative monotonic, charge cadence sane, routed-cast heal-conservation). If you
//     change a hand-verified scenario you MUST re-derive and re-document the trace.
//
// Heal formula reminders (see src/utils/combat/__tests__/healing.test.ts):
//   • directHeal raw = basisStat × pct/100 × stacks, then × healModifier × outgoingHeal
//     × incomingHeal folds (crit 0 here for the verified scenarios → no crit fold).
//   • basis 'hp' uses the CASTER's effectiveMaxHp; 'target-hp' uses the RECIPIENT's.
//   • effectiveHealing = min(raw, deficit); overheal = raw − effectiveHealing. At full
//     HP deficit 0 → all overheal.
//   • The crit gate is BACK-LOADED: at rate 0.5 the first draw does NOT fire — crits
//     land on casts 2, 4, 6, … (proven in healing.test.ts Test 4b).
//   • Shields never crit / never take heal folds; the shield pool drains before HP and
//     caps at the target's max HP.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import { Ability, ShipSkills } from '../../../types/abilities';
import { TeamActorInput } from '../../../types/calculator';
import { simulateHealing, HealingSimulationInput, HealerStats } from '../healingEngineAdapter';

let idCounter = 0;
const ab = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `h${++idCounter}`,
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    ...partial,
});

const healSkills = (abilities: Ability[]): ShipSkills => ({
    slots: [{ slot: 'active', abilities }],
});

const chargedHealSkills = (active: Ability[], charged: Ability[]): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: active },
        { slot: 'charged', abilities: charged },
    ],
});

const HEALER: HealerStats = {
    hp: 10000,
    attack: 5000,
    defence: 2000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    healModifier: 0,
    hacking: 200,
    speed: 100,
};

const BASE = (overrides: Partial<HealingSimulationInput> = {}): HealingSimulationInput => ({
    healer: HEALER,
    chargeCount: 0,
    shipSkills: { slots: [] },
    selfBuffs: [],
    healTargetId: 'healer',
    enemies: [],
    rounds: 10,
    ...overrides,
});

const snap = (name: string, mkInput: () => HealingSimulationInput) =>
    it(name, () => {
        idCounter = 0;
        expect(simulateHealing(mkInput())).toMatchSnapshot();
    });

describe('healingGoldenParity', () => {
    // ── Scenario 1: plain heal cadence ───────────────────────────────────────
    // HAND-VERIFIED. healer hp 10000, active heal 10% hp → raw 1000/round. Healer IS
    // the target, no enemies → full HP every round → all overheal, effectiveHealing 0.
    // crit 0 → no crit fold. 10 active rounds (chargeCount 0). cumulative 1000,2000,…,10000.
    const scenario1Input = () =>
        BASE({
            rounds: 10,
            shipSkills: healSkills([
                ab({
                    type: 'heal',
                    target: 'self',
                    config: { type: 'heal', pct: 10, basis: 'hp' },
                }),
            ]),
        });

    snap('plain heal cadence (self-heal, no enemies)', scenario1Input);

    // Supplementary in-code assertion for scenario 1.
    it('scenario 1: round-1 directHeal is exactly 1000', () => {
        idCounter = 0;
        const result = simulateHealing(scenario1Input());
        expect(result.rounds[0].directHeal).toBe(1000);
    });

    // ── Scenario 2: charged heal cadence ─────────────────────────────────────
    // chargeCount 2, startCharged false → [active, active, charged] repeating. Active
    // heal 10% hp = 1000; charged heal 30% hp = 3000. Spot-check: charged rounds heal more.
    snap('charged heal cadence (active 10% + charged 30%)', () =>
        BASE({
            rounds: 10,
            chargeCount: 2,
            startCharged: false,
            shipSkills: chargedHealSkills(
                [
                    ab({
                        type: 'heal',
                        target: 'self',
                        config: { type: 'heal', pct: 10, basis: 'hp' },
                    }),
                ],
                [
                    ab({
                        type: 'heal',
                        target: 'self',
                        config: { type: 'heal', pct: 30, basis: 'hp' },
                    }),
                ]
            ),
        })
    );

    // ── Scenario 3: HoT (Repair Over Time) ───────────────────────────────────
    // Active slot grants ITSELF a 2-turn Repair Over Time II buff (hotPct 15) alongside a
    // small 5% heal. The buff fans to self; each tick scales the holder's effectiveMaxHp
    // 10000 × 15% = 1500 (hotHeal), credited to the holder. Re-cast every active round →
    // the window never lapses → HoT ticks visible in hotHeal each round.
    snap('HoT (Repair Over Time II buff + small heal)', () =>
        BASE({
            rounds: 10,
            shipSkills: healSkills([
                ab({
                    type: 'heal',
                    target: 'self',
                    config: { type: 'heal', pct: 5, basis: 'hp' },
                }),
                ab({
                    type: 'buff',
                    target: 'self',
                    config: {
                        type: 'buff',
                        buffName: 'Repair Over Time II',
                        parsedEffects: { hotPct: 15 },
                        stacks: 1,
                        isStackable: false,
                        duration: 2,
                    },
                }),
            ]),
        })
    );

    // ── Scenario 4: reactive cleanse on crit-repair ──────────────────────────
    // crit 50. The healer heals an ALLY (a walked team actor t1, speed 10 so the healer
    // acts first), routing the heal to the bombard target. A passive cleanse triggers on
    // 'on-ally-critically-repaired' (count 1) — it fires only on the casts that crit. With
    // the back-loaded gate at rate 0.5, crits land on casts 2, 4, 6, 8, 10 → cleanseCount
    // appears those rounds only.
    snap('reactive cleanse on ally crit-repair (crit 50)', () => {
        const team: TeamActorInput = {
            id: 't1',
            speed: 10,
            chargeCount: 0,
            startCharged: false,
            selfBuffs: [],
            enemyDebuffs: [],
            shipSkills: { slots: [] },
            stats: {
                attack: 1000,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 1000,
                hp: 50000, // large pool so heals are not all overheal
            },
        };
        return BASE({
            rounds: 10,
            healer: { ...HEALER, crit: 50, critDamage: 100, speed: 200 },
            healTargetId: 't1',
            teamActors: [team],
            shipSkills: {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            ab({
                                type: 'heal',
                                target: 'ally',
                                config: { type: 'heal', pct: 10, basis: 'hp' },
                            }),
                        ],
                    },
                    {
                        slot: 'passive',
                        abilities: [
                            ab({
                                type: 'cleanse',
                                target: 'self',
                                trigger: 'on-ally-critically-repaired',
                                config: { type: 'cleanse', count: 1 },
                            }),
                        ],
                    },
                ],
            },
        });
    });

    // ── Scenario 5: team healing ─────────────────────────────────────────────
    // A walked team actor (t1, self-heals 20% of its 6000 hp = 1200/round) contributes to
    // teamHealing. The focus healer self-heals 10% = 1000/round (directHeal). teamHealing
    // reports the non-focus raw (1200); summary.teamTotalHealing accumulates it.
    snap('team healing (walked team self-healer)', () => {
        const teamHealer: TeamActorInput = {
            id: 't1',
            speed: 50,
            chargeCount: 0,
            startCharged: false,
            selfBuffs: [],
            enemyDebuffs: [],
            shipSkills: healSkills([
                ab({
                    type: 'heal',
                    target: 'self',
                    config: { type: 'heal', pct: 20, basis: 'hp' },
                }),
            ]),
            stats: {
                attack: 1000,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 1000,
                hp: 6000,
            },
        };
        return BASE({
            rounds: 10,
            healer: { ...HEALER, speed: 200 },
            healTargetId: 'healer',
            teamActors: [teamHealer],
            shipSkills: healSkills([
                ab({
                    type: 'heal',
                    target: 'self',
                    config: { type: 'heal', pct: 10, basis: 'hp' },
                }),
            ]),
        });
    });

    // ── Scenario 6: pressure (partial-deficit effective healing) ─────────────
    // HAND-VERIFIED. healer hp 10000, defence 0; active heal target-hp 50% → raw 5000/round.
    // ONE manual enemy attack 4000, crit 0, speed 50 → 4000 intake/round (defence 0). Healer
    // (speed 100) heals BEFORE the enemy (speed 50) each round.
    //   R1: enter 100% (deficit 0). heal raw 5000 → effective 0, overheal 5000. Enemy 4000
    //       → hp 6000.
    //   R2: enter 60%. deficit 4000. heal 5000 → effective min(5000,4000)=4000, overheal 1000
    //       (PARTIAL-DEFICIT signature: effective>0 AND overheal>0). hp 10000. Enemy 4000 →
    //       hp 6000.
    //   R3…: steady state — enter 60%, effective 4000 / overheal 1000 each round.
    // targetHpPct declines 100→60 then holds at 60. effectiveHealing>0 AND overheal>0 from R2.
    const scenario6Input = () =>
        BASE({
            rounds: 10,
            healer: { ...HEALER, hp: 10000, defence: 0 },
            healTargetId: 'healer',
            enemies: [
                {
                    id: 'e1',
                    stats: { attack: 4000, crit: 0, critDamage: 0, speed: 50 },
                    chargeCount: 0,
                    startCharged: false,
                },
            ],
            shipSkills: healSkills([
                ab({
                    type: 'heal',
                    target: 'self',
                    config: { type: 'heal', pct: 50, basis: 'target-hp' },
                }),
            ]),
        });

    snap('pressure (declining HP, partial-deficit effective healing)', scenario6Input);

    // Supplementary in-code assertion for scenario 6: at least one round shows the
    // partial-deficit signature (effectiveHealing > 0 AND overheal > 0).
    it('scenario 6: has a partial-deficit round (effective > 0 AND overheal > 0)', () => {
        idCounter = 0;
        const result = simulateHealing(scenario6Input());
        expect(result.rounds.some((r) => r.effectiveHealing > 0 && r.overheal > 0)).toBe(true);
    });

    // ── Scenario 7: lethal pressure (target dies mid-run) ────────────────────
    // HAND-VERIFIED. healer hp 5000, defence 0; tiny self-heal 10% hp = 500/round (so the
    // overheal/effective split before death is non-trivial). ONE manual enemy attack 3000,
    // crit 0, speed 50. Healer (speed 100) heals first, enemy (speed 50) attacks second.
    //   R1: enter 100% (5000). heal 500 → full HP → effective 0, overheal 500. Enemy 3000
    //       → hp 2000.
    //   R2: enter 40% (2000). heal 500 → deficit 3000 → effective 500, overheal 0. Enemy
    //       3000 → hp 0 → DESTROYED round 2.
    //   R3-6: target dead → the healer no longer heals a dead target (directHeal 0),
    //         incomingDamage 0, targetHpPct flatlines at 0. summary.destroyedRound === 2.
    const scenario7Input = () =>
        BASE({
            rounds: 6,
            healer: { ...HEALER, hp: 5000, defence: 0 },
            healTargetId: 'healer',
            enemies: [
                {
                    id: 'e1',
                    stats: { attack: 3000, crit: 0, critDamage: 0, speed: 50 },
                    chargeCount: 0,
                    startCharged: false,
                },
            ],
            // Tiny self-heal so the pre-death overheal/effective split is non-trivial.
            shipSkills: healSkills([
                ab({
                    type: 'heal',
                    target: 'self',
                    config: { type: 'heal', pct: 10, basis: 'hp' },
                }),
            ]),
        });

    snap('lethal pressure (target dies mid-run, flatline + post-death overheal)', scenario7Input);

    // Supplementary in-code assertion for scenario 7: destroyedRound is a number.
    it('scenario 7: summary.destroyedRound is a number', () => {
        idCounter = 0;
        const result = simulateHealing(scenario7Input());
        expect(typeof result.summary.destroyedRound).toBe('number');
    });

    // ── Scenario 8: spike (ship-backed charged nuke vs shield) ───────────────
    // A ship-backed enemy (chargeCount 2, active 100% damage 1 hit, charged 400%) bombards the
    // healer. The healer grants ITSELF a shield (25% hp = 2500/round) — shield absorption is
    // visible in the timeline (shieldAbsorbed) as the pool drains before HP on each hit, and
    // the big charged spike (~4000-class) overwhelms the pool while the small active hits are
    // fully absorbed. healer hp 100000 so it never dies (isolates the absorption mechanic).
    snap('spike (charged-nuke enemy vs healer shield)', () => {
        const enemySkills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({
                            type: 'damage',
                            target: 'enemy',
                            config: { type: 'damage', multiplier: 100, hits: 1 },
                        }),
                    ],
                },
                {
                    slot: 'charged',
                    abilities: [
                        ab({
                            type: 'damage',
                            target: 'enemy',
                            config: { type: 'damage', multiplier: 400 },
                        }),
                    ],
                },
            ],
        };
        return BASE({
            rounds: 9,
            healer: { ...HEALER, hp: 100000, defence: 0 },
            healTargetId: 'healer',
            enemies: [
                {
                    id: 'e1',
                    stats: { attack: 3000, crit: 0, critDamage: 0, speed: 50 },
                    chargeCount: 2,
                    startCharged: false,
                    shipSkills: enemySkills,
                },
            ],
            shipSkills: healSkills([
                ab({
                    type: 'shield',
                    target: 'self',
                    config: { type: 'shield', pct: 25, basis: 'hp' },
                }),
            ]),
        });
    });

    // ── Scenario 9: Magnolia shape (standing damage-leech, all-scope) ─────────
    // HAND-VERIFIED (damage-leech spec §4). The healer IS the focus + heal target, no
    // enemies → all leech-heal is overheal (deficit 0). Active slot = a 100% damage cast
    // (1 hit, crit 0) + a 1-turn Inferno (tier 100, 1 stack). Passive slot = a standing
    // leech `{ type:'heal', basis:'damage-dealt', pct:20, leechScope:'all', target:'self' }`.
    // The leech is HOOK-OWNED (passive damage-dealt) → simplified fold: healModifier + crit
    // only (healMod 0, crit 0 → bare raw = credit × 20%). 'all' scope leeches BOTH direct
    // and the Inferno tick.
    //
    // Damage constants (effectiveAttack 5000, dummy defence 10000 → postDefenseFactor
    // 1 − dr(10000)/100 = 0.2579415898443159):
    //   cast direct        = 5000 × 100% × 0.2579415898443159 = 1289.7079492215796
    //   Inferno tick       = 1 stack × (100/100) × 5000 × dotMult 1 × affinityMult 1 = 5000
    //
    // Per-round timeline (identical every round — full HP, Inferno re-applied at duration 1):
    //   • Focus turn (speed 100, acts first): the cast deals direct 1289.708 to the dummy →
    //     creditDamage('attacker','direct',1289.708) procs the leech at CREDIT time:
    //       cast leech raw = 1289.7079492215796 × 20% = 257.94158984431596 (→ 258).
    //     Then the Inferno (duration 1) is applied to the dummy's container.
    //   • Dummy enemy turn (speed 0, acts last): ticks the Inferno (5000) →
    //     creditDamage('attacker','inferno',5000) procs the SAME leech ('all' scope) at the
    //     ENEMY turn (correct survival timing — a DoT-tick leech lands during the enemy turn):
    //       inferno leech raw = 5000 × 20% = 1000.
    //   ⇒ directHeal = 257.9416 + 1000 = 1257.9416 (→ 1258). Full HP → effectiveHealing 0,
    //     overheal 1257.9416 (→ 1258). hotHeal 0, shield 0, incomingDamage 0.
    //   cumulativeHealing: R1 1258, R2 2516, R3 3774, …
    const scenario9Input = () =>
        BASE({
            rounds: 10,
            healer: { ...HEALER, hp: 10000 },
            healTargetId: 'healer',
            shipSkills: {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            ab({
                                type: 'damage',
                                target: 'enemy',
                                config: { type: 'damage', multiplier: 100, hits: 1 },
                            }),
                            ab({
                                type: 'dot',
                                target: 'enemy',
                                config: {
                                    type: 'dot',
                                    dotType: 'inferno',
                                    tier: 100,
                                    stacks: 1,
                                    duration: 1,
                                },
                            }),
                        ],
                    },
                    {
                        slot: 'passive',
                        abilities: [
                            ab({
                                type: 'heal',
                                target: 'self',
                                trigger: 'on-cast',
                                config: {
                                    type: 'heal',
                                    pct: 20,
                                    basis: 'damage-dealt',
                                    leechScope: 'all',
                                },
                            }),
                        ],
                    },
                ],
            },
        });

    snap('Magnolia shape (standing damage-leech all-scope: cast + Inferno tick)', scenario9Input);

    // Supplementary in-code assertion for scenario 9: round-1 directHeal is the cast-leech
    // (258) + the Inferno-tick leech (1000) folded into the focus bucket → 1258.
    it('scenario 9: round-1 directHeal is exactly 1258 (cast 258 + inferno 1000)', () => {
        idCounter = 0;
        const result = simulateHealing(scenario9Input());
        expect(result.rounds[0].directHeal).toBe(1258);
    });

    // ── Scenario 10: Tithonus/Pallas shape (all-allies noCrit cast rider) ─────
    // Active slot = a 100% damage cast + an all-allies cast rider
    // `{ type:'heal', basis:'damage-dealt', pct:7, noCrit:true, target:'all-allies' }`. This
    // is an ACTIVE-slot 'damage-dealt' ability → a CAST RIDER (NOT hook-owned): the FULL fold
    // path (healModifier + outgoing + incoming, crit gated — here all 0/noCrit). A team actor
    // t1 is present and is the heal target (healer ≠ heal target), so all-allies routing is
    // exercised across both player ids (['attacker','t1']). The rider credits the FOCUS bucket
    // for every recipient (per-recipient directHeal credit), while consumption (applyHealToTarget)
    // routes only to t1. No enemies → t1 stays full → all overheal. Spot-checked for plausibility
    // (routed-cast heal-conservation; no NaN; cumulative monotonic).
    snap('Tithonus/Pallas shape (all-allies noCrit cast rider, routed to a team target)', () => {
        const team: TeamActorInput = {
            id: 't1',
            speed: 10, // slower than the healer (speed 100) → healer acts first
            chargeCount: 0,
            startCharged: false,
            selfBuffs: [],
            enemyDebuffs: [],
            shipSkills: { slots: [] },
            stats: {
                attack: 1000,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 1000,
                hp: 50000, // large pool so the routed heal stays overheal (deficit 0)
            },
        };
        return BASE({
            rounds: 10,
            healTargetId: 't1',
            teamActors: [team],
            shipSkills: healSkills([
                ab({
                    type: 'damage',
                    target: 'enemy',
                    config: { type: 'damage', multiplier: 100, hits: 1 },
                }),
                ab({
                    type: 'heal',
                    target: 'all-allies',
                    config: {
                        type: 'heal',
                        pct: 7,
                        basis: 'damage-dealt',
                        noCrit: true,
                    },
                }),
            ]),
        });
    });

    // ── Scenario 11: Valkyrie shape (detonation-scope standing leeches) ───────
    // chargeCount 2, startCharged false → cadence [active, active, charged] (scenario 2's
    // schedule). rounds 4 → the charged slot fires ONLY on round 3. The charged slot carries a
    // 100% damage cast + an accumulate-detonate `{ turns:1, pct:100 }` (Echoing Burst): applied
    // on the round-3 focus turn (roundsRemaining 1), it gathers ALL players' round-3 direct and
    // bursts on the round-3 dummy turn, crediting the DETONATION channel. Two passive standing
    // leeches scoped to detonation only — one ally (5%) + one self (5%) — therefore proc ONLY on
    // round 3 (the burst round); the direct channel on rounds 1/2/4 is skipped by the scope
    // guard. Healer is focus + heal target, full HP → all overheal. Spot-checked for plausibility.
    snap(
        'Valkyrie shape (accumulate-detonate burst → detonation-scope leeches, burst round only)',
        () =>
            BASE({
                rounds: 4,
                chargeCount: 2,
                startCharged: false,
                healer: { ...HEALER, hp: 10000 },
                healTargetId: 'healer',
                shipSkills: {
                    slots: [
                        {
                            slot: 'active',
                            abilities: [
                                ab({
                                    type: 'damage',
                                    target: 'enemy',
                                    config: { type: 'damage', multiplier: 100, hits: 1 },
                                }),
                            ],
                        },
                        {
                            slot: 'charged',
                            abilities: [
                                ab({
                                    type: 'damage',
                                    target: 'enemy',
                                    config: { type: 'damage', multiplier: 100, hits: 1 },
                                }),
                                ab({
                                    type: 'accumulate-detonate',
                                    target: 'enemy',
                                    config: { type: 'accumulate-detonate', turns: 1, pct: 100 },
                                }),
                            ],
                        },
                        {
                            slot: 'passive',
                            abilities: [
                                ab({
                                    type: 'heal',
                                    target: 'ally',
                                    trigger: 'on-cast',
                                    config: {
                                        type: 'heal',
                                        pct: 5,
                                        basis: 'damage-dealt',
                                        leechScope: 'detonation',
                                    },
                                }),
                                ab({
                                    type: 'heal',
                                    target: 'self',
                                    trigger: 'on-cast',
                                    config: {
                                        type: 'heal',
                                        pct: 5,
                                        basis: 'damage-dealt',
                                        leechScope: 'detonation',
                                    },
                                }),
                            ],
                        },
                    ],
                },
            })
    );

    // ── Scenario 12: Quixilver as heal target (rider shield + taken shield) ───
    // HAND-VERIFIED (damage-leech spec §5). The healer IS the focus + heal target (hp 10000,
    // defence 0 → the enemy's reduction term is 0, so enemy damage = its attack exactly).
    //   • Active slot = a 100% damage cast + a shield CAST RIDER
    //     `{ type:'shield', basis:'damage-dealt', pct:20 }` (shields never crit / never fold) →
    //     each focus turn grants shield = cast direct × 20%.
    //   • Passive slot = a damage-TAKEN shield `{ basis:'damage-taken', pct:25,
    //     requiresHpDamage:true }` (Quixilver punch-through gate): procs on an enemy ATTACK only
    //     when shield was present at attack start AND the attack dealt HP damage. raw = FULL
    //     attack damage × 25%, applied AFTER the attack's shield-first drain.
    //   • One enemy attacker (attack 4000, crit 0, speed 50) → acts AFTER the healer (speed 100).
    //
    // Damage constants (effectiveAttack 5000, dummy defence 10000 → postDefenseFactor
    // 0.2579415898443159; enemy reduction 0 at defence 0):
    //   cast direct  = 5000 × 100% × 0.2579415898443159 = 1289.7079492215796
    //   shield rider = 1289.7079492215796 × 20% = 257.94158984431596
    //   enemy hit    = 4000 (defence 0 → no reduction)
    //   taken shield = 4000 × 25% = 1000
    //
    // R1 (enter HP 100%, shield 0):
    //   • focus turn: rider grants 257.9416 → shieldPool 257.9416; shield bucket 257.9416.
    //   • enemy hit 4000: shieldBefore 257.9416 → absorbed 257.9416, hpDamage 3742.0584 →
    //     HP 6257.9416. Gate (shieldBefore>0 AND hpDamage>0) PASSES → taken proc 1000 →
    //     shieldPool 0 + 1000 = 1000; shield bucket 257.9416 + 1000 = 1257.9416 (→ 1258).
    //   ⇒ shield 1258, shieldAbsorbed 257.9416 (→ 258), incomingDamage 4000.
    // R2 (enter HP 6257.9416/10000 = 62.579% → 63, shield 1000):
    //   • focus turn: rider grants 257.9416 → shieldPool 1257.9416; shield bucket 257.9416.
    //   • enemy hit 4000: shieldBefore 1257.9416 → absorbed 1257.9416, hpDamage 2742.0584 →
    //     HP 3515.8832. Gate PASSES → taken proc 1000 → shieldPool 1000; shield bucket
    //     1257.9416 (→ 1258).
    //   ⇒ shield 1258, shieldAbsorbed 1257.9416 (→ 1258), incomingDamage 4000.
    // (No heals at all → directHeal/hotHeal/effectiveHealing/overheal 0 every round.)
    // DESTROYED round 4: the cumulative net damage (4000 − shield absorption each round)
    // exceeds the 10000 HP pool by round 4. R5-R10 flatline with incomingDamage 0.
    // summary.destroyedRound === 4.
    const scenario12Input = () =>
        BASE({
            rounds: 10,
            healer: { ...HEALER, hp: 10000, defence: 0 },
            healTargetId: 'healer',
            enemies: [
                {
                    id: 'e1',
                    stats: { attack: 4000, crit: 0, critDamage: 0, speed: 50 },
                    chargeCount: 0,
                    startCharged: false,
                },
            ],
            shipSkills: {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            ab({
                                type: 'damage',
                                target: 'enemy',
                                config: { type: 'damage', multiplier: 100, hits: 1 },
                            }),
                            ab({
                                type: 'shield',
                                target: 'self',
                                config: { type: 'shield', pct: 20, basis: 'damage-dealt' },
                            }),
                        ],
                    },
                    {
                        slot: 'passive',
                        abilities: [
                            ab({
                                type: 'shield',
                                target: 'self',
                                trigger: 'on-cast',
                                config: {
                                    type: 'shield',
                                    pct: 25,
                                    basis: 'damage-taken',
                                    requiresHpDamage: true,
                                },
                            }),
                        ],
                    },
                ],
            },
        });

    snap('Quixilver as heal target (shield rider + punch-through taken shield)', scenario12Input);

    // Supplementary in-code assertion for scenario 12: round-1 shield is the rider (258) +
    // the punch-through taken shield (1000) → 1258, and round-1 absorbed is just the rider pool.
    it('scenario 12: round-1 shield is 1258 (rider 258 + taken 1000), absorbed 258', () => {
        idCounter = 0;
        const result = simulateHealing(scenario12Input());
        expect(result.rounds[0].shield).toBe(1258);
        expect(result.rounds[0].shieldAbsorbed).toBe(258);
    });

    // Supplementary in-code assertion for scenario 12: target is DESTROYED on round 4.
    it('scenario 12: summary.destroyedRound is 4', () => {
        idCounter = 0;
        const result = simulateHealing(scenario12Input());
        expect(result.summary.destroyedRound).toBe(4);
    });
});
