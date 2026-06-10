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
import { CombatEvent, createEventBus } from '../../combat/events';

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

    // ── Scenario 13: Defiant shape (shield-on-Stasis via control-applied) ─────
    // HAND-VERIFIED. The focus IS the heal target (hp 10000, no enemies → full HP every round,
    // all shield is pool growth, no absorption). The Defiant kit:
    //   • Active slot = a 145% damage cast (its in-game Provoke is NOT modelled — no control
    //     ability parsed for Provoke; the active cast is inert here, no enemies).
    //   • Charged slot = a 195% damage cast + a `control` ability { effect:'stasis' }. On a
    //     charged cast the cast path emits `control-applied {effect:'stasis', casterId:focus}`.
    //   • Passive slot = a shield `{ basis:'hp', pct:30, trigger:'on-stasis-applied' }`. The
    //     on-stasis-applied listener fires on the focus's OWN Stasis application → the existing
    //     shield follow-up grants 30% of max HP = 10000 × 30% = 3000 (raw; shields never crit /
    //     never fold), capping the pool at max HP. shield bucket counts the RAW 3000 each cast.
    //
    // Cadence: chargeCount 1, startCharged true → charged fires on rounds 1,3,5,7,9 (charges
    // 1≥1 → fire, reset 0; +1 on the intervening active rounds). So control-applied → shield
    // procs ONLY on those 5 charged rounds; active rounds 2,4,6,8,10 grant no shield.
    //   ⇒ shield bucket = 3000 on rounds 1,3,5,7,9; 0 on rounds 2,4,6,8,10. cumulative shield
    //     over 10 rounds = 5 × 3000 = 15000. No directHeal/hotHeal/effective/overheal (no heals).
    const scenario13Input = () =>
        BASE({
            rounds: 10,
            chargeCount: 1,
            startCharged: true,
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
                                config: { type: 'damage', multiplier: 145 },
                            }),
                        ],
                    },
                    {
                        slot: 'charged',
                        abilities: [
                            ab({
                                type: 'damage',
                                target: 'enemy',
                                config: { type: 'damage', multiplier: 195 },
                            }),
                            ab({
                                type: 'control',
                                target: 'enemy',
                                config: { type: 'control', effect: 'stasis' },
                            }),
                        ],
                    },
                    {
                        slot: 'passive',
                        abilities: [
                            ab({
                                type: 'shield',
                                target: 'self',
                                trigger: 'on-stasis-applied',
                                config: { type: 'shield', pct: 30, basis: 'hp' },
                            }),
                        ],
                    },
                ],
            },
        });

    snap(
        'Defiant shape (shield-on-Stasis via control-applied → on-stasis-applied)',
        scenario13Input
    );

    // Supplementary in-code assertion for scenario 13: charged rounds (1,3,5,7,9) grant a 3000
    // shield via on-stasis-applied; active rounds (2,4,6,8,10) grant none.
    it('scenario 13: shield is 3000 on charged rounds (1,3,5,7,9), 0 on active rounds', () => {
        idCounter = 0;
        const result = simulateHealing(scenario13Input());
        const shieldByRound = result.rounds.map((r) => r.shield);
        expect(shieldByRound).toEqual([3000, 0, 3000, 0, 3000, 0, 3000, 0, 3000, 0]);
    });

    // =========================================================================
    // PHASE 4a (enemy-offense increment) — NEW BEHAVIOUR GOLDENS (Task 11).
    // The enemy attacker is now a full runPlayerTurn actor: it deals affinity-
    // modified damage to the heal target, applies debuffs/DoTs to it, grants
    // itself self-buffs, and triggers on-attacked reactions on the target. Real
    // selfHpPct gates the target's own abilities. Player condition contexts read
    // the live enemyBuffNames/selfDebuffNames arrays (derivable conditions only).
    //
    // Damage reminder for these scenarios (target defence 0 → calculateDamageReduction(0)
    // path returns 0, so postDefenseFactor's defence term is 1; enemy crit 0 → no crit
    // fold): enemy hit = enemyAttack × multiplier/100 × affinityMult, where
    // affinityMult = 1 + affinityDamageModifier/100 (neutral 0 → 1, advantage +25 → 1.25).
    // The heal target (focus, speed 100) ACTS BEFORE every enemy (speed 50) each round,
    // so its heal/shield this round lands BEFORE that round's incoming damage.
    // =========================================================================

    // ── Scenario 14 (a): enemy full-kit (debuff + DoT + self-buff) ───────────
    // HAND-VERIFIED. A ship-backed enemy whose ACTIVE slot is: a 100% damage cast, a
    // 'Defense Down' debuff (inflict, 2 turns), an inferno DoT (tier 100, 1 stack, 3 turns),
    // and a SELF 'Attack Up' buff (+50% attack, 2 turns). The self-buff is an on-cast active
    // self-buff → it folds into THIS turn's effectiveAttack before the damage assembly:
    //   enemy hit = 4000 × 1.50 (Attack Up) × 100% × 1 (defence 0, crit 0, neutral aff) = 6000.
    // The heal target (hp 100000, defence 0) self-heals 5% of its own max HP = 5000/round.
    //   • DoT TICK (Task 11b): the enemy applies the inferno to the TARGET's DoT container, and
    //     the engine ticks the TARGET's own containers at the TARGET's turn-start (the afflicted
    //     ship's turn). The applier (the enemy) carries effectiveAttack 6000 (Attack Up folded),
    //     so each inferno tick = 1 stack × (tier 100/100) × 6000 × dotMult 1 × affinityMult 1 =
    //     6000 incoming. duration 3 → an entry applied on round N ticks on rounds N+1, N+2, N+3
    //     then expires. The enemy re-applies every round, so the live entry count climbs to a
    //     steady 3 (then holds — the 4-rounds-ago entry has expired). The debuff/self-buff DO
    //     surface as NAMES in enemyEffects[e1].debuffs / .selfBuffs (display only).
    // Per-round (target speed 100 > enemy speed 50, so the target acts FIRST each round; its DoT
    // ticks at turn-start, BEFORE its heal, then the enemy attacks last). HP enters R1 at 100%:
    //   R1 enter 100%: 0 inferno entries → tick 0. heal 5000 (deficit 0 → all overheal). Enemy
    //       hit 6000 → HP 94000; apply inferno A (rem 3). incoming R1 = 6000 (hit only).
    //   R2 enter 94%:  entries [A:3] → tick 6000 → HP 88000 (A→2). heal 5000 (deficit 6000 →
    //       effective 5000) → HP 93000. Enemy hit 6000 → HP 87000; apply B (rem 3).
    //       incoming R2 = 6000 (DoT) + 6000 (hit) = 12000.
    //   R3 enter 87%:  [A:2,B:3] → tick 12000 → HP 75000 (A→1,B→2). heal 5000 → HP 80000. Enemy
    //       6000 → HP 74000; apply C (rem 3). incoming R3 = 12000 + 6000 = 18000.
    //   R4 enter 74%:  [A:1,B:2,C:3] → tick 18000 → HP 56000 (A expires; B→1,C→2). heal 5000 →
    //       HP 61000. Enemy 6000 → HP 55000; apply D (rem 3). incoming R4 = 18000 + 6000 = 24000.
    //   R5 enter 55%:  [B:1,C:2,D:3] → tick 18000 → HP 37000 (B expires; C→1,D→2). heal 5000 →
    //       HP 42000. Enemy 6000 → HP 36000; apply E. incoming R5 = 24000.
    //   R6 enter 36%:  [C:1,D:2,E:3] → tick 18000 → HP 18000 (C expires; D→1,E→2). heal 5000 →
    //       HP 23000. Enemy 6000 → HP 17000. incoming R6 = 24000.
    //   ⇒ incomingDamage = 6000, 12000, 18000, 24000, 24000, 24000. directHeal 5000 every round
    //     (effective 0/overheal 5000 on R1; effective 5000/overheal 0 from R2 — the DoT tick
    //     opens a full deficit before the heal). enemyEffects[e1]={ debuffs:['Defense Down'],
    //     selfBuffs:['Attack Up'] } every round. cumulativeHealing 5000,10000,…,30000. The
    //     target SURVIVES all 6 rounds (HP 17000 at the end). targetHpPct entering: 100, 94, 87,
    //     74, 55, 36.
    const scenario14Input = () =>
        BASE({
            rounds: 6,
            healer: { ...HEALER, hp: 100000, defence: 0 },
            healTargetId: 'healer',
            shipSkills: healSkills([
                ab({
                    type: 'heal',
                    target: 'self',
                    config: { type: 'heal', pct: 5, basis: 'hp' },
                }),
            ]),
            enemies: [
                {
                    id: 'e1',
                    stats: { attack: 4000, crit: 0, critDamage: 0, speed: 50 },
                    chargeCount: 0,
                    startCharged: false,
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
                                        type: 'debuff',
                                        target: 'enemy',
                                        config: {
                                            type: 'debuff',
                                            buffName: 'Defense Down',
                                            parsedEffects: {},
                                            stacks: 1,
                                            isStackable: false,
                                            application: 'inflict',
                                            duration: 2,
                                        },
                                    }),
                                    ab({
                                        type: 'dot',
                                        target: 'enemy',
                                        config: {
                                            type: 'dot',
                                            dotType: 'inferno',
                                            tier: 100,
                                            stacks: 1,
                                            duration: 3,
                                        },
                                    }),
                                    ab({
                                        type: 'buff',
                                        target: 'self',
                                        config: {
                                            type: 'buff',
                                            buffName: 'Attack Up',
                                            parsedEffects: { attack: 50 },
                                            stacks: 1,
                                            isStackable: false,
                                            duration: 2,
                                        },
                                    }),
                                ],
                            },
                        ],
                    },
                },
            ],
        });

    snap('enemy full-kit (debuff + DoT + self-buff bombard the heal target)', scenario14Input);

    // Supplementary: round-1 incoming is the self-buffed 6000, heal is 5000, and the
    // debuff/self-buff names surface in the round overview buckets.
    it('scenario 14: R1 incoming 6000 (4000 × 1.5 Attack Up), heal 5000, names surfaced', () => {
        idCounter = 0;
        const result = simulateHealing(scenario14Input());
        expect(result.rounds[0].incomingDamage).toBe(6000);
        expect(result.rounds[0].directHeal).toBe(5000);
        // The names surface in the round overview, attributed to the source enemy (e1).
        const r1e1 = result.rounds[0].enemyEffects.find((e) => e.enemyId === 'e1');
        expect(r1e1?.selfBuffs.map((b) => b.buffName)).toEqual(['Attack Up']);
        expect(r1e1?.debuffs.map((b) => b.buffName)).toEqual(['Defense Down']);
    });

    // Supplementary: the inferno DoT is applied every round (dot-applied ×6) AND ticks on the
    // target at its turn-start (Task 11b), adding 6000 incoming per live entry. The live entry
    // count climbs (duration 3, re-applied every round) → incoming grows 6000 → 12000 → 18000
    // → 24000 then holds (3 live entries in steady state). dot-ticked fires on the TARGET from
    // round 2 (the round-1 application's first tick).
    it('scenario 14: enemy inferno DoT applied ×6 AND ticks on the target (incoming grows with live entries)', () => {
        idCounter = 0;
        const bus = createEventBus();
        const dotApplied: number[] = [];
        const dotTicked: { round: number; targetId: string; damage: number }[] = [];
        bus.on('dot-applied', (e) => {
            if ((e as { dotType?: string }).dotType === 'inferno') {
                dotApplied.push((e as { round: number }).round);
            }
        });
        bus.on('dot-ticked', (e) => {
            const ev = e as { dotType?: string; round: number; targetId: string; damage: number };
            if (ev.dotType === 'inferno') {
                dotTicked.push({ round: ev.round, targetId: ev.targetId, damage: ev.damage });
            }
        });
        const result = simulateHealing({ ...scenario14Input(), bus });
        expect(dotApplied).toEqual([1, 2, 3, 4, 5, 6]);
        // DoT-tick bleed: hit 6000 every round + 6000 per live inferno entry at the target's
        // turn-start (0,1,2,3,3,3 live entries on rounds 1–6).
        expect(result.rounds.map((r) => r.incomingDamage)).toEqual([
            6000, 12000, 18000, 24000, 24000, 24000,
        ]);
        // The tick lands on the TARGET (the focus actor id is 'attacker'; healTargetId 'healer'
        // resolves to it), summed per dotType = 6000 × live-entry-count, from round 2.
        expect(dotTicked).toEqual([
            { round: 2, targetId: 'attacker', damage: 6000 },
            { round: 3, targetId: 'attacker', damage: 12000 },
            { round: 4, targetId: 'attacker', damage: 18000 },
            { round: 5, targetId: 'attacker', damage: 18000 },
            { round: 6, targetId: 'attacker', damage: 18000 },
        ]);
    });

    // ── Scenario 15 (b): affinity-advantage enemy damage (+25%) ──────────────
    // HAND-VERIFIED. A bare (manual) enemy attacker bombards the heal target with one basic
    // hit/round. Two runs, identical except affinity:
    //   • neutral  (no affinity either side): enemy hit = 4000 × 1.00 = 4000.
    //   • advantage (enemy thermal vs target chemical → damageModifier +25 → affinityMult 1.25):
    //       enemy hit = 4000 × 1.25 = 5000.
    // No heals (empty kit), hp 100000, defence 0 → HP declines purely by the incoming hit:
    //   neutral:   100 → 96 → 92 → 88 → 84 → 80 (−4%/round; 4000/100000).
    //   advantage: 100 → 95 → 90 → 85 → 80 → 75 (−5%/round; 5000/100000).
    // The ADVANTAGE snapshot locks the elevated 5000 incoming / faster survival decline; the
    // neutral snapshot is the 4000 baseline it is measured against (the ×1.25 is the headline).
    const scenario15NeutralInput = () =>
        BASE({
            rounds: 6,
            healer: { ...HEALER, hp: 100000, defence: 0 },
            healTargetId: 'healer',
            shipSkills: { slots: [] },
            enemies: [
                {
                    id: 'e1',
                    stats: { attack: 4000, crit: 0, critDamage: 0, speed: 50 },
                    chargeCount: 0,
                    startCharged: false,
                },
            ],
        });

    const scenario15AdvantageInput = () =>
        BASE({
            rounds: 6,
            healer: { ...HEALER, hp: 100000, defence: 0 },
            healTargetId: 'healer',
            // target chemical; enemy thermal → thermal ADVANTAGE over chemical → +25% damage.
            healTargetAffinity: 'chemical',
            shipSkills: { slots: [] },
            enemies: [
                {
                    id: 'e1',
                    stats: { attack: 4000, crit: 0, critDamage: 0, speed: 50 },
                    chargeCount: 0,
                    startCharged: false,
                    affinity: 'thermal',
                },
            ],
        });

    snap('affinity NEUTRAL enemy damage (4000 baseline)', scenario15NeutralInput);
    snap('affinity ADVANTAGE enemy damage (4000 × 1.25 = 5000)', scenario15AdvantageInput);

    // Supplementary: advantage incoming is exactly ×1.25 the neutral incoming, every round.
    it('scenario 15: advantage incoming (5000) is exactly 1.25× neutral incoming (4000)', () => {
        idCounter = 0;
        const neutral = simulateHealing(scenario15NeutralInput());
        idCounter = 0;
        const advantage = simulateHealing(scenario15AdvantageInput());
        expect(neutral.rounds.every((r) => r.incomingDamage === 4000)).toBe(true);
        expect(advantage.rounds.every((r) => r.incomingDamage === 5000)).toBe(true);
        expect(advantage.rounds[0].incomingDamage).toBe(neutral.rounds[0].incomingDamage * 1.25);
    });

    // ── Scenario 16 (c): live selfHpPct gate activation mid-fight ────────────
    // HAND-VERIFIED. The heal target (hp 10000, defence 0) carries a self-heal (10% hp = 1000)
    // GATED on `hp-threshold self below 40%` (derivable). A bare enemy hits 1500/round. The gate
    // reads the target's HP% ENTERING the round (its live currentHp this turn). The heal fires
    // ONLY when entering below 40% — closing the earlier coverage gap (a target taking real
    // engine damage driving a LIVE selfHpPct gate). Heal acts before damage each round:
    //   R1 enter 100%: 100<40 false → no heal. Enemy 1500 → HP 8500 → 85%.
    //   R2 enter 85%:  no heal → HP 7000 → 70%.
    //   R3 enter 70%:  no heal → HP 5500 → 55%.
    //   R4 enter 55%:  no heal → HP 4000 → 40%.
    //   R5 enter 40%:  40<40 FALSE (strict below) → no heal → HP 2500 → 25%.
    //   R6 enter 25%:  25<40 TRUE → heal 1000 (deficit 7500 → effective 1000) → HP 3500;
    //                  enemy 1500 → HP 2000 → 20%.
    //   R7 enter 20%:  heal 1000 → HP 3000; enemy 1500 → HP 1500 → 15%.
    //   R8 enter 15%:  heal 1000 → HP 2500; enemy 1500 → HP 1000 → 10% (next-round entry).
    //   ⇒ directHeal 0 on R1-R5, then 1000 on R6,R7,R8. The gate SWITCHES ON at round 6
    //     (the first round entering strictly below 40%). incomingDamage 1500 every round.
    const scenario16Input = () =>
        BASE({
            rounds: 8,
            healer: { ...HEALER, hp: 10000, defence: 0 },
            healTargetId: 'healer',
            shipSkills: healSkills([
                ab({
                    type: 'heal',
                    target: 'self',
                    conditions: [
                        {
                            subject: 'hp-threshold',
                            derivable: true,
                            hpSubject: 'self',
                            hpComparator: 'below',
                            hpPercent: 40,
                        },
                    ],
                    config: { type: 'heal', pct: 10, basis: 'hp' },
                }),
            ]),
            enemies: [
                {
                    id: 'e1',
                    stats: { attack: 1500, crit: 0, critDamage: 0, speed: 50 },
                    chargeCount: 0,
                    startCharged: false,
                },
            ],
        });

    snap('selfHpPct gate activates mid-fight (heal fires only below 40%)', scenario16Input);

    // Supplementary: the gate is off (directHeal 0) until the target enters below 40% on round 6.
    it('scenario 16: heal fires from round 6 (first entry below 40%)', () => {
        idCounter = 0;
        const result = simulateHealing(scenario16Input());
        const healByRound = result.rounds.map((r) => r.directHeal);
        expect(healByRound).toEqual([0, 0, 0, 0, 0, 1000, 1000, 1000]);
    });

    // ── Scenario 17 (d): enemy-buff condition fires off a live enemy self-buff ─
    // HAND-VERIFIED. A PLAYER ship self-heal (10% hp = 10000 of its 100000) GATED on a
    // DERIVABLE `enemy-buff: 'Attack Up'` condition (hand-built — ship-data enemy-buff gates are
    // non-derivable/manual, so this exercises the LIVE enemy-buff path). The enemy grants ITSELF
    // 'Attack Up' (+50% attack, 10 turns) on every cast → its hit = 4000 × 1.5 = 6000. The
    // player gate reads the enemyBuffNames union sourced from the PRIOR state: the focus (speed
    // 100) acts BEFORE the enemy (speed 50), so on round 1 the enemy has not yet applied Attack
    // Up → gate empty → no heal. From round 2 the buff is live → the gate fires:
    //   R1 enter 100%: enemyBuffNames empty → 10<… no heal (directHeal 0). Enemy 6000 → HP
    //                  94000 → 94%.
    //   R2 enter 94%:  enemyBuffNames=['Attack Up'] → heal 10000 (deficit 6000 → effective 6000,
    //                  overheal 4000) → HP 100000. Enemy 6000 → HP 94000 → 94%.
    //   R3…: steady — enter 94%, heal 10000 (effective 6000 / overheal 4000), back to 94%.
    //   ⇒ directHeal 0 on R1, 10000 on R2-R6. enemyEffects[e1].selfBuffs=['Attack Up'] every round.
    //     incomingDamage 6000 every round (the enemy self-buff applies round 1 too).
    const scenario17Input = () =>
        BASE({
            rounds: 6,
            healer: { ...HEALER, hp: 100000, defence: 0 },
            healTargetId: 'healer',
            shipSkills: healSkills([
                ab({
                    type: 'heal',
                    target: 'self',
                    conditions: [{ subject: 'enemy-buff', derivable: true, buffName: 'Attack Up' }],
                    config: { type: 'heal', pct: 10, basis: 'hp' },
                }),
            ]),
            enemies: [
                {
                    id: 'e1',
                    stats: { attack: 4000, crit: 0, critDamage: 0, speed: 50 },
                    chargeCount: 0,
                    startCharged: false,
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
                                        type: 'buff',
                                        target: 'self',
                                        config: {
                                            type: 'buff',
                                            buffName: 'Attack Up',
                                            parsedEffects: { attack: 50 },
                                            stacks: 1,
                                            isStackable: false,
                                            duration: 10,
                                        },
                                    }),
                                ],
                            },
                        ],
                    },
                },
            ],
        });

    snap('enemy-buff condition fires (player heal gated on live enemy Attack Up)', scenario17Input);

    // Supplementary: the conditional heal is OFF round 1 (enemy buff not yet live) and ON from
    // round 2 once the enemy's ability-sourced self-buff is held.
    it('scenario 17: conditional heal engages from round 2 (enemy holds Attack Up)', () => {
        idCounter = 0;
        const result = simulateHealing(scenario17Input());
        const healByRound = result.rounds.map((r) => r.directHeal);
        expect(healByRound).toEqual([0, 10000, 10000, 10000, 10000, 10000]);
        const r2e1 = result.rounds[1].enemyEffects.find((e) => e.enemyId === 'e1');
        expect(r2e1?.selfBuffs.map((b) => b.buffName)).toEqual(['Attack Up']);
    });

    // ── Scenario 18 (e): on-attacked reactive fires off the enemy attack ─────
    // HAND-VERIFIED. The heal target carries a PASSIVE on-attacked self-shield (30% hp = 30000
    // of its 100000 max). A bare enemy hits 4000/round. The engine emits `attacked` AFTER the
    // hit's shield-first drain, so the reactive shield is granted AFTER that round's incoming
    // damage has already landed on HP (it cannot absorb its own trigger):
    //   R1 enter 100%, shield 0: enemy hit 4000 lands on HP (no shield yet) → absorbed 0,
    //      HP 96000. on-attacked → shield +30000 → pool 30000. ⇒ shield 30000, absorbed 0,
    //      incoming 4000, hpPct entering next round 96%.
    //   R2 enter 96%, shield 30000: enemy hit 4000 fully absorbed (pool 30000 → 26000) →
    //      absorbed 4000, HP unchanged (96%). on-attacked → shield +30000, pool re-capped at
    //      max HP 100000. ⇒ shield 30000, absorbed 4000.
    //   R3…: steady — enter 96%, absorbed 4000, shield +30000 (pool stays capped at 100000).
    //   ⇒ shield 30000 every round; shieldAbsorbed 0 on R1 then 4000 R2-R6; HP holds at 96%
    //     from R2 (every hit fully absorbed). incomingDamage 4000 every round.
    const scenario18Input = () =>
        BASE({
            rounds: 6,
            healer: { ...HEALER, hp: 100000, defence: 0 },
            healTargetId: 'healer',
            shipSkills: {
                slots: [
                    {
                        slot: 'passive',
                        abilities: [
                            ab({
                                type: 'shield',
                                target: 'self',
                                trigger: 'on-attacked',
                                config: { type: 'shield', pct: 30, basis: 'hp' },
                            }),
                        ],
                    },
                ],
            },
            enemies: [
                {
                    id: 'e1',
                    stats: { attack: 4000, crit: 0, critDamage: 0, speed: 50 },
                    chargeCount: 0,
                    startCharged: false,
                },
            ],
        });

    snap('on-attacked reactive shield fires when the enemy attacks', scenario18Input);

    // Supplementary: the on-attacked shield (30000) is granted every round; absorption is 0 on
    // round 1 (shield granted AFTER that round's hit) then 4000 once the pool is standing.
    it('scenario 18: on-attacked shield 30000/round; absorb 0 then 4000', () => {
        idCounter = 0;
        const result = simulateHealing(scenario18Input());
        expect(result.rounds.map((r) => r.shield)).toEqual([
            30000, 30000, 30000, 30000, 30000, 30000,
        ]);
        expect(result.rounds.map((r) => r.shieldAbsorbed)).toEqual([
            0, 4000, 4000, 4000, 4000, 4000,
        ]);
    });

    // ── Scenario 19 (Task 10a): per-enemy effect attribution ─────────────────
    // TWO ship-backed enemy attackers bombard the heal target, each carrying a DISTINCT
    // self-buff + a DISTINCT debuff. The round-overview enemyEffects must attribute each
    // enemy's effects to ITS OWN actor id (no cross-enemy fold): e1 → Attack Up / Defense
    // Down; e2 → Crit Up / Vulnerability. Numeric output is irrelevant here (this asserts the
    // attribution shape only) — the target is given a huge pool so it never dies.
    it('scenario 19: enemyEffects attributes each enemy’s self-buff + debuff to its own id', () => {
        idCounter = 0;
        const enemyKit = (selfBuff: string, debuff: string): ShipSkills => ({
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
                            type: 'debuff',
                            target: 'enemy',
                            config: {
                                type: 'debuff',
                                buffName: debuff,
                                parsedEffects: {},
                                stacks: 1,
                                isStackable: false,
                                application: 'inflict',
                                duration: 3,
                            },
                        }),
                        ab({
                            type: 'buff',
                            target: 'self',
                            config: {
                                type: 'buff',
                                buffName: selfBuff,
                                parsedEffects: { attack: 10 },
                                stacks: 1,
                                isStackable: false,
                                duration: 3,
                            },
                        }),
                    ],
                },
            ],
        });
        const result = simulateHealing(
            BASE({
                rounds: 3,
                healer: { ...HEALER, hp: 1_000_000, defence: 0 },
                healTargetId: 'healer',
                shipSkills: { slots: [] },
                enemies: [
                    {
                        id: 'e1',
                        stats: { attack: 1000, crit: 0, critDamage: 0, speed: 50 },
                        chargeCount: 0,
                        startCharged: false,
                        shipSkills: enemyKit('Attack Up', 'Defense Down'),
                    },
                    {
                        id: 'e2',
                        stats: { attack: 1000, crit: 0, critDamage: 0, speed: 40 },
                        chargeCount: 0,
                        startCharged: false,
                        shipSkills: enemyKit('Crit Up', 'Vulnerability'),
                    },
                ],
            })
        );
        const r1 = result.rounds[0].enemyEffects;
        const e1 = r1.find((e) => e.enemyId === 'e1');
        const e2 = r1.find((e) => e.enemyId === 'e2');
        // Each enemy carries ONLY its own effects (no cross-enemy contamination).
        expect(e1?.selfBuffs.map((b) => b.buffName)).toEqual(['Attack Up']);
        expect(e1?.debuffs.map((b) => b.buffName)).toEqual(['Defense Down']);
        expect(e2?.selfBuffs.map((b) => b.buffName)).toEqual(['Crit Up']);
        expect(e2?.debuffs.map((b) => b.buffName)).toEqual(['Vulnerability']);
    });

    // =========================================================================
    // PHASE 4b (death & revive increment) — NEW BEHAVIOUR GOLDEN (Task 12).
    // The Cheat Death intercept (Task 7) saves a heal target from an otherwise-
    // lethal hit ONCE per combat: the killing blow floors HP at 1 instead of
    // destroying the ship, so the run continues and NO destroyedRound is recorded.
    // Detection routes through selfBuffNamesForOwners, which surfaces the
    // ABILITY-SOURCED recurring Cheat Death buff (the real ship path), not just a
    // top-level input selfBuff — so this scenario grants Cheat Death via the tank's
    // own parsed kit (a recurring self-buff ability), mirroring Task 7's parser shape.
    // =========================================================================

    // ── Scenario 20 (Phase 4b): Cheat Death tank survives an otherwise-lethal spike ──
    // HAND-VERIFIED. The heal target (tank, hp 10000, defence 0, speed 100) carries an
    // ABILITY-SOURCED recurring Cheat Death (a `buff` ability { buffName:'Cheat Death',
    // duration:'recurring', trigger:'on-cast', target:'self' } — Task 6's parser shape)
    // alongside a self-heal (30% of its own max HP = 3000/round). A ship-backed charged-nuke
    // enemy (attack 3000, chargeCount 5, startCharged TRUE → charged fires round 1 only, then
    // needs 5 charges to re-arm; never re-arms within 6 rounds) bombards it: the round-1
    // charged hit (mult 400 → 12000) is otherwise-lethal vs the 10000 pool; every later round
    // is a survivable active hit (mult 100 → 3000). The tank (speed 100) heals BEFORE the enemy
    // (speed 50) each round.
    //   R1 enter 100% (10000): heal 3000 → full HP (deficit 0 → effective 0, overheal 3000),
    //       HP 10000. Enemy CHARGED 12000 → would drop HP to −2000 → CHEAT DEATH intercepts →
    //       HP floored at 1 (NOT destroyed). incomingDamage 12000. (cheat-death-activated R1.)
    //   R2 enter ~0% (HP 1): heal 3000 → deficit 9999 → effective 3000, HP 3001. Enemy ACTIVE
    //       3000 → HP 1 (3001 − 3000; survivable, NOT lethal). incomingDamage 3000.
    //   R3-R6: identical to R2 — HP cycles 1 → 3001 → 1 every round (enter ~0%, heal 3000 →
    //       effective 3000, active hit 3000 → HP 1). The tank SURVIVES all 6 rounds.
    //   ⇒ Cheat Death fires ONCE (round 1); summary records NO destroyedRound (survival).
    //     incomingDamage 12000 (R1) then 3000 (R2-R6). directHeal 3000 every round (effective 0
    //     / overheal 3000 on R1; effective 3000 / overheal 0 from R2 — the floored HP opens a
    //     full deficit). targetHpPct entering: 100 (R1) then 0 (R2-R6, HP 1 rounds to 0%).
    const scenario20Input = () => {
        const cheatDeathTankKit: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({
                            type: 'heal',
                            target: 'self',
                            config: { type: 'heal', pct: 30, basis: 'hp' },
                        }),
                        // Ability-sourced recurring Cheat Death (Task 6 parser shape) — the
                        // REAL ship path surfaced via selfBuffNamesForOwners, NOT a top-level
                        // input selfBuff.
                        ab({
                            type: 'buff',
                            target: 'self',
                            trigger: 'on-cast',
                            config: {
                                type: 'buff',
                                buffName: 'Cheat Death',
                                parsedEffects: {},
                                stacks: 1,
                                isStackable: false,
                                duration: 'recurring',
                            },
                        }),
                    ],
                },
            ],
        };
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
                            config: { type: 'damage', multiplier: 400, hits: 1 },
                        }),
                    ],
                },
            ],
        };
        return BASE({
            rounds: 6,
            healer: { ...HEALER, hp: 10000, defence: 0 },
            healTargetId: 'healer',
            shipSkills: cheatDeathTankKit,
            enemies: [
                {
                    id: 'e1',
                    stats: { attack: 3000, crit: 0, critDamage: 0, speed: 50 },
                    chargeCount: 5,
                    startCharged: true, // charged fires round 1 only; never re-arms in 6 rounds
                    shipSkills: enemySkills,
                },
            ],
        });
    };

    snap(
        'Cheat Death tank survives an otherwise-lethal spike (HP floors at 1, no death)',
        scenario20Input
    );

    // Supplementary: the tank SURVIVES the whole run via Cheat Death — no destroyedRound, the
    // run completes all 6 rounds, the lethal round-1 spike (12000) floors HP (entering R2 at 0%),
    // and a single cheat-death-activated fires on round 1.
    it('scenario 20: Cheat Death survival — no destroyedRound, run completes, intercept fires once on round 1', () => {
        idCounter = 0;
        const bus = createEventBus();
        const cheated: { round: number }[] = [];
        bus.on('cheat-death-activated', (e) => cheated.push(e as { round: number }));
        const result = simulateHealing({ ...scenario20Input(), bus });
        // No death recorded; the run continues for all configured rounds.
        expect(result.summary.destroyedRound).toBeUndefined();
        expect(result.rounds).toHaveLength(6);
        // The otherwise-lethal spike lands round 1 (12000), then survivable active hits (3000).
        expect(result.rounds.map((r) => r.incomingDamage)).toEqual([
            12000, 3000, 3000, 3000, 3000, 3000,
        ]);
        // HP floors at 1 after the round-1 intercept → enters round 2 at 0%, holds at 0% (the
        // self-heal lifts it to 3001 each round but the 3000 active hit drops it back to 1).
        expect(result.rounds.map((r) => r.targetHpPct)).toEqual([100, 0, 0, 0, 0, 0]);
        // The intercept fires exactly once, on the lethal round.
        expect(cheated.map((c) => c.round)).toEqual([1]);
    });

    // =========================================================================
    // PHASE 4c PR 1 (per-hit on-attacked reactives) — NEW BEHAVIOUR GOLDENS
    // (Task 11). The engine now emits ONE `attacked` event PER HIT of the
    // enemy's fired damage ability (after the aggregate shield-first drain),
    // each carrying ITS OWN hit's crit outcome. The on-attacked listener
    // filters by the ability's `triggerCritFilter` ('crit' / 'non-crit' /
    // absent → every hit) and enqueues a PER-EVENT intent whose
    // eventCtx.counterTargetId names the attacker — the executor routes a
    // counter-debuff to THAT enemy's per-target store. Drain-time
    // hp-threshold gates read the heal target's LIVE post-attack HP
    // (denominator baseHpFor). Executor reactive-heal fold: healModifier ×
    // outgoing × incoming (all 0 here → bare basis × pct), NEVER crits.
    // =========================================================================

    // ── Scenario 21 (A): per-hit cadence + crit-filter pair (Isha shape) ──────
    // HAND-VERIFIED. The tank (focus + heal target, hp 100000, defence 0, speed 100) carries an
    // Isha-shaped PAIR of on-attacked self-heals: pct 3 with triggerCritFilter 'non-crit' + pct 6
    // with 'crit' (basis 'hp' → the tank's own effectiveMaxHp 100000 → 3000 / 6000 per reaction;
    // healModifier/outgoing/incoming all 0 → bare fold; reactive heals never crit). A ship-backed
    // enemy (attack 4000, crit 50, critDamage 100, speed 50) fires a 3-HIT active damage ability
    // (multiplier 100 → effectiveMultiplier 300) → 3 `attacked` events per round, each with its
    // own hit's crit outcome.
    //
    // Per-hit crit pattern (rate-accumulator gate at 0.5, back-loaded — VERIFIED against
    // engine.events.test.ts "Phase 4c Task 3" Test 1b):
    //   R1: acc 0→0.5 F, →1.0 T (reset 0), →0.5 F  ⇒ [non-crit, CRIT, non-crit]
    //   R2: acc 0.5→1.0 T, →0.5 F, →1.0 T          ⇒ [CRIT, non-crit, CRIT]
    //   R3 = R1 pattern, R4 = R2 pattern (acc returns to 0 / 0.5 at each round boundary).
    // Exactly ONE filtered reaction fires per hit (the 'non-crit' heal on non-critting hits, the
    // 'crit' heal on critting hits):
    //   R1: 2 × 3000 + 1 × 6000 = 12000.   R2: 1 × 3000 + 2 × 6000 = 15000.   R3/R4 alternate.
    //
    // Enemy damage (blended per-hit crit fold, defence 0 → reduction 0, neutral affinity):
    //   preCrit = 4000 × 300% = 12000; R1 critFraction 1/3 → ×(1+1/3) = 16000;
    //   R2 critFraction 2/3 → ×(1+2/3) = 20000. Alternating 16000 / 20000.
    // The reactive heals DRAIN AFTER the enemy's turn body (after the hit landed), so each
    // round's heal sees a full deficit → all effective, 0 overheal:
    //   R1: 100000 − 16000 = 84000, +12000 → 96000 (enter R2 at 96%).
    //   R2: 96000 − 20000 = 76000, +15000 → 91000 (enter R3 at 91%).
    //   R3: 91000 − 16000 = 75000, +12000 → 87000 (enter R4 at 87%).
    //   R4: 87000 − 20000 = 67000, +15000 → 82000.
    //   ⇒ directHeal [12000, 15000, 12000, 15000]; effectiveHealing identical; overheal 0;
    //     incomingDamage [16000, 20000, 16000, 20000]; targetHpPct entering [100, 96, 91, 87].
    const scenario21Input = () =>
        BASE({
            rounds: 4,
            healer: { ...HEALER, hp: 100000, defence: 0 },
            healTargetId: 'healer',
            shipSkills: {
                slots: [
                    {
                        slot: 'passive',
                        abilities: [
                            ab({
                                type: 'heal',
                                target: 'self',
                                trigger: 'on-attacked',
                                triggerCritFilter: 'non-crit',
                                config: { type: 'heal', pct: 3, basis: 'hp' },
                            }),
                            ab({
                                type: 'heal',
                                target: 'self',
                                trigger: 'on-attacked',
                                triggerCritFilter: 'crit',
                                config: { type: 'heal', pct: 6, basis: 'hp' },
                            }),
                        ],
                    },
                ],
            },
            enemies: [
                {
                    id: 'e1',
                    stats: { attack: 4000, crit: 50, critDamage: 100, speed: 50 },
                    chargeCount: 0,
                    startCharged: false,
                    shipSkills: {
                        slots: [
                            {
                                slot: 'active',
                                abilities: [
                                    ab({
                                        type: 'damage',
                                        target: 'enemy',
                                        config: { type: 'damage', multiplier: 100, hits: 3 },
                                    }),
                                ],
                            },
                        ],
                    },
                },
            ],
        });

    snap(
        'per-hit crit-filter pair (Isha shape: non-crit 3% + crit 6% on-attacked heals)',
        scenario21Input
    );

    // Supplementary: exactly one filtered reaction per hit — the mixed crit pattern
    // [F,T,F]/[T,F,T] yields alternating 12000 / 15000 reactive heal totals, all effective
    // (the heals drain AFTER each round's hits, into a full deficit).
    it('scenario 21: per-round reactive heals are 2×3% + 1×6% then 1×3% + 2×6% of max HP', () => {
        idCounter = 0;
        const result = simulateHealing(scenario21Input());
        expect(result.rounds.map((r) => r.directHeal)).toEqual([12000, 15000, 12000, 15000]);
        expect(result.rounds.map((r) => r.effectiveHealing)).toEqual([12000, 15000, 12000, 15000]);
        expect(result.rounds.map((r) => r.overheal)).toEqual([0, 0, 0, 0]);
        expect(result.rounds.map((r) => r.incomingDamage)).toEqual([16000, 20000, 16000, 20000]);
        expect(result.rounds.map((r) => r.targetHpPct)).toEqual([100, 96, 91, 87]);
    });

    // ── Scenario 22 (B): gated reactive heal crossing the threshold (Makoli) ──
    // HAND-VERIFIED. The tank (hp 10000, defence 0) carries a Makoli-shaped on-attacked
    // self-heal (pct 20 → 2000) GATED on `hp-threshold self below 40%` (derivable). A bare
    // enemy hits 2000/round. The gate is evaluated at DRAIN time — AFTER the triggering hit
    // landed — against the tank's LIVE post-attack HP (Task 6: selfHpPctFor, denominator
    // baseHpFor). Numbers are chosen so the heal lifts the tank back to EXACTLY 40% (never
    // above): each subsequent round re-enters at 40%, the hit drops it to 20% (< 40 at drain
    // time) → the heal re-fires EVERY round once first triggered. The steady state is the
    // documented RE-CROSSING behaviour: enter 40% → hit → 20% → heal → 40%.
    //   R1: 10000 → hit → 8000 (80% at drain; 80 < 40 FALSE) → no heal.
    //   R2: 8000 → 6000 (60%) → no heal.
    //   R3: 6000 → 4000 (40% at drain; 40 < 40 FALSE — STRICT below) → no heal.
    //   R4: 4000 → 2000 (20% TRUE) → heal 2000 (deficit 8000 → all effective) → 4000.
    //   R5: enter 40% → 2000 (20% TRUE) → heal 2000 → 4000.
    //   R6: identical to R5.
    //   ⇒ directHeal [0, 0, 0, 2000, 2000, 2000]; zero reactive heals while the drain-time HP
    //     is ≥ 40% (incl. the EXACTLY-40% round 3 — strict comparator); targetHpPct entering
    //     [100, 80, 60, 40, 40, 40]; incomingDamage 2000 every round; overheal 0.
    const scenario22Input = () =>
        BASE({
            rounds: 6,
            healer: { ...HEALER, hp: 10000, defence: 0 },
            healTargetId: 'healer',
            shipSkills: {
                slots: [
                    {
                        slot: 'passive',
                        abilities: [
                            ab({
                                type: 'heal',
                                target: 'self',
                                trigger: 'on-attacked',
                                conditions: [
                                    {
                                        subject: 'hp-threshold',
                                        derivable: true,
                                        hpSubject: 'self',
                                        hpComparator: 'below',
                                        hpPercent: 40,
                                    },
                                ],
                                config: { type: 'heal', pct: 20, basis: 'hp' },
                            }),
                        ],
                    },
                ],
            },
            enemies: [
                {
                    id: 'e1',
                    stats: { attack: 2000, crit: 0, critDamage: 0, speed: 50 },
                    chargeCount: 0,
                    startCharged: false,
                },
            ],
        });

    snap(
        'gated on-attacked heal crosses the threshold (Makoli shape: drain-time below-40% gate)',
        scenario22Input
    );

    // Supplementary: the gate is OFF for the first three rounds (drain-time HP 80/60/40% —
    // 40 is NOT strictly below 40), then fires every round from R4 (drain-time HP 20%).
    it('scenario 22: zero reactive heals at/above 40%, fires from round 4 (steady re-crossing)', () => {
        idCounter = 0;
        const result = simulateHealing(scenario22Input());
        // Round 3 (index 2) is the exactly-40%-drain-time strict-below boundary case:
        // the tank enters at 60%, takes 2000 damage → HP 4000 = exactly 40% at drain time.
        // The strict-below comparator (40 < 40 = FALSE) means the heal does NOT fire on round 3.
        expect(result.rounds.map((r) => r.directHeal)).toEqual([0, 0, 0, 2000, 2000, 2000]);
        expect(result.rounds.map((r) => r.targetHpPct)).toEqual([100, 80, 60, 40, 40, 40]);
    });

    // ── Scenario 23 (C): counter-debuff routed to the attacking enemy (Warden) ─
    // HAND-VERIFIED. The tank (hp 100000, defence 0, hacking 200 → debuff landing chance
    // clamp(200−100)/100 = 1, always lands) carries a Warden-shaped NAME-ONLY counter-debuff:
    // { type:'debuff', buffName:'Corrosion I', parsedEffects:{}, duration 2, application
    // 'inflict', trigger 'on-attacked', target 'enemy' }. A single ship-backed enemy attacker
    // (attack 2000, crit 0, speed 50; 1-hit active 100% → 2000/round) bombards it → ONE
    // `attacked` event per round → ONE intent with eventCtx.counterTargetId = 'e1' → the
    // executor routes the debuff to THAT enemy's per-target store and emits `debuff-applied`
    // with targetId 'e1' (sourceId = the tank focus, engine id 'attacker') — once per hit
    // landed (1 hit/round → 1 per round).
    //
    // RESULT-SURFACE GAP (documented): no field of HealingSimulationResult exposes debuffs ON
    // enemy attackers — EnemyRoundEffects.debuffs is the debuffs the ENEMY inflicted on the
    // heal target, not what it suffers. The attribution is therefore asserted via the event
    // bus (`debuff-applied`), the executor's only observable routing surface here; the
    // snapshot locks the numeric output (no heals → directHeal 0; HP declines 2000/round:
    // targetHpPct entering [100, 98, 96, 94]).
    const scenario23Input = () =>
        BASE({
            rounds: 4,
            healer: { ...HEALER, hp: 100000, defence: 0 },
            healTargetId: 'healer',
            shipSkills: {
                slots: [
                    {
                        slot: 'passive',
                        abilities: [
                            ab({
                                type: 'debuff',
                                target: 'enemy',
                                trigger: 'on-attacked',
                                config: {
                                    type: 'debuff',
                                    buffName: 'Corrosion I',
                                    parsedEffects: {},
                                    stacks: 1,
                                    isStackable: false,
                                    application: 'inflict',
                                    duration: 2,
                                },
                            }),
                        ],
                    },
                ],
            },
            enemies: [
                {
                    id: 'e1',
                    stats: { attack: 2000, crit: 0, critDamage: 0, speed: 50 },
                    chargeCount: 0,
                    startCharged: false,
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
                        ],
                    },
                },
            ],
        });

    snap(
        'counter-debuff routed to the attacking enemy (Warden shape: on-attacked Corrosion I)',
        scenario23Input
    );

    // Supplementary: the counter-debuff lands on the ATTACKING enemy's id ('e1'), sourced from
    // the tank (the focus actor id 'attacker'), once per hit landed — one per round here.
    it('scenario 23: debuff-applied targets the attacking enemy id once per hit landed', () => {
        idCounter = 0;
        const bus = createEventBus();
        const applied: Extract<CombatEvent, { type: 'debuff-applied' }>[] = [];
        bus.on('debuff-applied', (e) => {
            if (e.buffName === 'Corrosion I') applied.push(e);
        });
        simulateHealing({ ...scenario23Input(), bus });
        expect(applied).toEqual([
            {
                type: 'debuff-applied',
                sourceId: 'attacker',
                targetId: 'e1',
                round: 1,
                buffName: 'Corrosion I',
            },
            {
                type: 'debuff-applied',
                sourceId: 'attacker',
                targetId: 'e1',
                round: 2,
                buffName: 'Corrosion I',
            },
            {
                type: 'debuff-applied',
                sourceId: 'attacker',
                targetId: 'e1',
                round: 3,
                buffName: 'Corrosion I',
            },
            {
                type: 'debuff-applied',
                sourceId: 'attacker',
                targetId: 'e1',
                round: 4,
                buffName: 'Corrosion I',
            },
        ]);
    });
});
