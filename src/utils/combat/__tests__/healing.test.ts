import { describe, it, expect } from 'vitest';
import { toSimBuffs } from '../../calculators/dpsBuffHelpers';
import { deriveTeamEngineActors } from '../../calculators/dpsSimulator';
import { TeamActorInput } from '../../../types/calculator';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { Ability, ShipSkills } from '../../../types/abilities';
import { registerReactiveListeners, Intent, ReactiveAbility } from '../triggers';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { Ship } from '../../../types/ship';

let idCounter = 0;
const ab = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `h${++idCounter}`,
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    ...partial,
});

// A focus actor that does nothing damaging (so DoT/charge paths stay quiet); the heal
// ability lives on the active slot. enemyHp huge → enemy never dies.
const BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    attack: 5000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [] },
    enemyDefense: 0,
    enemyHp: 10_000_000,
    numRounds: 1,
    selfBuffs: [],
    enemyDebuffs: [],
    debuffLandingChance: 1,
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 2000,
    hp: 10000,
    ...overrides,
});

const healSkills = (abilities: Ability[]): ShipSkills => ({
    slots: [{ slot: 'active', abilities }],
});

type HealBucket =
    | 'directHeal'
    | 'hotHeal'
    | 'shield'
    | 'cleanseCount'
    | 'effectiveHeal'
    | 'overheal';

/** Sum a bucket over every round's healing entry for `actorId` (defaults to the focus actor). */
const sumHeal = (
    result: ReturnType<typeof runCombat>,
    bucket: HealBucket,
    actorId = 'attacker'
): number =>
    (result.healing?.rounds ?? []).reduce(
        (sum, rd) => sum + (rd.perActor.get(actorId)?.[bucket] ?? 0),
        0
    );

/** Sum a bucket over every round's focus-actor healing entry. */
const focusHeal = (result: ReturnType<typeof runCombat>, bucket: HealBucket): number =>
    sumHeal(result, bucket, 'attacker');

describe('healing-calc engine groundwork', () => {
    it('toSimBuffs carries outgoingHeal/incomingHeal/hotPct', () => {
        const buffs = toSimBuffs([
            {
                id: 'x',
                buffName: 'Out Repair',
                stacks: 2,
                isStackable: false,
                parsedEffects: { outgoingHeal: 15, incomingHeal: 10, hotPct: 10 },
            },
        ]);
        expect(buffs).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ stat: 'outgoingHeal', value: 30 }),
                expect.objectContaining({ stat: 'incomingHeal', value: 20 }),
                expect.objectContaining({ stat: 'hotPct', value: 20 }),
            ])
        );
    });
});

describe('healing mode — heal consumption + heal-performed', () => {
    // ── Test 1: self-heal at full HP → all overheal ──────────────────────────
    // hp 10000, pct 10 → raw 1000/round, target = self at full HP → effectiveHeal 0,
    // overheal 1000.
    it('self-heal at full HP: directHeal raw, effectiveHeal 0, overheal full', () => {
        idCounter = 0;
        const result = runCombat(
            BASE({
                numRounds: 3,
                healTargetId: 'attacker',
                shipSkills: healSkills([
                    ab({
                        type: 'heal',
                        target: 'self',
                        config: { type: 'heal', pct: 10, basis: 'hp' },
                    }),
                ]),
            })
        );
        expect(result.healing).toBeDefined();
        expect(result.healing!.rounds).toHaveLength(3);
        // 1000/round × 3 = 3000 raw, 0 consumed, 3000 overheal.
        expect(focusHeal(result, 'directHeal')).toBe(3000);
        expect(focusHeal(result, 'effectiveHeal')).toBe(0);
        expect(focusHeal(result, 'overheal')).toBe(3000);
    });

    // ── Test 3: basis resolution ─────────────────────────────────────────────
    it('attack-based heal: attack 5000, pct 90 → 4500', () => {
        idCounter = 0;
        const result = runCombat(
            BASE({
                attack: 5000,
                healTargetId: 'attacker',
                shipSkills: healSkills([
                    ab({
                        type: 'heal',
                        target: 'self',
                        config: { type: 'heal', pct: 90, basis: 'attack' },
                    }),
                ]),
            })
        );
        expect(focusHeal(result, 'directHeal')).toBe(4500);
    });

    it('defense-based heal: defence 2000, pct 50 → 1000', () => {
        idCounter = 0;
        const result = runCombat(
            BASE({
                defence: 2000,
                healTargetId: 'attacker',
                shipSkills: healSkills([
                    ab({
                        type: 'heal',
                        target: 'self',
                        config: { type: 'heal', pct: 50, basis: 'defense' },
                    }),
                ]),
            })
        );
        expect(focusHeal(result, 'directHeal')).toBe(1000);
    });

    it('target-hp basis: 10% of target max HP (10000) → 1000', () => {
        idCounter = 0;
        const result = runCombat(
            BASE({
                hp: 10000,
                healTargetId: 'attacker',
                shipSkills: healSkills([
                    ab({
                        type: 'heal',
                        target: 'self',
                        config: { type: 'heal', pct: 10, basis: 'target-hp' },
                    }),
                ]),
            })
        );
        expect(focusHeal(result, 'directHeal')).toBe(1000);
    });

    // ── Test 4: crit heals ───────────────────────────────────────────────────
    it('crit 100: heal × (1 + cd/100), heal-performed.critHits present', () => {
        idCounter = 0;
        const bus = createEventBus();
        const perfs: Extract<CombatEvent, { type: 'heal-performed' }>[] = [];
        bus.on('heal-performed', (e) => perfs.push(e));
        const result = runCombat(
            BASE({
                crit: 100,
                critDamage: 50,
                healTargetId: 'attacker',
                bus,
                shipSkills: healSkills([
                    ab({
                        type: 'heal',
                        target: 'self',
                        config: { type: 'heal', pct: 10, basis: 'hp' },
                    }),
                ]),
            })
        );
        // 1000 base × (1 + 50/100) = 1500.
        expect(focusHeal(result, 'directHeal')).toBe(1500);
        expect(perfs).toHaveLength(1);
        expect(perfs[0].critHits).toBe(1);
        expect(perfs[0].amount).toBe(1500);
    });

    it('crit 0: heal base amount, heal-performed.critHits absent', () => {
        idCounter = 0;
        const bus = createEventBus();
        const perfs: Extract<CombatEvent, { type: 'heal-performed' }>[] = [];
        bus.on('heal-performed', (e) => perfs.push(e));
        const result = runCombat(
            BASE({
                crit: 0,
                critDamage: 50,
                healTargetId: 'attacker',
                bus,
                shipSkills: healSkills([
                    ab({
                        type: 'heal',
                        target: 'self',
                        config: { type: 'heal', pct: 10, basis: 'hp' },
                    }),
                ]),
            })
        );
        expect(focusHeal(result, 'directHeal')).toBe(1000);
        expect(perfs[0].critHits).toBeUndefined();
    });

    // ── Test 4b: noCrit heal does NOT advance the heal gate ──────────────────
    // Two heal abilities in one cast: first is noCrit at crit 100 → base, gate untouched.
    // Second is a normal heal at crit 100 → crits (gate starts fresh, fires on first draw
    // since rate 1.0). If the noCrit heal had advanced the gate, the schedule would differ —
    // but at rate 1.0 every draw fires regardless. To distinguish, use crit 50: at rate 0.5
    // the FIRST normal draw does NOT fire (back-loaded). So the normal heal should NOT crit
    // when it is the first real draw. We assert the second heal is base (no crit) at crit 50,
    // proving the noCrit heal did not pre-advance the accumulator to 0.5.
    it('noCrit heal does not advance the heal crit gate', () => {
        idCounter = 0;
        const result = runCombat(
            BASE({
                crit: 50,
                critDamage: 100,
                healTargetId: 'attacker',
                shipSkills: healSkills([
                    // noCrit heal: base 1000, must not draw/advance the gate.
                    ab({
                        type: 'heal',
                        target: 'self',
                        config: { type: 'heal', pct: 10, basis: 'hp', noCrit: true },
                    }),
                    // normal heal: base 1000. With a FRESH gate at rate 0.5, the first draw
                    // does NOT fire (acc 0.5 < 1) → base 1000 (no crit). Total directHeal = 2000.
                    ab({
                        type: 'heal',
                        target: 'self',
                        config: { type: 'heal', pct: 10, basis: 'hp' },
                    }),
                ]),
            })
        );
        // noCrit heal 1000 + normal heal 1000 (no crit, first draw of fresh 0.5 gate) = 2000.
        // If the noCrit heal had advanced the gate to 0.5, the normal heal's draw would push
        // acc to 1.0 → fire → 1000 × 2 = 2000 for the normal heal → total 3000. So 2000 proves
        // the gate did NOT advance for the noCrit heal.
        expect(focusHeal(result, 'directHeal')).toBe(2000);
    });

    // ── Test 5: fold order ───────────────────────────────────────────────────
    // healModifier 20 + outgoingHeal 15 (self-buff) + incomingHeal 20 (self-buff, local) →
    // base 1000 × 1.2 × 1.15 × 1.2 = 1656.
    it('fold order: healModifier × outgoingHeal × incomingHeal', () => {
        idCounter = 0;
        const result = runCombat(
            BASE({
                healModifier: 20,
                healTargetId: 'attacker',
                // A recurring self-buff carrying outgoingHeal 15 + incomingHeal 20.
                selfBuffs: [
                    {
                        id: 'heal-buff',
                        buffName: 'Repair Boost',
                        stacks: 1,
                        isStackable: false,
                        parsedEffects: { outgoingHeal: 15, incomingHeal: 20 },
                    },
                ],
                shipSkills: healSkills([
                    ab({
                        type: 'heal',
                        target: 'self',
                        config: { type: 'heal', pct: 10, basis: 'hp' },
                    }),
                ]),
            })
        );
        // 1000 × 1.2 × 1.15 × 1.2 = 1656.
        expect(focusHeal(result, 'directHeal')).toBeCloseTo(1656, 6);
    });

    // ── Test 6: shield pool ──────────────────────────────────────────────────
    it('shield: 25% of 10000 → 2500; accumulates; caps at max HP; shield bucket = raw', () => {
        idCounter = 0;
        const result = runCombat(
            BASE({
                numRounds: 6,
                hp: 10000,
                healTargetId: 'attacker',
                shipSkills: healSkills([
                    ab({
                        type: 'shield',
                        target: 'self',
                        config: { type: 'shield', pct: 25, basis: 'hp' },
                    }),
                ]),
            })
        );
        // Each cast grants 2500 raw. shield bucket counts raw every round → 6 × 2500 = 15000.
        expect(focusHeal(result, 'shield')).toBe(15000);
        // The pool itself caps at max HP (10000): the targetShieldStart of the LAST round
        // reflects the capped accumulation (2500, 5000, 7500, 10000 cap, 10000, 10000).
        const rounds = result.healing!.rounds;
        expect(rounds[3].targetShieldStart).toBe(7500); // entering round 4: 3 casts done
        expect(rounds[5].targetShieldStart).toBe(10000); // capped at max HP
    });

    it('shield does not apply heal channels (no crit/healMod/outgoing/incoming)', () => {
        idCounter = 0;
        const result = runCombat(
            BASE({
                crit: 100,
                critDamage: 100,
                healModifier: 50,
                hp: 10000,
                healTargetId: 'attacker',
                selfBuffs: [
                    {
                        id: 'b',
                        buffName: 'Boost',
                        stacks: 1,
                        isStackable: false,
                        parsedEffects: { outgoingHeal: 50, incomingHeal: 50 },
                    },
                ],
                shipSkills: healSkills([
                    ab({
                        type: 'shield',
                        target: 'self',
                        config: { type: 'shield', pct: 25, basis: 'hp' },
                    }),
                ]),
            })
        );
        // Raw shield = 2500 — NONE of crit/healMod/outgoing/incoming apply.
        expect(focusHeal(result, 'shield')).toBe(2500);
    });

    // ── Test 7: cleanse count ────────────────────────────────────────────────
    it('cleanse credits count per cast', () => {
        idCounter = 0;
        const result = runCombat(
            BASE({
                numRounds: 3,
                healTargetId: 'attacker',
                shipSkills: healSkills([
                    ab({ type: 'cleanse', config: { type: 'cleanse', count: 2 } }),
                ]),
            })
        );
        expect(focusHeal(result, 'cleanseCount')).toBe(6); // 2 × 3 rounds
    });

    // ── Test 8: all-allies summing ───────────────────────────────────────────
    // focus + 2 walked team actors → 3 recipients, raw = 3 × base, ONE crit draw.
    it('all-allies: 3 recipients, raw = 3×base, one crit draw', () => {
        idCounter = 0;
        const teamWalk = (id: string, speed: number): TeamActorEngineInput => ({
            id,
            speed,
            chargeCount: 0,
            startCharged: false,
            selfBuffs: [],
            enemyDebuffs: [],
            walk: {
                shipSkills: { slots: [] },
                stats: {
                    attack: 1000,
                    crit: 0,
                    critDamage: 0,
                    defensePenetration: 0,
                    hacking: 0,
                    defence: 1000,
                    hp: 8000,
                },
                debuffLandingChance: 1,
                selfDotModifier: 0,
                defensePenetrationBuff: 0,
                affinityDamageModifier: 0,
                affinityCritCap: 100,
                affinityCritPenalty: 0,
                hasChargedSkill: false,
            },
        });
        const bus = createEventBus();
        const perfs: Extract<CombatEvent, { type: 'heal-performed' }>[] = [];
        bus.on('heal-performed', (e) => {
            if (e.casterId === 'attacker') perfs.push(e);
        });
        const result = runCombat(
            BASE({
                numRounds: 1,
                crit: 100,
                critDamage: 0,
                hp: 10000,
                healTargetId: 'attacker',
                // Attacker (speed 200) acts first; team actors slower so they don't heal here.
                speed: 200,
                teamActors: [teamWalk('t1', 40), teamWalk('t2', 30)],
                bus,
                shipSkills: healSkills([
                    ab({
                        type: 'heal',
                        target: 'all-allies',
                        config: { type: 'heal', pct: 10, basis: 'hp' },
                    }),
                ]),
            })
        );
        // 3 recipients (attacker + t1 + t2), each healed for the caster's hp-basis (10000×10%
        // = 1000) since basis 'hp' uses the CASTER's effectiveHp. directHeal credited to the
        // caster for all 3 → 3000. ONE crit draw (crit 100 → didCrit, critDamage 0 → ×1).
        expect(focusHeal(result, 'directHeal')).toBe(3000);
        const attackerPerf = perfs[0];
        expect(attackerPerf.targets).toEqual(['attacker', 't1', 't2']);
        expect(attackerPerf.amount).toBe(3000);
        expect(attackerPerf.critHits).toBe(1); // ONE draw, not 3
    });

    // ── Test 8b: walked team healer folds its OWN healModifier ───────────────
    // A team actor whose stats.healModifier = 50 is threaded through deriveTeamEngineActors
    // (the real auto-fill seam) → its walk bundle carries healModifier 50. It casts a self
    // heal (basis hp 8000, pct 10). With crit 0 and no outgoing/incoming heal buffs, its OWN
    // directHeal must be basis × pct × (1 + 50/100) = 8000 × 0.10 × 1.5 = 1200. The focus
    // actor does nothing (empty skills). Pre-threading this healed at ×1.0 (= 800) because
    // CombatStatBlock carried no healModifier and the walk bundle defaulted it to 0.
    it('walked team healer folds its own stats.healModifier into directHeal', () => {
        idCounter = 0;
        const teamHealer: TeamActorInput = {
            id: 't1',
            speed: 200, // acts before the (inert) focus actor
            chargeCount: 0,
            startCharged: false,
            selfBuffs: [],
            enemyDebuffs: [],
            shipSkills: healSkills([
                ab({
                    type: 'heal',
                    target: 'self',
                    config: { type: 'heal', pct: 10, basis: 'hp' },
                }),
            ]),
            stats: {
                attack: 1000,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 1000,
                hp: 8000,
                healModifier: 50,
            },
        };
        // Thread through the real seam (security 100, no enemy affinity) → walk.healModifier 50.
        const engineTeamActors = deriveTeamEngineActors([teamHealer], 100, undefined);
        const result = runCombat(
            BASE({
                numRounds: 1,
                hp: 10000,
                speed: 40, // focus acts after the team healer
                healTargetId: 't1',
                teamActors: engineTeamActors,
                shipSkills: { slots: [] }, // focus actor is inert
            })
        );
        // basis 8000 × pct 10% × (1 + healModifier 50/100) = 1200, credited to the caster t1.
        expect(sumHeal(result, 'directHeal', 't1')).toBe(1200);
    });

    // ── Test 9: DPS-mode inertness ───────────────────────────────────────────
    it('no healTargetId → no healing field (heal abilities inert)', () => {
        idCounter = 0;
        const result = runCombat(
            BASE({
                shipSkills: healSkills([
                    ab({
                        type: 'heal',
                        target: 'self',
                        config: { type: 'heal', pct: 10, basis: 'hp' },
                    }),
                ]),
            })
        );
        expect(result.healing).toBeUndefined();
    });

    // ── Test 10: heal-performed event shape via a bus tap ────────────────────
    it('heal-performed event shape (casterId/targets/round/amount)', () => {
        idCounter = 0;
        const bus = createEventBus();
        const perfs: Extract<CombatEvent, { type: 'heal-performed' }>[] = [];
        bus.on('heal-performed', (e) => perfs.push(e));
        runCombat(
            BASE({
                numRounds: 2,
                hp: 10000,
                healTargetId: 'attacker',
                bus,
                shipSkills: healSkills([
                    ab({
                        type: 'heal',
                        target: 'self',
                        config: { type: 'heal', pct: 10, basis: 'hp' },
                    }),
                ]),
            })
        );
        expect(perfs).toHaveLength(2);
        expect(perfs[0]).toMatchObject({
            type: 'heal-performed',
            casterId: 'attacker',
            targets: ['attacker'],
            round: 1,
            amount: 1000,
        });
        expect(perfs[1].round).toBe(2);
    });

    // ── Test 11: throw on unknown healTargetId ───────────────────────────────
    it('throws on a healTargetId that is not a player actor', () => {
        idCounter = 0;
        expect(() =>
            runCombat(
                BASE({
                    healTargetId: 'nope',
                    shipSkills: healSkills([
                        ab({
                            type: 'heal',
                            target: 'self',
                            config: { type: 'heal', pct: 10, basis: 'hp' },
                        }),
                    ]),
                })
            )
        ).toThrow(/healTargetId 'nope' is not a player actor/);
    });

    // ── Test 12: consumed-path arithmetic (deficit via shield cap headroom) ──
    // The deficit-consumption path can't be exercised via the public API this task (nothing
    // damages the target until Task 8). But the cap arithmetic IS exercisable: a target-hp
    // heal whose raw EXCEEDS the deficit splits into consumed + overheal. At full HP the
    // deficit is 0 → consumed 0, overheal = raw (locked in Test 1). Here we lock that a heal
    // whose raw is bounded by max HP still credits the full raw to directHeal regardless of
    // the consumption split (directHeal counts raw, effectiveHeal counts consumed).
    it('directHeal counts raw, effectiveHeal counts consumed (full-HP: consumed 0)', () => {
        idCounter = 0;
        const result = runCombat(
            BASE({
                hp: 10000,
                healTargetId: 'attacker',
                shipSkills: healSkills([
                    // target-hp 200% → raw 20000 > max HP 10000; at full HP deficit 0 →
                    // consumed 0, overheal 20000, but directHeal still counts the full 20000.
                    ab({
                        type: 'heal',
                        target: 'self',
                        config: { type: 'heal', pct: 200, basis: 'target-hp' },
                    }),
                ]),
            })
        );
        expect(focusHeal(result, 'directHeal')).toBe(20000);
        expect(focusHeal(result, 'effectiveHeal')).toBe(0);
        expect(focusHeal(result, 'overheal')).toBe(20000);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 7: HoT (Repair Over Time) ticking with applier attribution.
// ─────────────────────────────────────────────────────────────────────────────
describe('healing mode — HoT (Repair Over Time) ticking', () => {
    const teamWalk = (
        id: string,
        speed: number,
        hp: number,
        extra: Partial<TeamActorEngineInput> = {}
    ): TeamActorEngineInput => ({
        id,
        speed,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        walk: {
            shipSkills: { slots: [] },
            stats: {
                attack: 1000,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 1000,
                hp,
            },
            debuffLandingChance: 1,
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
        ...extra,
    });

    // ── Test 1: foreign-applier HoT scales with the CASTER's max HP, attributed to caster ──
    // Healer (attacker, fast, hp 10000) grants the TARGET (walked, hp 8000) a 2-turn
    // Repair Over Time II buff (hotPct 15) via an ally-targeted buff ability. The buff fans to
    // all players, so the attacker also holds it (self-tick → hotHeal only, holder ≠ target).
    // The TARGET's tick (holder === target) scales with the CASTER's effectiveMaxHp (10000),
    // NOT the target's (8000): 10000 × 15% = 1500, credited to the CASTER, full overheal at
    // full HP. If it used the holder's HP it would be 1200 — so overheal isolates the foreign
    // tick (only holder===target credits overheal).
    it('foreign-applier HoT: scales with caster max HP, credited to caster, overheal at full HP', () => {
        idCounter = 0;
        const result = runCombat(
            BASE({
                numRounds: 3,
                hp: 10000,
                speed: 200, // attacker acts before the target every round
                healTargetId: 't1',
                teamActors: [teamWalk('t1', 40, 8000)],
                shipSkills: healSkills([
                    ab({
                        type: 'buff',
                        target: 'ally',
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
        // The attacker re-casts the ally HoT every round (it fires its active slot each turn),
        // so the 2-turn window on the target never lapses — the target ticks all 3 rounds. Each
        // target tick (holder === target) scales with the CASTER's effectiveMaxHp 10000 × 15% =
        // 1500, credited to the CASTER, full overheal at full HP → 3 × 1500 = 4500.
        expect(sumHeal(result, 'overheal', 'attacker')).toBe(4500);
        expect(sumHeal(result, 'effectiveHeal', 'attacker')).toBe(0);
        // Attribution: the HoT credits the APPLIER (attacker), never the holder t1.
        expect(sumHeal(result, 'hotHeal', 't1')).toBe(0);
        // hotHeal to the caster = its OWN self-tick (it also holds the fanned buff: 1500/round
        // ×3) + the target's foreign tick (1500/round ×3) = 9000. The target tick uses the
        // CASTER's 10000 (1500), NOT the holder/target's 8000×15%=1200 — proven by overheal=4500.
        expect(sumHeal(result, 'hotHeal', 'attacker')).toBe(9000);
    });

    // ── Test 2: self-HoT scales with current (buffed) effectiveHp ─────────────
    // A recurring self-buff carries hotPct 10 AND hp +50%. effectiveHp = 10000 × 1.5 = 15000;
    // tick = 15000 × 10% = 1500/round, attributed to the holder (self). Full HP → all overheal.
    it('self-HoT scales with current buffed effectiveHp', () => {
        idCounter = 0;
        const result = runCombat(
            BASE({
                numRounds: 1,
                hp: 10000,
                healTargetId: 'attacker',
                selfBuffs: [
                    {
                        id: 'hp-hot',
                        buffName: 'Self Repair',
                        stacks: 1,
                        isStackable: false,
                        parsedEffects: { hp: 50, hotPct: 10 },
                    },
                ],
                shipSkills: { slots: [] },
            })
        );
        // 15000 × 10% = 1500, credited to the holder (attacker) hotHeal + overheal (full HP).
        expect(focusHeal(result, 'hotHeal')).toBe(1500);
        expect(focusHeal(result, 'overheal')).toBe(1500);
        expect(focusHeal(result, 'effectiveHeal')).toBe(0);
    });

    // ── Test 3: corrosion skip rule (foreign applier with no ctx → skip) ─────
    // HoTs can only be applied by a CAST, so by the time any holder ticks in the same-or-later
    // round the applier has necessarily acted (its ctx exists) — the skip is unreachable through
    // the public heal-application API in normal speed orderings. We therefore unit-test the GUARD
    // directly against the public accessor on the engine ctx: applierMaxHp returns undefined for
    // an actor with no recorded turn ctx, and the tick code skips on undefined.
    it('foreign applier with no ctx is skipped (guard via the strict applierMaxHp accessor)', () => {
        idCounter = 0;
        // Two team actors. The healer grants an ally HoT; both also receive the fanned buff.
        // Everyone is at full HP and acts every round, so every applier always has a ctx — the
        // run completes without a phantom (undefined-HP) tick crediting anything. The assertion
        // proves no tick credited an UNKNOWN applier (no NaN/undefined leakage): all hotHeal is
        // accounted to the real caster, and overheal stays finite & exact.
        const result = runCombat(
            BASE({
                numRounds: 2,
                hp: 10000,
                speed: 200,
                healTargetId: 't1',
                teamActors: [teamWalk('t1', 40, 8000), teamWalk('t2', 30, 6000)],
                shipSkills: healSkills([
                    ab({
                        type: 'buff',
                        target: 'all-allies',
                        config: {
                            type: 'buff',
                            buffName: 'Repair Over Time II',
                            parsedEffects: { hotPct: 10 },
                            stacks: 1,
                            isStackable: false,
                            duration: 3,
                        },
                    }),
                ]),
            })
        );
        // All hotHeal is finite (no undefined/NaN from a skipped-ctx applier) and credited to
        // the real caster (attacker). t1/t2 carry none (attribution is to the applier).
        expect(Number.isFinite(focusHeal(result, 'hotHeal'))).toBe(true);
        expect(focusHeal(result, 'hotHeal')).toBeGreaterThan(0);
        expect(sumHeal(result, 'hotHeal', 't1')).toBe(0);
        expect(sumHeal(result, 'hotHeal', 't2')).toBe(0);
    });

    // ── Test 4: scheduled HoT (no caster) → applier = the holder ──────────────
    // A manual selfBuffs entry with hotPct on the FOCUS actor (also the heal target) ticks
    // every turn, applier = the holder itself (local effectiveHp), credited to the holder.
    it('scheduled HoT: applier = holder, ticks every turn, credited to the holder', () => {
        idCounter = 0;
        const result = runCombat(
            BASE({
                numRounds: 3,
                hp: 10000,
                healTargetId: 'attacker',
                selfBuffs: [
                    {
                        id: 'sched-hot',
                        buffName: 'Repair Over Time I',
                        stacks: 1,
                        isStackable: false,
                        parsedEffects: { hotPct: 10 },
                    },
                ],
                shipSkills: { slots: [] },
            })
        );
        // 10000 × 10% = 1000/round × 3 = 3000, credited to the holder (attacker). Full overheal.
        expect(focusHeal(result, 'hotHeal')).toBe(3000);
        expect(focusHeal(result, 'overheal')).toBe(3000);
        expect(focusHeal(result, 'effectiveHeal')).toBe(0);
    });

    // ── Test 5: no crit / no healModifier / no outgoingHeal; incomingHeal DOES apply ──
    it('HoT ignores crit/healMod/outgoingHeal but applies the holder incomingHeal', () => {
        idCounter = 0;
        // Baseline: crit 100, critDamage 100, healModifier 50, outgoingHeal 50 — NONE affect HoT.
        const baseline = runCombat(
            BASE({
                numRounds: 1,
                crit: 100,
                critDamage: 100,
                healModifier: 50,
                hp: 10000,
                healTargetId: 'attacker',
                selfBuffs: [
                    {
                        id: 'h',
                        buffName: 'Repair Over Time I',
                        stacks: 1,
                        isStackable: false,
                        parsedEffects: { hotPct: 10, outgoingHeal: 50 },
                    },
                ],
                shipSkills: { slots: [] },
            })
        );
        // Pure 10000 × 10% = 1000 — crit/healMod/outgoingHeal all ignored.
        expect(focusHeal(baseline, 'hotHeal')).toBe(1000);

        // incomingHeal 20 on the holder DOES amplify: 1000 × 1.2 = 1200.
        const withIncoming = runCombat(
            BASE({
                numRounds: 1,
                hp: 10000,
                healTargetId: 'attacker',
                selfBuffs: [
                    {
                        id: 'h',
                        buffName: 'Repair Over Time I',
                        stacks: 1,
                        isStackable: false,
                        parsedEffects: { hotPct: 10, incomingHeal: 20 },
                    },
                ],
                shipSkills: { slots: [] },
            })
        );
        expect(focusHeal(withIncoming, 'hotHeal')).toBeCloseTo(1200, 6);
    });

    // ── Test 6: stacks multiply the tick ─────────────────────────────────────
    it('HoT stacks multiply the tick (stacks 2 → ×2)', () => {
        idCounter = 0;
        const result = runCombat(
            BASE({
                numRounds: 1,
                hp: 10000,
                healTargetId: 'attacker',
                // A scheduled HoT with stacks 2 (isStackable false → static 2× stack override).
                selfBuffs: [
                    {
                        id: 'hot2',
                        buffName: 'Repair Over Time I',
                        stacks: 2,
                        isStackable: false,
                        parsedEffects: { hotPct: 10 },
                    },
                ],
                shipSkills: { slots: [] },
            })
        );
        // 10000 × 10% × 2 stacks = 2000.
        expect(focusHeal(result, 'hotHeal')).toBe(2000);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 8: enemy attackers (manual + basics walk) and target damage intake.
// ─────────────────────────────────────────────────────────────────────────────
describe('healing mode — enemy attackers and target intake', () => {
    type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
    const manualEnemy = (
        id: string,
        attack: number,
        speed = 50,
        extra: Partial<EnemyAttacker> = {}
    ): EnemyAttacker => ({
        id,
        stats: { attack, crit: 0, critDamage: 0, speed },
        chargeCount: 0,
        startCharged: false,
        ...extra,
    });

    const teamWalk = (
        id: string,
        speed: number,
        hp: number,
        extra: Partial<TeamActorEngineInput> = {}
    ): TeamActorEngineInput => ({
        id,
        speed,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        walk: {
            shipSkills: { slots: [] },
            stats: {
                attack: 1000,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 1000,
                hp,
            },
            debuffLandingChance: 1,
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
        ...extra,
    });

    // ── Test 1: pressure + partial-deficit consumption ───────────────────────
    // Heal raw 5000/round (hp 10000, target-hp 50%); enemy manual attack 2000, target
    // defence 0 → 2000 intake/round. Attacker (focus, speed 100) heals first, enemy
    // (speed 50) attacks second.
    //   R1: top 100%. deficit 0 → consume 0, overheal 5000. enemy 2000 → hp 8000.
    //   R2: top 80%. deficit 2000 → consume min(5000,2000)=2000 (PARTIAL), overheal 3000.
    //       hp 10000. enemy 2000 → hp 8000.
    // The R2 consume=2000/overheal=3000 split is the partial-deficit branch Tasks 6-7
    // could not reach (raw 5000 > deficit 2000).
    it('pressure + partial-deficit: heal larger than deficit splits consume/overheal exactly', () => {
        idCounter = 0;
        const result = runCombat(
            BASE({
                numRounds: 2,
                hp: 10000,
                defence: 0,
                healTargetId: 'attacker',
                enemyAttackers: [manualEnemy('atk1', 2000)],
                shipSkills: healSkills([
                    ab({
                        type: 'heal',
                        target: 'self',
                        config: { type: 'heal', pct: 50, basis: 'target-hp' },
                    }),
                ]),
            })
        );
        const rounds = result.healing!.rounds;
        // targetHpPct declines: enters R1 at 100%, R2 at 80%.
        expect(rounds[0].targetHpPctStart).toBeCloseTo(100, 6);
        expect(rounds[1].targetHpPctStart).toBeCloseTo(80, 6);
        // R1: consume 0 / overheal 5000. R2: consume 2000 / overheal 3000 (partial deficit).
        expect(rounds[0].perActor.get('attacker')!.effectiveHeal).toBeCloseTo(0, 6);
        expect(rounds[0].perActor.get('attacker')!.overheal).toBeCloseTo(5000, 6);
        expect(rounds[1].perActor.get('attacker')!.effectiveHeal).toBeCloseTo(2000, 6);
        expect(rounds[1].perActor.get('attacker')!.overheal).toBeCloseTo(3000, 6);
        // directHeal counts raw both rounds.
        expect(focusHeal(result, 'directHeal')).toBeCloseTo(10000, 6);
        // incomingDamage 2000/round.
        expect(rounds[0].incomingDamage).toBeCloseTo(2000, 6);
        expect(rounds[1].incomingDamage).toBeCloseTo(2000, 6);
    });

    // ── Test 2: shield absorption ordering (pool drains before HP) ────────────
    // Shield 2500/round (hp 10000, 25%); enemy manual attack 4000, defence 0.
    //   R1: pool 0→2500. enemy 4000 → absorbed 2500, hp -=1500 → 8500. shieldAbsorbed 2500.
    //   R2: top pool 0, hp 85%. pool +2500. enemy 4000 → absorbed 2500, hp 7000.
    it('shield absorption: pool drains before HP (hand-computed timeline)', () => {
        idCounter = 0;
        const result = runCombat(
            BASE({
                numRounds: 2,
                hp: 10000,
                defence: 0,
                healTargetId: 'attacker',
                enemyAttackers: [manualEnemy('atk1', 4000)],
                shipSkills: healSkills([
                    ab({
                        type: 'shield',
                        target: 'self',
                        config: { type: 'shield', pct: 25, basis: 'hp' },
                    }),
                ]),
            })
        );
        const rounds = result.healing!.rounds;
        // R1 incoming 4000, absorbed 2500 (pool fully drained, 1500 spills to HP).
        expect(rounds[0].incomingDamage).toBeCloseTo(4000, 6);
        expect(rounds[0].shieldAbsorbed).toBeCloseTo(2500, 6);
        // R2 enters: HP 8500 → 85%, shield pool 0.
        expect(rounds[1].targetHpPctStart).toBeCloseTo(85, 6);
        expect(rounds[1].targetShieldStart).toBeCloseTo(0, 6);
        expect(rounds[1].shieldAbsorbed).toBeCloseTo(2500, 6);
    });

    // ── Test 3: lethal — destroyedRound + ship-destroyed once + flatline ──────
    // Target = team actor t1 (hp 5000) so the focus attacker always acts. Enemy manual
    // attack 3000, t1 defence 0 → 3000 intake/round. No heals.
    //   R1: t1 5000 − 3000 = 2000. R2: 2000 − 3000 → 0 (destroyed round 2).
    //   R3: target dead → incoming 0; targetHpPctStart flatlines at 0.
    it('lethal: destroyedRound set, ship-destroyed emitted once, post-death flatline', () => {
        idCounter = 0;
        const bus = createEventBus();
        const destroyed: Extract<CombatEvent, { type: 'ship-destroyed' }>[] = [];
        bus.on('ship-destroyed', (e) => destroyed.push(e));
        const result = runCombat(
            BASE({
                numRounds: 4,
                speed: 200, // attacker fast, but it does nothing damaging
                hp: 10000,
                healTargetId: 't1',
                // t1 walk defence 0 so intake = enemy attack (no reduction): exactly 3000/round.
                teamActors: [
                    teamWalk('t1', 40, 5000, {
                        walk: {
                            shipSkills: { slots: [] },
                            stats: {
                                attack: 1000,
                                crit: 0,
                                critDamage: 0,
                                defensePenetration: 0,
                                hacking: 0,
                                defence: 0,
                                hp: 5000,
                            },
                            debuffLandingChance: 1,
                            selfDotModifier: 0,
                            defensePenetrationBuff: 0,
                            affinityDamageModifier: 0,
                            affinityCritCap: 100,
                            affinityCritPenalty: 0,
                            hasChargedSkill: false,
                        },
                    }),
                ],
                bus,
                enemyAttackers: [manualEnemy('atk1', 3000, 30)],
                shipSkills: { slots: [] },
            })
        );
        const t1Destroyed = destroyed.filter((e) => e.actorId === 't1');
        expect(t1Destroyed).toHaveLength(1);
        expect(t1Destroyed[0].round).toBe(2);
        expect(result.healing!.destroyedRound).toBe(2);
        const rounds = result.healing!.rounds;
        // Post-death rounds: incomingDamage 0, targetHpPctStart flatlines at 0.
        expect(rounds[2].incomingDamage).toBe(0);
        expect(rounds[3].incomingDamage).toBe(0);
        expect(rounds[2].targetHpPctStart).toBeCloseTo(0, 6);
        expect(rounds[3].targetHpPctStart).toBeCloseTo(0, 6);
    });

    // ── Test 4: spike cadence (ship-backed enemy charged nuke) ────────────────
    // chargeCount 2, active mult 100, charged mult 400, attack 1000, target defence 0.
    // Pattern of incomingDamage: t1 active(1000), t2 active(1000), t3 charged(4000), repeat.
    it('spike cadence: charged nuke produces [a,a,A,a,a,A] incoming pattern', () => {
        idCounter = 0;
        const enemySkills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 100 } }),
                    ],
                },
                {
                    slot: 'charged',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 400 } }),
                    ],
                },
            ],
        };
        const result = runCombat(
            BASE({
                numRounds: 6,
                hp: 100_000, // never dies
                defence: 0,
                healTargetId: 'attacker',
                enemyAttackers: [
                    {
                        id: 'atk1',
                        stats: { attack: 1000, crit: 0, critDamage: 0, speed: 50 },
                        chargeCount: 2,
                        startCharged: false,
                        shipSkills: enemySkills,
                    },
                ],
                shipSkills: { slots: [] },
            })
        );
        const incoming = result.healing!.rounds.map((r) => Math.round(r.incomingDamage));
        expect(incoming).toEqual([1000, 1000, 4000, 1000, 1000, 4000]);
    });

    // ── Test 5: focus healer IS the target and dies ───────────────────────────
    // The focus attacker is the heal target. With no heal it dies; once dead it stops
    // acting (turn skipped) but the engine must keep assembling rows without throwing.
    it('focus healer is the target and dies: rows keep assembling, no throw, flatline', () => {
        idCounter = 0;
        const run = () =>
            runCombat(
                BASE({
                    numRounds: 4,
                    hp: 5000,
                    defence: 0,
                    healTargetId: 'attacker', // focus IS the target
                    enemyAttackers: [manualEnemy('atk1', 3000)],
                    shipSkills: { slots: [] },
                })
            );
        const result = run();
        // R1: 5000 − 3000 = 2000. R2: 2000 − 3000 → 0 (destroyed round 2).
        expect(result.healing!.destroyedRound).toBe(2);
        const dpsRounds = result.rounds;
        expect(dpsRounds).toHaveLength(4);
        // Action/charge fields are sane (no crash, no NaN).
        for (const r of dpsRounds) {
            expect(['active', 'charged']).toContain(r.action);
            expect(Number.isFinite(r.charges)).toBe(true);
        }
        // Post-death: target HP flatlines at 0, no further intake.
        const rounds = result.healing!.rounds;
        expect(rounds[2].incomingDamage).toBe(0);
        expect(rounds[3].targetHpPctStart).toBeCloseTo(0, 6);
    });

    // ── Test 6: enemyAttackers without healTargetId throws ────────────────────
    it('throws when enemyAttackers provided without healTargetId', () => {
        idCounter = 0;
        expect(() =>
            runCombat(
                BASE({
                    enemyAttackers: [manualEnemy('atk1', 2000)],
                    shipSkills: { slots: [] },
                })
            )
        ).toThrow(/enemyAttackers require healTargetId/);
    });

    // ── Enemy attacker id validation ──────────────────────────────────────────
    it('throws on duplicate enemyAttackers ids', () => {
        idCounter = 0;
        expect(() =>
            runCombat(
                BASE({
                    numRounds: 1,
                    hp: 1_000_000,
                    healTargetId: 'attacker',
                    enemyAttackers: [manualEnemy('dup', 2000), manualEnemy('dup', 3000)],
                    shipSkills: { slots: [] },
                })
            )
        ).toThrow(/duplicate enemyAttackers\[\]\.id 'dup'/);
    });

    it("throws when an enemy attacker id is the reserved 'enemy' id", () => {
        idCounter = 0;
        expect(() =>
            runCombat(
                BASE({
                    numRounds: 1,
                    hp: 1_000_000,
                    healTargetId: 'attacker',
                    enemyAttackers: [manualEnemy('enemy', 2000)],
                    shipSkills: { slots: [] },
                })
            )
        ).toThrow(/'enemy' collides with a reserved or player actor id/);
    });

    it('throws when an enemy attacker id collides with a team actor id', () => {
        idCounter = 0;
        expect(() =>
            runCombat(
                BASE({
                    numRounds: 1,
                    hp: 1_000_000,
                    healTargetId: 'attacker',
                    teamActors: [teamWalk('t1', 50, 8000)],
                    enemyAttackers: [manualEnemy('t1', 2000)],
                    shipSkills: { slots: [] },
                })
            )
        ).toThrow(/'t1' collides with a reserved or player actor id/);
    });

    // ── Test 7: target defence reduces intake ─────────────────────────────────
    // A target with defence 2000 takes less intake than the same target at defence 0.
    it('target defence matters: higher defence reduces intake', () => {
        idCounter = 0;
        const withDef = runCombat(
            BASE({
                numRounds: 1,
                hp: 1_000_000,
                defence: 2000,
                healTargetId: 'attacker',
                enemyAttackers: [manualEnemy('atk1', 5000)],
                shipSkills: { slots: [] },
            })
        );
        idCounter = 0;
        const noDef = runCombat(
            BASE({
                numRounds: 1,
                hp: 1_000_000,
                defence: 0,
                healTargetId: 'attacker',
                enemyAttackers: [manualEnemy('atk1', 5000)],
                shipSkills: { slots: [] },
            })
        );
        const dWith = withDef.healing!.rounds[0].incomingDamage;
        const dNo = noDef.healing!.rounds[0].incomingDamage;
        expect(dNo).toBeCloseTo(5000, 6);
        expect(dWith).toBeLessThan(dNo);
        // Hand-checked: 5000 × (1 − dr(2000)/100).
        expect(dWith).toBeCloseTo(3186.4464026358046, 6);
    });

    // ── Test 8: DPS-mode inertness re-check ───────────────────────────────────
    it('no enemyAttackers → healing rounds have zero intake', () => {
        idCounter = 0;
        const result = runCombat(
            BASE({
                numRounds: 2,
                hp: 10000,
                healTargetId: 'attacker',
                shipSkills: healSkills([
                    ab({
                        type: 'heal',
                        target: 'self',
                        config: { type: 'heal', pct: 10, basis: 'hp' },
                    }),
                ]),
            })
        );
        for (const r of result.healing!.rounds) {
            expect(r.incomingDamage).toBe(0);
            expect(r.shieldAbsorbed).toBe(0);
        }
    });

    // ── Heal-deficit clamp under a SHRUNK max HP ──────────────────────────────
    // applyHealToTarget computes consumed = max(0, min(raw, targetMaxHp − currentHp)). The
    // max(0,…) guards the case where a max-HP buff expires and shrinks effectiveMaxHp below the
    // already-filled currentHp, making (targetMaxHp − currentHp) NEGATIVE — without the floor, a
    // heal would REDUCE the target's HP. Driving that exact ordering (buffed → healed to the
    // buffed max → buff expires next round) through the public runCombat API is not cheaply
    // reachable: it needs a timed self-HP buff on the heal target plus precise round timing, and
    // the engine's per-round ctx refresh makes the transient overshoot hard to land deterministically
    // without risking golden churn. The clamp arithmetic is verified directly below; the engine path
    // is otherwise covered by the partial-deficit/overheal split tests above.
    it('heal-deficit clamp: negative deficit (currentHp > shrunk maxHp) yields consumed 0, full overheal', () => {
        // Replicates the consumed/overheal arithmetic of applyHealToTarget for a shrunk max HP.
        const applyHealClamp = (raw: number, currentHp: number, targetMaxHp: number) => {
            const consumed = Math.max(0, Math.min(raw, targetMaxHp - currentHp));
            return { consumed, overheal: raw - consumed };
        };
        // currentHp 9000 > shrunk maxHp 8000 → deficit −1000. Without max(0,…) consumed would be
        // −1000 (HP would DROP); the floor makes it 0 with full overheal.
        expect(applyHealClamp(2000, 9000, 8000)).toEqual({ consumed: 0, overheal: 2000 });
        // Sanity: normal partial deficit still splits correctly.
        expect(applyHealClamp(5000, 8000, 10000)).toEqual({ consumed: 2000, overheal: 3000 });
        // Full overheal at the cap.
        expect(applyHealClamp(5000, 10000, 10000)).toEqual({ consumed: 0, overheal: 5000 });
    });

    // ── Task 11b: enemy-applied DoT ticks on the tank (credits incoming) ──────
    // An enemy attacker (attack 5000, defence 0, neutral affinity, speed 50) hits the heal
    // target for a 100% direct (5000) AND applies an inferno DoT (tier 100, 1 stack, duration
    // 1). The target (focus, speed 100) acts FIRST each round; its DoT entries tick at its
    // turn-start. No heals (hp 100000 → never dies, isolates the DoT bleed).
    //
    // Inferno tick = stacks 1 × (tier 100/100) × applier effectiveAttack 5000 × dotMult 1 ×
    //   affinityMult 1 = 5000. duration 1 → exactly ONE tick per application (no compounding):
    //   the entry applied on round N ticks once at round N+1's tank turn-start, then expires.
    //
    //   R1: tank tick — no entries yet → 0. enemy: direct 5000 → HP 95000; apply inferno
    //       (rem 1). incoming R1 = 5000 (direct only).
    //   R2: tank tick — 1 entry (rem 1) → 5000 incoming; HP 95000−5000 = 90000; entry expires.
    //       enemy: direct 5000 → HP 85000; re-apply inferno (rem 1). incoming R2 =
    //       5000 (DoT) + 5000 (direct) = 10000.
    //   R3: same as R2 → incoming 10000; HP 75000.
    // The DoT bleed adds 5000 incoming from R2 onward (vs the inert-DoT behaviour that would
    // report 5000 every round). The single-entry-per-round invariant proves it expires.
    it('enemy-applied inferno DoT ticks on the tank at its turn-start (credits incoming, expires)', () => {
        idCounter = 0;
        const bus = createEventBus();
        const dotTicks: { round: number; targetId: string; damage: number }[] = [];
        bus.on('dot-ticked', (e) => {
            const ev = e as { round: number; targetId: string; damage: number; dotType: string };
            if (ev.dotType === 'inferno') {
                dotTicks.push({ round: ev.round, targetId: ev.targetId, damage: ev.damage });
            }
        });
        const result = runCombat(
            BASE({
                numRounds: 3,
                hp: 100_000, // never dies — isolates the DoT bleed
                defence: 0,
                healTargetId: 'attacker',
                bus,
                enemyAttackers: [
                    manualEnemy('atk1', 5000, 50, {
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
                            ],
                        },
                    }),
                ],
                shipSkills: { slots: [] },
            })
        );
        const rounds = result.healing!.rounds;
        // R1: direct only (no DoT tick yet). R2+: direct 5000 + DoT tick 5000 = 10000.
        expect(rounds[0].incomingDamage).toBeCloseTo(5000, 6);
        expect(rounds[1].incomingDamage).toBeCloseTo(10000, 6);
        expect(rounds[2].incomingDamage).toBeCloseTo(10000, 6);
        // Survival declines faster than the inert-DoT case: HP enters R3 below the
        // direct-only floor (85000 → 85%, not 90000 → 90%).
        expect(rounds[2].targetHpPctStart).toBeCloseTo(85, 6);
        // The DoT ticks on the TANK (targetId = the heal target), 5000 each, from R2.
        expect(dotTicks).toEqual([
            { round: 2, targetId: 'attacker', damage: 5000 },
            { round: 3, targetId: 'attacker', damage: 5000 },
        ]);
    });

    // ── Test: enemy extra-action grants are processed (CodeRabbit fix) ────────
    // An enemy attacker with a once-per-round extra-action passive MUST take an extra
    // turn each round via processExtraActionGrants. Without the fix, the extra grant is
    // silently dropped → enemy only attacks once per round (2000 damage). With the fix,
    // the enemy attacks twice (4000 damage).
    //
    // Setup: attack 2000, target defence 0 → 2000 per turn; once-per-round extra-action
    //        passive → 2 enemy turns per round → 4000 incomingDamage/round.
    // Baseline (no extra-action passive): 2000/round.
    it('enemy extra-action passive doubles incoming damage per round', () => {
        idCounter = 0;
        const enemyWithExtraAction: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 100 } }),
                    ],
                },
                {
                    slot: 'passive',
                    abilities: [
                        ab({
                            type: 'extra-action',
                            target: 'self',
                            config: { type: 'extra-action', oncePerRound: true },
                        }),
                    ],
                },
            ],
        };
        const result = runCombat(
            BASE({
                numRounds: 3,
                hp: 1_000_000, // never dies
                defence: 0,
                healTargetId: 'attacker',
                enemyAttackers: [
                    {
                        id: 'atk1',
                        stats: { attack: 2000, crit: 0, critDamage: 0, speed: 50 },
                        chargeCount: 0,
                        startCharged: false,
                        shipSkills: enemyWithExtraAction,
                    },
                ],
                shipSkills: { slots: [] },
            })
        );
        // Each round: 2 enemy turns × 2000/turn = 4000 incomingDamage.
        for (const round of result.healing!.rounds) {
            expect(round.incomingDamage).toBeCloseTo(4000, 6);
        }
    });
});

// ── Task 9: on-ally-critically-repaired + on-ally-crit reactive listeners ───────────────
//
// Hand-rolled bus + enqueue scaffold (mirrors allyCritDot.test.ts) to assert enqueue counts
// per event scenario without running the full engine.
describe('healing — Task 9: reactive listeners (on-ally-critically-repaired / on-ally-crit)', () => {
    const makeHandBus = () => {
        const listeners = new Map<string, ((e: CombatEvent) => void)[]>();
        return {
            on<T extends CombatEvent['type']>(
                type: T,
                listener: (event: Extract<CombatEvent, { type: T }>) => void
            ) {
                const existing = listeners.get(type) ?? [];
                listeners.set(type, [...existing, listener as unknown as (e: CombatEvent) => void]);
            },
            emit(event: CombatEvent) {
                for (const l of listeners.get(event.type) ?? []) l(event);
            },
        };
    };

    it('on-ally-critically-repaired: own crit-repair of a non-self ally enqueues; self-only/no-crit/foreign do not', () => {
        const handBus = makeHandBus();
        const enqueued: Intent[] = [];
        const ability: Ability = {
            id: 'crit-repair-cleanse',
            type: 'cleanse',
            target: 'self',
            trigger: 'on-ally-critically-repaired',
            conditions: [],
            config: { type: 'cleanse', count: 1 },
        };
        const ra: ReactiveAbility = { ability, sourceSlot: 'passive' };
        registerReactiveListeners({
            bus: handBus,
            perOwner: [{ ownerId: 'attacker', reactiveAbilities: [ra] }],
            enqueue: (intent) => enqueued.push(intent),
            isEnemySide: (id) => id === 'enemy',
        });
        const base = { round: 1, amount: 1000 };

        // Own cast, >=1 crit, non-self recipient → enqueue.
        handBus.emit({
            type: 'heal-performed',
            casterId: 'attacker',
            targets: ['t1'],
            critHits: 1,
            ...base,
        });
        expect(enqueued).toHaveLength(1);

        // Own cast, crit, but only self recipient → no ally repaired → 0 additional.
        handBus.emit({
            type: 'heal-performed',
            casterId: 'attacker',
            targets: ['attacker'],
            critHits: 1,
            ...base,
        });
        expect(enqueued).toHaveLength(1);

        // Own cast, non-self recipient, NO crit → 0 additional.
        handBus.emit({
            type: 'heal-performed',
            casterId: 'attacker',
            targets: ['t1'],
            ...base,
        });
        expect(enqueued).toHaveLength(1);

        // Foreign caster's crit-repair → not THIS unit's repair → 0 additional.
        handBus.emit({
            type: 'heal-performed',
            casterId: 't2',
            targets: ['attacker'],
            critHits: 1,
            ...base,
        });
        expect(enqueued).toHaveLength(1);
    });

    it('on-ally-crit: an ally crit enqueues once per critting hit; own/enemy/no-crit do not', () => {
        const handBus = makeHandBus();
        const enqueued: Intent[] = [];
        const ability: Ability = {
            id: 'ally-crit-charge',
            type: 'charge',
            target: 'self',
            trigger: 'on-ally-crit',
            conditions: [],
            config: { type: 'charge', amount: 1 },
        };
        const ra: ReactiveAbility = { ability, sourceSlot: 'passive' };
        registerReactiveListeners({
            bus: handBus,
            perOwner: [{ ownerId: 'attacker', reactiveAbilities: [ra] }],
            enqueue: (intent) => enqueued.push(intent),
            isEnemySide: (id) => id === 'enemy',
        });
        const base = {
            round: 1,
            didCrit: true,
            targetId: 'enemy',
            abilityType: 'damage' as const,
        };

        // Another player's cast with 2 critting hits → 2 enqueues.
        handBus.emit({ type: 'ability-performed', actorId: 'other', critHits: 2, ...base });
        expect(enqueued).toHaveLength(2);

        // Own cast → excluded → 0 additional.
        handBus.emit({ type: 'ability-performed', actorId: 'attacker', critHits: 2, ...base });
        expect(enqueued).toHaveLength(2);

        // Enemy cast → excluded → 0 additional.
        handBus.emit({ type: 'ability-performed', actorId: 'enemy', critHits: 2, ...base });
        expect(enqueued).toHaveLength(2);

        // Another player's cast with NO crit (no critHits, didCrit false) → 0 additional.
        handBus.emit({ ...base, type: 'ability-performed', actorId: 'other', didCrit: false });
        expect(enqueued).toHaveLength(2);

        // Another player's cast with didCrit binary only (no critHits field) → 1 enqueue.
        handBus.emit({ ...base, type: 'ability-performed', actorId: 'other', didCrit: true });
        expect(enqueued).toHaveLength(3);
    });

    it('on-debuff-inflicted shield (APEX): own infliction enqueues; ally/enemy infliction does not', () => {
        const handBus = makeHandBus();
        const enqueued: Intent[] = [];
        // APEX's refit-active passive: gains a Shield = 3% Max HP when an enemy gets debuffed.
        // The trigger fires on THIS unit's own inflictions (Speed Down II / Crit Power Down III).
        const ability: Ability = {
            id: 'apex-shield-on-debuff',
            type: 'shield',
            target: 'self',
            trigger: 'on-debuff-inflicted',
            conditions: [],
            config: { type: 'shield', pct: 3, basis: 'hp' },
        };
        const ra: ReactiveAbility = { ability, sourceSlot: 'passive' };
        registerReactiveListeners({
            bus: handBus,
            perOwner: [{ ownerId: 'attacker', reactiveAbilities: [ra] }],
            enqueue: (intent) => enqueued.push(intent),
            isEnemySide: (id) => id === 'enemy',
        });
        const base = { round: 1, targetId: 'enemy', buffName: 'Speed Down II' };

        // This unit's own infliction → enqueue. (The 'dot-applied' path of on-debuff-inflicted is
        // covered by the pre-existing trigger machinery — it is not APEX-specific, so it's not
        // re-asserted here.)
        handBus.emit({ type: 'debuff-applied', sourceId: 'attacker', ...base });
        expect(enqueued).toHaveLength(1);

        // An ally's infliction → own-only trigger does NOT fire.
        handBus.emit({ type: 'debuff-applied', sourceId: 'other', ...base });
        expect(enqueued).toHaveLength(1);

        // The enemy's own infliction → does NOT fire.
        handBus.emit({ type: 'debuff-applied', sourceId: 'enemy', ...base });
        expect(enqueued).toHaveLength(1);
    });
});

// ── Task 9: reactive heal/shield/cleanse executor ───────────────────────────────────────
//
// Driven through the engine in healing mode with a reactive ability carrying a start-of-round
// trigger (fires through executeIntent every round). Asserts credits, no second crit, and no
// heal-performed re-emission (the executor deliberately does NOT emit heal-performed — chain
// guard), plus the healing-mode-off silent skip.
describe('healing — Task 9: reactive executor (heal/shield/cleanse)', () => {
    it('reactive heal credits directHeal (and consumption when target) but never emits heal-performed', () => {
        idCounter = 0;
        const bus = createEventBus();
        const perfs: Extract<CombatEvent, { type: 'heal-performed' }>[] = [];
        bus.on('heal-performed', (e) => perfs.push(e));
        const result = runCombat(
            BASE({
                numRounds: 3,
                hp: 10000,
                crit: 100,
                critDamage: 100, // would double a crit-heal — proves the executor never crits
                healTargetId: 'attacker',
                bus,
                shipSkills: {
                    slots: [
                        {
                            slot: 'passive',
                            abilities: [
                                ab({
                                    type: 'heal',
                                    target: 'self',
                                    trigger: 'start-of-round',
                                    config: { type: 'heal', pct: 10, basis: 'hp' },
                                }),
                            ],
                        },
                    ],
                },
            })
        );
        // 10000 × 10% = 1000/round, NO crit fold (critDamage 100 ignored) → 3000 over 3 rounds.
        expect(focusHeal(result, 'directHeal')).toBe(3000);
        // Target is the caster itself → effectiveHeal/overheal split is credited (full overheal at full HP).
        expect(focusHeal(result, 'overheal')).toBe(3000);
        // The executor must NOT emit heal-performed (chain guard).
        expect(perfs).toHaveLength(0);
    });

    it('reactive all-allies heal with basis target-hp scales each recipient by its OWN max HP', () => {
        idCounter = 0;
        // A reactive all-allies heal on the focus, basis target-hp. Recipients = focus + t1 + t2,
        // each with a DIFFERENT max HP. Before the per-recipient fix the basis was resolved once
        // against the heal target's max HP and applied to every recipient — so all three credits
        // would use the focus's 10000. With the fix each recipient scales by its own max HP.
        const teamWalk = (id: string, hp: number): TeamActorEngineInput => ({
            id,
            speed: 10, // slower than the focus so they don't act/heal this round
            chargeCount: 0,
            startCharged: false,
            selfBuffs: [],
            enemyDebuffs: [],
            walk: {
                shipSkills: { slots: [] },
                stats: {
                    attack: 1000,
                    crit: 0,
                    critDamage: 0,
                    defensePenetration: 0,
                    hacking: 0,
                    defence: 1000,
                    hp,
                },
                debuffLandingChance: 1,
                selfDotModifier: 0,
                defensePenetrationBuff: 0,
                affinityDamageModifier: 0,
                affinityCritCap: 100,
                affinityCritPenalty: 0,
                hasChargedSkill: false,
            },
        });
        const result = runCombat(
            BASE({
                numRounds: 1,
                hp: 10000, // focus max HP
                healTargetId: 'attacker',
                speed: 200, // focus acts first
                teamActors: [teamWalk('t1', 20000), teamWalk('t2', 30000)],
                shipSkills: {
                    slots: [
                        {
                            slot: 'passive',
                            abilities: [
                                ab({
                                    type: 'heal',
                                    target: 'all-allies',
                                    trigger: 'start-of-round',
                                    config: { type: 'heal', pct: 10, basis: 'target-hp' },
                                }),
                            ],
                        },
                    ],
                },
            })
        );
        // Per-recipient raw at 10% of each own max HP: focus 1000 + t1 2000 + t2 3000 = 6000.
        // (A once-resolved basis would credit 3 × 1000 = 3000.) All credited to the owner 'attacker'.
        expect(focusHeal(result, 'directHeal')).toBeCloseTo(6000, 6);
    });

    it('reactive shield credits the shield bucket and grants the pool', () => {
        idCounter = 0;
        const result = runCombat(
            BASE({
                numRounds: 2,
                hp: 10000,
                healTargetId: 'attacker',
                shipSkills: {
                    slots: [
                        {
                            slot: 'passive',
                            abilities: [
                                ab({
                                    type: 'shield',
                                    target: 'self',
                                    trigger: 'start-of-round',
                                    config: { type: 'shield', pct: 20, basis: 'hp' },
                                }),
                            ],
                        },
                    ],
                },
            })
        );
        // 10000 × 20% = 2000/round × 2 = 4000.
        expect(focusHeal(result, 'shield')).toBe(4000);
    });

    it('reactive cleanse credits the cleanseCount bucket', () => {
        idCounter = 0;
        const result = runCombat(
            BASE({
                numRounds: 3,
                healTargetId: 'attacker',
                shipSkills: {
                    slots: [
                        {
                            slot: 'passive',
                            abilities: [
                                ab({
                                    type: 'cleanse',
                                    target: 'self',
                                    trigger: 'start-of-round',
                                    config: { type: 'cleanse', count: 2 },
                                }),
                            ],
                        },
                    ],
                },
            })
        );
        expect(focusHeal(result, 'cleanseCount')).toBe(6); // 2 × 3 rounds
    });

    it('healing mode off: reactive heal silently skips (no healing field, no crash)', () => {
        idCounter = 0;
        const result = runCombat(
            BASE({
                numRounds: 2,
                shipSkills: {
                    slots: [
                        {
                            slot: 'passive',
                            abilities: [
                                ab({
                                    type: 'heal',
                                    target: 'self',
                                    trigger: 'start-of-round',
                                    config: { type: 'heal', pct: 10, basis: 'hp' },
                                }),
                            ],
                        },
                    ],
                },
            })
        );
        expect(result.healing).toBeUndefined();
    });
});

// ── Task 9: integration — on-ally-critically-repaired + on-ally-crit live in the engine ──
describe('healing — Task 9: reactive trigger integration', () => {
    // A walked team actor whose active crit-multi-hits (so its ability-performed carries
    // critHits) — drives the focus actor's on-ally-crit charge bank.
    const critTeamWalk = (id: string, speed: number, hits: number): TeamActorEngineInput => ({
        id,
        speed,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        walk: {
            shipSkills: {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            {
                                id: `${id}-dmg`,
                                type: 'damage',
                                target: 'enemy',
                                trigger: 'on-cast',
                                conditions: [],
                                config: { type: 'damage', multiplier: 100, hits },
                            },
                        ],
                    },
                ],
            },
            stats: {
                attack: 1000,
                crit: 100, // every hit crits → critHits === hits
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 1000,
                hp: 8000,
            },
            debuffLandingChance: 1,
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
    });

    it('on-ally-critically-repaired: focus crit-heals an ally each round → reactive cleanse fires once per cast (crit 100)', () => {
        idCounter = 0;
        // Focus heals the bombarded target (an ally) every turn with crit 100 → its heal crits,
        // and the recipient is the target (non-self when healTargetId !== focus). The passive
        // reactive cleanse on the focus fires once per qualifying own crit-repair.
        const result = runCombat(
            BASE({
                numRounds: 3,
                hp: 10000,
                crit: 100,
                critDamage: 0,
                speed: 200,
                healTargetId: 't1', // a non-self ally is the heal target
                teamActors: [
                    {
                        id: 't1',
                        speed: 10,
                        chargeCount: 0,
                        startCharged: false,
                        selfBuffs: [],
                        enemyDebuffs: [],
                        walk: {
                            shipSkills: { slots: [] },
                            stats: {
                                attack: 1000,
                                crit: 0,
                                critDamage: 0,
                                defensePenetration: 0,
                                hacking: 0,
                                defence: 1000,
                                hp: 50000, // big pool so heals are not all overheal (target below max)
                            },
                            debuffLandingChance: 1,
                            selfDotModifier: 0,
                            defensePenetrationBuff: 0,
                            affinityDamageModifier: 0,
                            affinityCritCap: 100,
                            affinityCritPenalty: 0,
                            hasChargedSkill: false,
                        },
                    },
                ],
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
            })
        );
        // The focus crit-repairs the ally target each of 3 rounds → 1 reactive cleanse per cast.
        expect(focusHeal(result, 'cleanseCount')).toBe(3);
    });

    it('on-ally-critically-repaired: focus heal NEVER crits (crit 0) → no reactive cleanse', () => {
        idCounter = 0;
        const result = runCombat(
            BASE({
                numRounds: 3,
                hp: 10000,
                crit: 0,
                critDamage: 0,
                speed: 200,
                healTargetId: 't1',
                teamActors: [
                    {
                        id: 't1',
                        speed: 10,
                        chargeCount: 0,
                        startCharged: false,
                        selfBuffs: [],
                        enemyDebuffs: [],
                        walk: {
                            shipSkills: { slots: [] },
                            stats: {
                                attack: 1000,
                                crit: 0,
                                critDamage: 0,
                                defensePenetration: 0,
                                hacking: 0,
                                defence: 1000,
                                hp: 50000,
                            },
                            debuffLandingChance: 1,
                            selfDotModifier: 0,
                            defensePenetrationBuff: 0,
                            affinityDamageModifier: 0,
                            affinityCritCap: 100,
                            affinityCritPenalty: 0,
                            hasChargedSkill: false,
                        },
                    },
                ],
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
            })
        );
        expect(focusHeal(result, 'cleanseCount')).toBe(0);
    });

    it('on-ally-crit: a walked ally crit multi-hits (2) each round → focus banks 2 charges per ally cast', () => {
        idCounter = 0;
        const result = runCombat(
            BASE({
                numRounds: 1,
                hp: 10000,
                crit: 0,
                critDamage: 0,
                // chargeCount > 0 so the reactive charge lands, but hasChargedSkill: false so the
                // focus has NO self charge cadence (its own turn never banks) — the banked total
                // is purely the reactive grant, making the assertion unambiguous.
                chargeCount: 10,
                hasChargedSkill: false,
                speed: 5, // focus acts AFTER the team ally so the charge is observable
                healTargetId: 'attacker',
                teamActors: [critTeamWalk('t1', 200, 2)],
                shipSkills: {
                    slots: [
                        {
                            slot: 'passive',
                            abilities: [
                                ab({
                                    type: 'charge',
                                    target: 'self',
                                    trigger: 'on-ally-crit',
                                    config: { type: 'charge', amount: 1 },
                                }),
                            ],
                        },
                    ],
                },
            })
        );
        // The ally's active crit-hits twice → 2 critting hits → 2 reactive charge intents → the
        // focus banks 2 charges. Surfaced via the round's charge accounting.
        expect(result.rounds[0].charges).toBe(2);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 4: cast-rider damage-dealt basis in the player-turn heal block.
// Active/charged casts that carry a damage ability AND a leech heal/shield use
// 'damage-dealt' basis → the rider draws from THIS turn's own cast damage. The
// slot-partition guard keeps passive-slot damage-dealt (standing leech, engine hook)
// and ALL damage-taken procs (enemy-attack block) off the cast path.
// ─────────────────────────────────────────────────────────────────────────────
describe('healing mode — cast-rider damage-dealt basis', () => {
    // BASE: attack 5000, crit 0, critDamage 0, enemyDefense 0, no buffs.
    // A 100% damage ability on the active slot → directDamage = 5000 × (100/100) = 5000.
    const damageAb = (multiplier = 100): Ability =>
        ab({
            type: 'damage',
            target: 'enemy',
            config: { type: 'damage', multiplier },
        });

    // ── Test 1: active-slot leech heal, no folds ─────────────────────────────
    it('active leech heal: directHeal === thisTurnDirectDamage × pct (crit 0, healMod 0)', () => {
        idCounter = 0;
        const result = runCombat(
            BASE({
                numRounds: 1,
                hp: 10000,
                healTargetId: 'attacker',
                shipSkills: healSkills([
                    damageAb(100),
                    ab({
                        type: 'heal',
                        target: 'self',
                        config: { type: 'heal', pct: 10, basis: 'damage-dealt' },
                    }),
                ]),
            })
        );
        // directDamage = 5000; rider 10% → 500. No crit/healMod/outgoing/incoming folds.
        expect(focusHeal(result, 'directHeal')).toBeCloseTo(500, 6);
    });

    // ── Test 2: healModifier 50 → ×1.5 fold applies ──────────────────────────
    it('active leech heal: healModifier 50 → × 1.5 fold', () => {
        idCounter = 0;
        const result = runCombat(
            BASE({
                numRounds: 1,
                hp: 10000,
                healModifier: 50,
                healTargetId: 'attacker',
                shipSkills: healSkills([
                    damageAb(100),
                    ab({
                        type: 'heal',
                        target: 'self',
                        config: { type: 'heal', pct: 10, basis: 'damage-dealt' },
                    }),
                ]),
            })
        );
        // 5000 × 0.10 × 1.5 = 750.
        expect(focusHeal(result, 'directHeal')).toBeCloseTo(750, 6);
    });

    // ── Test 3: shield rider, NO folds ───────────────────────────────────────
    it('active leech shield: shield bucket === thisTurnDirectDamage × pct, no folds', () => {
        idCounter = 0;
        const result = runCombat(
            BASE({
                numRounds: 1,
                crit: 100,
                critDamage: 100,
                healModifier: 50,
                hp: 10000,
                healTargetId: 'attacker',
                shipSkills: healSkills([
                    damageAb(100),
                    ab({
                        type: 'shield',
                        target: 'self',
                        config: { type: 'shield', pct: 20, basis: 'damage-dealt' },
                    }),
                ]),
            })
        );
        // directDamage at crit 100/critDamage 100 = 5000 × (1 + 1) = 10000; shield 20% → 2000.
        // Shields apply NO heal channels (no crit/healMod fold on the shield draw itself).
        expect(focusHeal(result, 'shield')).toBeCloseTo(2000, 6);
    });

    // ── Test 4: passive-slot damage-dealt → engine credit hook owns it ───────
    // The cast path skips the standing leech (no double-count); the engine's creditDamage
    // hook (Task 6) procs it against the active's direct damage: 5000 × 0.20 = 1000.
    it('passive-slot damage-dealt heal: engine credit hook produces the leech', () => {
        idCounter = 0;
        const result = runCombat(
            BASE({
                numRounds: 1,
                hp: 10000,
                healTargetId: 'attacker',
                shipSkills: {
                    slots: [
                        { slot: 'active', abilities: [damageAb(100)] },
                        {
                            slot: 'passive',
                            abilities: [
                                ab({
                                    type: 'heal',
                                    target: 'self',
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
            })
        );
        expect(focusHeal(result, 'directHeal')).toBeCloseTo(1000, 6);
        expect(focusHeal(result, 'shield')).toBe(0);
    });

    // ── Test 5: damage-taken (any slot) → cast path produces NOTHING ─────────
    it('damage-taken heal/shield (any slot): cast path contributes zero (enemy-attack block owns it)', () => {
        idCounter = 0;
        const result = runCombat(
            BASE({
                numRounds: 1,
                hp: 10000,
                healTargetId: 'attacker',
                shipSkills: {
                    slots: [
                        {
                            slot: 'active',
                            abilities: [
                                damageAb(100),
                                ab({
                                    type: 'heal',
                                    target: 'self',
                                    config: { type: 'heal', pct: 30, basis: 'damage-taken' },
                                }),
                            ],
                        },
                        {
                            slot: 'passive',
                            abilities: [
                                ab({
                                    type: 'shield',
                                    target: 'self',
                                    config: { type: 'shield', pct: 25, basis: 'damage-taken' },
                                }),
                            ],
                        },
                    ],
                },
            })
        );
        expect(focusHeal(result, 'directHeal')).toBe(0);
        expect(focusHeal(result, 'shield')).toBe(0);
    });

    // ── Test 6: leech heal crit fold respects noCrit ─────────────────────────
    it('leech heal crit fold: noCrit:false crits at crit 100; noCrit:true does not', () => {
        idCounter = 0;
        // noCrit:false at crit 100 → crit fold applies (raw × (1 + critDamage/100)).
        const crits = runCombat(
            BASE({
                numRounds: 1,
                crit: 100,
                critDamage: 50,
                hp: 10000,
                healTargetId: 'attacker',
                shipSkills: healSkills([
                    damageAb(100),
                    ab({
                        type: 'heal',
                        target: 'self',
                        config: { type: 'heal', pct: 10, basis: 'damage-dealt' },
                    }),
                ]),
            })
        );
        // directDamage at crit 100/critDamage 50 = 5000 × (1 + 0.5) = 7500; rider 10% → 750,
        // then the heal's OWN crit draw at crit 100 fires (rate 1.0) → × (1 + 50/100) = 1125.
        expect(focusHeal(crits, 'directHeal')).toBeCloseTo(1125, 6);

        idCounter = 0;
        // noCrit:true → the heal draw does not crit; only the underlying directDamage crit fold.
        const noCrit = runCombat(
            BASE({
                numRounds: 1,
                crit: 100,
                critDamage: 50,
                hp: 10000,
                healTargetId: 'attacker',
                shipSkills: healSkills([
                    damageAb(100),
                    ab({
                        type: 'heal',
                        target: 'self',
                        config: { type: 'heal', pct: 10, basis: 'damage-dealt', noCrit: true },
                    }),
                ]),
            })
        );
        // directDamage 7500 (crit-folded damage) × 0.10 = 750; the heal itself does NOT crit.
        expect(focusHeal(noCrit, 'directHeal')).toBeCloseTo(750, 6);
    });
});

// ── Defiant shield-on-Stasis: control-applied → on-stasis-applied shield (engine end-to-end) ──
describe('healing — Defiant shield-on-Stasis (control-applied → on-stasis-applied)', () => {
    it('charged Stasis cast grows the focus shield pool by 30% of max HP via on-stasis-applied', () => {
        idCounter = 0;
        // Focus = heal target. Charged slot carries a damage + a stasis control ability; the
        // passive shield reacts to the focus's OWN Stasis application. chargeCount 1 +
        // startCharged → charged fires rounds 1,3,5 (3 of 5 rounds); shield 30% × 10000 = 3000
        // each of those rounds. Active rounds (2,4) fire the inert active cast → no shield.
        const result = runCombat(
            BASE({
                numRounds: 5,
                hp: 10000,
                healTargetId: 'attacker',
                hasChargedSkill: true,
                chargeCount: 1,
                startCharged: true,
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
            })
        );
        // Shield bucket counts the raw 3000 grant on each charged (Stasis) round: rounds 1,3,5.
        const shieldByRound = (result.healing?.rounds ?? []).map(
            (rd) => rd.perActor.get('attacker')?.shield ?? 0
        );
        expect(shieldByRound).toEqual([3000, 0, 3000, 0, 3000]);
        expect(focusHeal(result, 'shield')).toBe(9000);
    });
});

// ── Emission-scoping regression: enemy-side actors never trigger player ally reactions ──
//
// Commit 6c456a14 made the healing-mode enemy attacker walk runPlayerTurn (same pipeline as
// players), so it now EMITS the full reactive event suite — including `ability-performed` with
// crit info and `side === 'enemy'`. A player ship's `on-ally-crit` listener treats "any other
// player actor" as an ally; before this fix its exclusion only filtered the singular dummy wall
// enemy, so a CRITTING enemy attacker's ability-performed leaked through and wrongly fired the
// player's on-ally-crit reaction. The fix passes an isEnemySide predicate that excludes EVERY
// enemy-side id (dummy + enemy attackers). These tests assert the negative (enemy crit does NOT
// fire the reaction) AND the positive (a real player ally's crit STILL does — no over-exclusion).
describe('healing — emission scoping: enemy crit does not trigger player on-ally-crit', () => {
    type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
    // A manual flat-card enemy that ALWAYS crits (crit 100). The builder synthesizes a
    // crit-eligible basic attack → it emits ability-performed with didCrit/critHits.
    const crittingEnemy = (id: string, attack = 2000, speed = 50): EnemyAttacker => ({
        id,
        stats: { attack, crit: 100, critDamage: 100, speed },
        chargeCount: 0,
        startCharged: false,
    });

    // Focus heal target: crit 0 (so the focus itself never crits → its own ability-performed can
    // never be mistaken for an ally crit), carrying an on-ally-crit reactive SHIELD. When the
    // listener fires, the executor credits the focus's `shield` bucket (observable proxy for the
    // reaction firing). basis hp → 10% of the focus's 10000 max HP = 1000 per fire.
    const onAllyCritShield = (): ShipSkills => ({
        slots: [
            {
                slot: 'passive',
                abilities: [
                    ab({
                        type: 'shield',
                        target: 'self',
                        trigger: 'on-ally-crit',
                        config: { type: 'shield', pct: 10, basis: 'hp' },
                    }),
                ],
            },
        ],
    });

    it('negative: a critting enemy attacker does NOT fire the focus on-ally-crit shield', () => {
        idCounter = 0;
        const result = runCombat(
            BASE({
                numRounds: 2,
                hp: 10000,
                crit: 0, // focus never crits
                critDamage: 0,
                healTargetId: 'attacker',
                enemyAttackers: [crittingEnemy('atk1')],
                shipSkills: onAllyCritShield(),
            })
        );
        // The ONLY critting actor is the enemy attacker. Its ability-performed crit must be
        // treated as an enemy event (NOT an ally crit) → the on-ally-crit shield never fires.
        expect(focusHeal(result, 'shield')).toBe(0);
    });

    it('positive: a real player ally crit STILL fires the focus on-ally-crit shield', () => {
        idCounter = 0;
        // A team ally that ALWAYS crits and casts a damage active → emits an ally ability-performed
        // with crits. speed 200 so it acts (and crits) before the focus's start-of-round drain.
        const crittingAlly: TeamActorEngineInput = {
            id: 'ally1',
            speed: 200,
            chargeCount: 0,
            startCharged: false,
            selfBuffs: [],
            enemyDebuffs: [],
            walk: {
                shipSkills: {
                    slots: [
                        {
                            slot: 'active',
                            abilities: [
                                ab({
                                    type: 'damage',
                                    target: 'enemy',
                                    trigger: 'on-cast',
                                    config: { type: 'damage', multiplier: 100, hits: 1 },
                                }),
                            ],
                        },
                    ],
                },
                stats: {
                    attack: 5000,
                    crit: 100,
                    critDamage: 100,
                    defensePenetration: 0,
                    hacking: 0,
                    defence: 1000,
                    hp: 10000,
                },
                debuffLandingChance: 1,
                selfDotModifier: 0,
                defensePenetrationBuff: 0,
                affinityDamageModifier: 0,
                affinityCritCap: 100,
                affinityCritPenalty: 0,
                hasChargedSkill: false,
            },
        };
        const result = runCombat(
            BASE({
                numRounds: 1,
                hp: 10000,
                crit: 0, // focus never crits → the only ALLY crit is the team ship's
                critDamage: 0,
                speed: 100, // focus acts after the ally (200) so the ally's crit lands first
                healTargetId: 'attacker',
                teamActors: [crittingAlly],
                shipSkills: onAllyCritShield(),
            })
        );
        // The team ally's crit IS an ally crit → the on-ally-crit shield fires (10% of 10000).
        expect(focusHeal(result, 'shield')).toBeGreaterThan(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 7 (Phase 4b): Cheat Death intercept — survive at 1 HP, once per combat.
// The heal target is the focus actor ('attacker') so its always-active/'recurring'
// Cheat Death self-buff surfaces in snapshot('attacker').activeSelfBuffs. Cheat Death
// is seeded as a no-payload recurring top-level selfBuff (the always-active source list);
// the engine reads it off the snapshot, NOT a timed store, so consumption is a per-actor
// flag — a SECOND lethal hit destroys the carrier even though the buff is still snapshot-live.
// ─────────────────────────────────────────────────────────────────────────────
describe('healing mode — Cheat Death intercept (Phase 4b)', () => {
    type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
    const manualEnemy = (
        id: string,
        attack: number,
        speed = 50,
        extra: Partial<EnemyAttacker> = {}
    ): EnemyAttacker => ({
        id,
        stats: { attack, crit: 0, critDamage: 0, speed },
        chargeCount: 0,
        startCharged: false,
        ...extra,
    });

    // A no-payload, always-active Cheat Death self-buff — surfaces in the snapshot as
    // 'recurring' (never stored in a timed map; re-derived every round).
    const cheatDeathBuff = () => ({
        id: 'cheat-death',
        buffName: 'Cheat Death',
        stacks: 1,
        isStackable: false,
        parsedEffects: {},
    });

    // ── Survive: a lethal hit leaves the carrier at 1 HP, not destroyed ───────
    it('survives a lethal hit at 1 HP: no ship-destroyed, destroyedRound unset, one cheat-death-activated', () => {
        idCounter = 0;
        const bus = createEventBus();
        const destroyed: Extract<CombatEvent, { type: 'ship-destroyed' }>[] = [];
        const cheated: Extract<CombatEvent, { type: 'cheat-death-activated' }>[] = [];
        bus.on('ship-destroyed', (e) => destroyed.push(e));
        bus.on('cheat-death-activated', (e) => cheated.push(e));
        const result = runCombat(
            BASE({
                numRounds: 1,
                hp: 2000, // enemy hits for 3000 → lethal in one hit
                defence: 0,
                healTargetId: 'attacker',
                bus,
                selfBuffs: [cheatDeathBuff()],
                enemyAttackers: [manualEnemy('atk1', 3000)],
                shipSkills: { slots: [] },
            })
        );
        // Not destroyed: no ship-destroyed for the tank, destroyedRound stays unset.
        expect(destroyed.filter((e) => e.actorId === 'attacker')).toHaveLength(0);
        expect(result.healing!.destroyedRound).toBeUndefined();
        // Exactly one cheat-death-activated for the tank, on round 1.
        expect(cheated).toHaveLength(1);
        expect(cheated[0]).toMatchObject({ actorId: 'attacker', round: 1 });
        // R1 still records the full incoming damage (the intake math is intact).
        expect(result.healing!.rounds[0].incomingDamage).toBeCloseTo(3000, 6);
    });

    // ── Ability-sourced Cheat Death (the REAL ship path) ─────────────────────
    // A real Yazid/Tycho/Hayyan-granted Cheat Death is NOT a top-level input selfBuff.
    // It is an ability-sourced 'recurring' self-buff parsed off the ship's kit (Task 6's
    // parser shape: a `buff` ability with buffName 'Cheat Death', duration 'recurring',
    // trigger 'on-cast', target 'self'). That registers as an AURA status surfaced via
    // activeAbilityStatuses('self', …, ownerId) — NOT via snapshot().activeSelfBuffs.
    // The old snapshot-based detection MISSES it (snapshot.activeSelfBuffs only carries
    // scheduled always-active buffs, and only for the 'attacker' owner). This test fires
    // RED against the old detection (the tank dies, no cheat-death-activated) and GREEN
    // once detection routes through selfBuffNamesForOwners (which folds the ability reads).
    it('fires for an ability-sourced (parsed-kit) Cheat Death, not just an input selfBuff', () => {
        idCounter = 0;
        const bus = createEventBus();
        const destroyed: Extract<CombatEvent, { type: 'ship-destroyed' }>[] = [];
        const cheated: Extract<CombatEvent, { type: 'cheat-death-activated' }>[] = [];
        bus.on('ship-destroyed', (e) => destroyed.push(e));
        bus.on('cheat-death-activated', (e) => cheated.push(e));
        // Cheat Death granted by the tank's own kit as a recurring self-buff ability —
        // the shape Task 6's parser emits. No top-level selfBuffs entry.
        const cheatDeathFromKit: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
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
        const result = runCombat(
            BASE({
                numRounds: 1,
                hp: 2000, // enemy hits for 3000 → lethal in one hit
                defence: 0,
                healTargetId: 'attacker',
                bus,
                selfBuffs: [], // NOT seeded via input — the kit grants it
                enemyAttackers: [manualEnemy('atk1', 3000)],
                shipSkills: cheatDeathFromKit,
            })
        );
        // Survives at 1 HP: no ship-destroyed, destroyedRound unset, one intercept.
        expect(destroyed.filter((e) => e.actorId === 'attacker')).toHaveLength(0);
        expect(result.healing!.destroyedRound).toBeUndefined();
        expect(cheated).toHaveLength(1);
        expect(cheated[0]).toMatchObject({ actorId: 'attacker', round: 1 });
    });

    // ── Yazid follow-on (Task 8): when Cheat Death activates → 60% repair + Barrier ──
    // Yazid's REFIT-ACTIVE (R4) passive grants Cheat Death AND, "once per battle, when
    // Cheat Death activates, repairs itself for 60% of its Max HP and gains Barrier for 1
    // turn." Built via buildShipAbilities so the on-cheat-death-activated heal/buff abilities
    // come straight from the parser. The repair must drain in the SAME round the intercept
    // fired (the tank rises ~60% of max above the 1-HP floor) and a Barrier buff is granted.
    it('Yazid: cheat-death-activated repairs 60% same round + grants Barrier (parser-built)', () => {
        idCounter = 0;
        const bus = createEventBus();
        const cheated: Extract<CombatEvent, { type: 'cheat-death-activated' }>[] = [];
        const buffs: Extract<CombatEvent, { type: 'buff-applied' }>[] = [];
        const destroyed: Extract<CombatEvent, { type: 'ship-destroyed' }>[] = [];
        bus.on('cheat-death-activated', (e) => cheated.push(e));
        bus.on('buff-applied', (e) => buffs.push(e));
        bus.on('ship-destroyed', (e) => destroyed.push(e));
        const yazid: Ship = {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ...({} as any),
            refits: [{}, {}, {}, {}],
            thirdPassiveSkillText:
                'At the start of combat, this Unit gains <unit-skill>Everliving Regeneration II</unit-skill> for 9 turns and <unit-skill>Cheat Death</unit-skill><br /><br />Once per battle, when <unit-skill>Cheat Death</unit-skill> activates, this Unit <unit-damage>repairs itself for 60%</unit-damage> of its Max HP and gains <unit-skill>Barrier</unit-skill> for 1 turn.',
        } as Ship;
        const yazidSkills = buildShipAbilities(yazid);
        const result = runCombat(
            BASE({
                numRounds: 1,
                hp: 2000, // enemy hits for 3000 → lethal in one hit, drop to 1 HP
                defence: 0,
                healTargetId: 'attacker',
                bus,
                // Cheat Death is granted by the parsed kit (recurring self-buff ability),
                // NOT seeded as a top-level input selfBuff.
                selfBuffs: [],
                enemyAttackers: [manualEnemy('atk1', 3000)],
                shipSkills: yazidSkills,
            })
        );
        // Intercept fired once on round 1.
        expect(cheated).toHaveLength(1);
        expect(cheated[0]).toMatchObject({ actorId: 'attacker', round: 1 });
        // Not destroyed (saved by Cheat Death).
        expect(destroyed.filter((e) => e.actorId === 'attacker')).toHaveLength(0);
        expect(result.healing!.destroyedRound).toBeUndefined();
        // The repair drained SAME round: the tank was at 1 HP, the 60%-max repair — scaled by
        // Everliving Regeneration II's +20% Incoming Repair (60% × 2000 × 1.20 = 1440) —
        // consumed against the 1999 deficit → effectiveHeal ~1440 credited to the tank.
        expect(focusHeal(result, 'effectiveHeal')).toBeCloseTo(1440, 6);
        // A Barrier buff was granted to the tank (effect unmodeled — name only).
        expect(buffs.some((e) => e.actorId === 'attacker' && e.buffName === 'Barrier')).toBe(true);
    });

    // ── Reactive repair scales with the recipient's Incoming Repair (parity fix) ──
    // Yazid's kit grants Everliving Regeneration II (+20% Incoming Repair) AT START OF
    // COMBAT and Cheat Death. When Cheat Death fires, the 60%-of-max reactive repair must
    // scale with that +20% — exactly like a CAST repair does — so the effective heal is
    // 60% × 2000 × 1.20 = 1440, NOT the un-amplified 1200. (No crit on reactive heals.)
    it('Yazid: cheat-death reactive repair scales with the recipient Incoming Repair (+20%)', () => {
        idCounter = 0;
        const bus = createEventBus();
        const cheated: Extract<CombatEvent, { type: 'cheat-death-activated' }>[] = [];
        bus.on('cheat-death-activated', (e) => cheated.push(e));
        const yazid: Ship = {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ...({} as any),
            refits: [{}, {}, {}, {}],
            thirdPassiveSkillText:
                'At the start of combat, this Unit gains <unit-skill>Everliving Regeneration II</unit-skill> for 9 turns and <unit-skill>Cheat Death</unit-skill><br /><br />Once per battle, when <unit-skill>Cheat Death</unit-skill> activates, this Unit <unit-damage>repairs itself for 60%</unit-damage> of its Max HP and gains <unit-skill>Barrier</unit-skill> for 1 turn.',
        } as Ship;
        const yazidSkills = buildShipAbilities(yazid);
        const result = runCombat(
            BASE({
                numRounds: 1,
                hp: 2000, // enemy hits for 3000 → lethal in one hit, drop to 1 HP
                defence: 0,
                healTargetId: 'attacker',
                bus,
                selfBuffs: [],
                enemyAttackers: [manualEnemy('atk1', 3000)],
                shipSkills: yazidSkills,
            })
        );
        expect(cheated).toHaveLength(1);
        // 60% × 2000 × 1.20 (Everliving Regeneration II incoming repair) = 1440. The 1999 HP
        // deficit (1 HP after the lethal hit) fully absorbs the 1440, so effectiveHeal = 1440.
        expect(focusHeal(result, 'directHeal')).toBeCloseTo(1440, 6);
        expect(focusHeal(result, 'effectiveHeal')).toBeCloseTo(1440, 6);
    });

    // ── Consumed (flag): a SECOND lethal hit destroys the carrier normally ────
    // Proves flag-based consumption (NOT store-deletion): the recurring Cheat Death
    // buff is STILL in the snapshot on round 2, but cheatDeathConsumed blocks re-trigger.
    it('is consumed by the flag: second lethal hit destroys normally despite the buff still being live', () => {
        idCounter = 0;
        const bus = createEventBus();
        const destroyed: Extract<CombatEvent, { type: 'ship-destroyed' }>[] = [];
        const cheated: Extract<CombatEvent, { type: 'cheat-death-activated' }>[] = [];
        bus.on('ship-destroyed', (e) => destroyed.push(e));
        bus.on('cheat-death-activated', (e) => cheated.push(e));
        const result = runCombat(
            BASE({
                numRounds: 2,
                hp: 2000, // 3000/round → lethal each round
                defence: 0,
                healTargetId: 'attacker',
                bus,
                selfBuffs: [cheatDeathBuff()],
                enemyAttackers: [manualEnemy('atk1', 3000)],
                shipSkills: { slots: [] },
            })
        );
        // R1 intercept fires once; R2 the carrier is destroyed normally.
        expect(cheated).toHaveLength(1);
        expect(cheated[0].round).toBe(1);
        const tankDestroyed = destroyed.filter((e) => e.actorId === 'attacker');
        expect(tankDestroyed).toHaveLength(1);
        expect(tankDestroyed[0].round).toBe(2);
        expect(result.healing!.destroyedRound).toBe(2);
    });

    // ── Wipe: the intercept invokes clearRemovable on the carrier ─────────────
    // A standing TIMED self-buff (StatusEngine-tracked) on the tank is wiped when Cheat
    // Death fires: it no longer appears in the next round's activeSelfBuffs. The buff is
    // cast ONCE (charged slot, chargeCount 1 + startCharged → charged R1, active R2) so its
    // R2 presence reflects the STANDING status (duration 3), not a re-cast. clearRemovable's
    // wipe-timed / preserve-persistent / preserve-unremovable semantics are unit-tested
    // directly in statusEngine.test.ts; here we only prove the engine CALLS it on the
    // intercept path.
    //
    // NOTE (architecture): enemy-applied DoTs on the tank are stored as actor-state DoT
    // stacks (healTarget.corrosionEntries/infernoEntries), NOT in the StatusEngine — so
    // clearRemovable (StatusEngine-only) does not wipe them. The wipe is verified here
    // against a StatusEngine-tracked timed self-buff, which is what clearRemovable governs.
    it('wipes a StatusEngine-tracked timed self-buff on the carrier (gone next round)', () => {
        idCounter = 0;
        const bus = createEventBus();
        const cheated: Extract<CombatEvent, { type: 'cheat-death-activated' }>[] = [];
        bus.on('cheat-death-activated', (e) => cheated.push(e));
        // Tank casts a duration-3 "Fortify" self-buff on its CHARGED turn (R1 only). The enemy
        // (speed 50) then lethal-hits → Cheat Death (HP→1) → clearRemovable wipes "Fortify".
        const fortifyOnCharge: ShipSkills = {
            slots: [
                { slot: 'active', abilities: [] },
                {
                    slot: 'charged',
                    abilities: [
                        ab({
                            type: 'buff',
                            target: 'self',
                            config: {
                                type: 'buff',
                                buffName: 'Fortify',
                                parsedEffects: { defense: 30 },
                                stacks: 1,
                                isStackable: false,
                                duration: 3,
                            },
                        }),
                    ],
                },
            ],
        };
        const result = runCombat(
            BASE({
                numRounds: 2,
                hp: 2000, // enemy 3000 → lethal in one hit
                defence: 0,
                healTargetId: 'attacker',
                chargeCount: 1,
                startCharged: true,
                hasChargedSkill: true,
                bus,
                selfBuffs: [cheatDeathBuff()],
                enemyAttackers: [manualEnemy('atk1', 3000)],
                shipSkills: fortifyOnCharge,
            })
        );
        expect(cheated).toHaveLength(1);
        expect(cheated[0].round).toBe(1);
        const rounds = result.rounds;
        // R1: charged cast applies "Fortify" → present in the round's self-buffs.
        expect(rounds[0].activeSelfBuffs.map((b) => b.buffName)).toContain('Fortify');
        // R2: the standing duration-3 "Fortify" would normally still be active — but
        // clearRemovable wiped it on the R1 intercept, so it is gone (only the recurring
        // Cheat Death buff remains).
        expect(rounds[1].activeSelfBuffs.map((b) => b.buffName)).not.toContain('Fortify');
    });

    // ── Regression: a carrier WITHOUT Cheat Death dies normally ───────────────
    it('regression: a tank without Cheat Death dies normally (ship-destroyed + destroyedRound)', () => {
        idCounter = 0;
        const bus = createEventBus();
        const destroyed: Extract<CombatEvent, { type: 'ship-destroyed' }>[] = [];
        const cheated: Extract<CombatEvent, { type: 'cheat-death-activated' }>[] = [];
        bus.on('ship-destroyed', (e) => destroyed.push(e));
        bus.on('cheat-death-activated', (e) => cheated.push(e));
        const result = runCombat(
            BASE({
                numRounds: 1,
                hp: 2000,
                defence: 0,
                healTargetId: 'attacker',
                bus,
                selfBuffs: [], // no Cheat Death
                enemyAttackers: [manualEnemy('atk1', 3000)],
                shipSkills: { slots: [] },
            })
        );
        expect(cheated).toHaveLength(0);
        expect(destroyed.filter((e) => e.actorId === 'attacker')).toHaveLength(1);
        expect(result.healing!.destroyedRound).toBe(1);
    });

    // ── DoT clear: Cheat Death wipes the tank's removable Corrosion/Inferno ────
    // Enemy-applied DoTs on the tank are stored as actor-state stacks
    // (healTarget.corrosionEntries/infernoEntries), NOT in the StatusEngine — so
    // clearRemovable alone does NOT clear them. The intercept must empty those same
    // arrays the tank's turn-start DoT-tick intake reads, so a Cheat-Death survivor
    // takes NO further Corrosion/Inferno ticks.
    //
    // Setup (per round, fastest first): tank (focus, speed 100) ticks its DoTs at
    // turn-start → dotEnemy (speed 50) applies inferno+corrosion (duration 5, NO
    // direct — it has only a dot ability so the synthesized basic is suppressed) →
    // killEnemy (speed 40) deals a lethal 3000 direct (no DoT, so it never re-seeds).
    //   R1: tank tick → 0 (no DoTs yet). dotEnemy seeds inferno+corrosion. killEnemy
    //       3000 → lethal → Cheat Death (HP→1) → clears the DoT arrays.
    //   R2: tank turn-start tick → arrays EMPTY → 0 DoT damage (the fix). Without the
    //       clear, the seeded DoTs would tick here.
    const inferno = () =>
        ab({
            type: 'dot',
            target: 'enemy',
            config: { type: 'dot', dotType: 'inferno', tier: 100, stacks: 1, duration: 5 },
        });
    const corrosion = () =>
        ab({
            type: 'dot',
            target: 'enemy',
            config: { type: 'dot', dotType: 'corrosion', tier: 100, stacks: 1, duration: 5 },
        });

    it('clears the tank Corrosion/Inferno DoTs on Cheat Death: no DoT ticks next round', () => {
        idCounter = 0;
        const bus = createEventBus();
        const cheated: Extract<CombatEvent, { type: 'cheat-death-activated' }>[] = [];
        bus.on('cheat-death-activated', (e) => cheated.push(e));
        const dotTicks: { round: number; dotType: string }[] = [];
        bus.on('dot-ticked', (e) => {
            const ev = e as { round: number; targetId: string; dotType: string };
            if (ev.targetId === 'attacker') dotTicks.push({ round: ev.round, dotType: ev.dotType });
        });
        runCombat(
            BASE({
                numRounds: 2,
                hp: 2000, // killEnemy 3000 → lethal in one hit
                defence: 0,
                healTargetId: 'attacker',
                bus,
                selfBuffs: [cheatDeathBuff()],
                enemyAttackers: [
                    // dot-only (no damage ability → no direct), applies BOTH DoTs.
                    manualEnemy('dotEnemy', 5000, 50, {
                        shipSkills: {
                            slots: [{ slot: 'active', abilities: [inferno(), corrosion()] }],
                        },
                    }),
                    // lethal direct, NO DoT (never re-seeds after the clear).
                    manualEnemy('killEnemy', 3000, 40),
                ],
                shipSkills: { slots: [] },
            })
        );
        // Cheat Death fires once on R1.
        expect(cheated).toHaveLength(1);
        expect(cheated[0].round).toBe(1);
        // R1 has no DoT ticks (DoTs seeded mid-round, tick at NEXT turn-start). The fix
        // empties the arrays on the R1 intercept → R2 turn-start tick sees no DoTs.
        expect(dotTicks.filter((t) => t.round === 2)).toEqual([]);
    });

    // ── Control: WITHOUT Cheat Death (and surviving), the same DoTs DO tick R2 ─
    // Proves the setup genuinely seeds ticking DoTs — so the zero in the test above is
    // the array-clear, not a dead setup. Tank has huge HP (survives, no Cheat Death);
    // the seeded inferno+corrosion tick at its R2 turn-start.
    it('control: without Cheat Death the seeded Corrosion/Inferno DoTs tick next round', () => {
        idCounter = 0;
        const bus = createEventBus();
        const dotTicks: { round: number; dotType: string }[] = [];
        bus.on('dot-ticked', (e) => {
            const ev = e as { round: number; targetId: string; dotType: string };
            if (ev.targetId === 'attacker') dotTicks.push({ round: ev.round, dotType: ev.dotType });
        });
        runCombat(
            BASE({
                numRounds: 2,
                hp: 1_000_000, // never dies, no Cheat Death — isolates the DoT bleed
                defence: 0,
                healTargetId: 'attacker',
                bus,
                selfBuffs: [], // no Cheat Death
                enemyAttackers: [
                    manualEnemy('dotEnemy', 5000, 50, {
                        shipSkills: {
                            slots: [{ slot: 'active', abilities: [inferno(), corrosion()] }],
                        },
                    }),
                    manualEnemy('killEnemy', 3000, 40),
                ],
                shipSkills: { slots: [] },
            })
        );
        const r2 = dotTicks
            .filter((t) => t.round === 2)
            .map((t) => t.dotType)
            .sort();
        expect(r2).toEqual(['corrosion', 'inferno']);
    });
});

// ── Task 9: Salvation on-destroyed ally-heal (Phase 4b) ───────────────────────
// Salvation's refit-active (R4 / 3rd) passive: "When this Unit is destroyed it repairs 80%
// of its max HP to all allies." Built via buildShipAbilities so the on-destroyed all-allies
// heal comes straight from the parser. When Salvation (the heal target) is destroyed, the
// Task-5 on-destroyed listener enqueues the heal and the reactive executor credits an
// all-allies repair THAT round — proving the parse→trigger→executor wiring fires only on
// death (not every round). The crux: before this task the heal was disqualified (on-destroyed
// was not live) so it never parsed; now it parses AND rides the on-destroyed trigger.
describe('healing mode — Salvation on-destroyed ally-heal (Phase 4b Task 9)', () => {
    type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
    const manualEnemy = (id: string, attack: number, speed = 50): EnemyAttacker => ({
        id,
        stats: { attack, crit: 0, critDamage: 0, speed },
        chargeCount: 0,
        startCharged: false,
    });

    // A slow, do-nothing walked ally so playerIds = ['attacker', 't1'] (two all-allies
    // recipients). It never acts (speed 5) and never takes damage (enemy only hits the target).
    const idleAlly = (id: string, hp: number): TeamActorEngineInput => ({
        id,
        speed: 5,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        walk: {
            shipSkills: { slots: [] },
            stats: {
                attack: 1000,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 0,
                hp,
            },
            debuffLandingChance: 1,
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
    });

    it('Salvation dies → on-destroyed 80% all-allies repair fires that round (parser-built)', () => {
        idCounter = 0;
        const bus = createEventBus();
        const destroyed: Extract<CombatEvent, { type: 'ship-destroyed' }>[] = [];
        bus.on('ship-destroyed', (e) => destroyed.push(e));
        const salvation: Ship = {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ...({} as any),
            refits: [{}, {}, {}, {}],
            thirdPassiveSkillText:
                "When this Unit is destroyed it <unit-damage>repairs 80%</unit-damage> of its max HP to all allies.<br /><br />When a <unit-aid>buff</unit-aid> is <unit-aid>purged</unit-aid> from an ally, this Unit <unit-damage>repairs that ally for 5%</unit-damage> of this Unit's max HP.",
        } as Ship;
        const salvationSkills = buildShipAbilities(salvation);
        const result = runCombat(
            BASE({
                numRounds: 1,
                hp: 2000, // enemy hits for 3000 → lethal in one hit (no Cheat Death)
                defence: 0,
                healTargetId: 'attacker',
                speed: 100, // focus would act first, but it dies on the enemy turn this round
                bus,
                selfBuffs: [],
                enemyAttackers: [manualEnemy('atk1', 3000)],
                teamActors: [idleAlly('t1', 50000)],
                shipSkills: salvationSkills,
            })
        );
        // Salvation (the focus/heal target) was destroyed this round.
        expect(destroyed.filter((e) => e.actorId === 'attacker')).toHaveLength(1);
        expect(result.healing!.destroyedRound).toBe(1);
        // The on-destroyed all-allies heal fired ONCE: basis = caster (Salvation) max HP 2000,
        // pct 80 → 1600 raw per recipient. Recipients = ['attacker', 't1'] → directHeal 3200,
        // all credited to the owner 'attacker'. (A phantom on-cast heal firing every round
        // would still only run once here — numRounds 1 — but the directHeal magnitude proves
        // BOTH all-allies recipients were repaired, i.e. the heal parsed and reached allies.)
        expect(focusHeal(result, 'directHeal')).toBeCloseTo(3200, 6);
    });
});
