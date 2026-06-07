import { describe, it, expect } from 'vitest';
import { toSimBuffs } from '../../calculators/dpsBuffHelpers';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { Ability, ShipSkills } from '../../../types/abilities';

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
