/**
 * healingPerRecipientReport.test.ts — SP-3b Task 7.
 *
 * Since the healing run went positional, a cast repair lands on EVERY ally the caster's support
 * footprint covers — not just the configured heal target. The report has to say which is which:
 *
 *   - `directHeal` / `hotHeal` / `totalRoundHealing` / `cumulativeHealing` / `totalHealing` stay on
 *     the SOURCE axis (`perActor[FOCUS_ID]`) — healer THROUGHPUT, which is what the charts plot;
 *   - `effectiveHealing` / `overheal` read the RECIPIENT axis (`perRecipient[healTargetId]`) — "how
 *     much actually landed on the ship I am keeping alive", which is the calculator's whole point
 *     and which silently became "everything the healer produced, wherever it went" when
 *     per-recipient application went live.
 *
 * `shield` / `cleanseCount` have no recipient-axis credit at all and stay source-keyed.
 */
import { describe, it, expect } from 'vitest';
import { simulateHealing, HealingSimulationInput, HealerStats } from '../healingEngineAdapter';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { TeamActorInput } from '../../../types/calculator';
import { parsePattern, parseTarget } from '../../targetingParser';

const HEAL_TARGET_ID = 'heal-target';
const SECOND_ALLY_ID = 'ally-two';

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `sp3b_rep_${++idc}`,
    target: 'ally',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

const HEALER: HealerStats = {
    hp: 50_000,
    attack: 0,
    defence: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    healModifier: 0,
    hacking: 200,
    speed: 300,
};

/**
 * Repairs 10% of the caster's HP to every ally the support pattern covers.
 *
 * ⚠️ `target: 'all-allies'`, NOT `'ally'`. `resolveSupportRecipients` only ever NARROWS
 * (supportRecipients.ts:16-19) — a single-`'ally'` heal bases on `[healing.targetId]`
 * (playerTurn.ts:3361) and the footprint can then only drop it, never widen it to the roster. So an
 * `'ally'` heal reaches exactly ONE recipient however generous the pattern is, and every
 * "merged across the roster" assertion below would observe a single-entry map.
 */
const allyHealSkills = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                ab({
                    type: 'heal',
                    target: 'all-allies',
                    config: { type: 'heal', pct: 10, basis: 'hp' },
                }),
            ],
        },
    ],
});

/** An enemy that hits hard enough to leave headroom for the repairs to land. */
const enemy = () => ({
    id: 'enemy-1',
    stats: {
        attack: 20_000,
        crit: 0,
        critDamage: 0,
        speed: 1,
        defence: 0,
        hp: 500_000,
        security: 100,
    },
    chargeCount: 0,
    startCharged: false,
    position: 'M4' as const,
    target: parseTarget('all'),
    pattern: parsePattern('Pattern-Circle-Range-1'),
});

// ⚠️ The two allies MUST carry DISTINCT ids AND distinct slots. With duplicate ids
// `Object.keys(...)` collapses to one entry and every "merged across the roster" assertion below
// passes byte-for-byte while observing nothing (the #318 vacuity class).
const ally = (id: string, position: 'M3' | 'M4'): TeamActorInput => ({
    id,
    speed: 10,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    shipSkills: { slots: [] },
    stats: {
        attack: 0,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        hacking: 200,
        defence: 0,
        hp: 60_000,
    },
    position,
});

// Pattern-Line-Support-Range-1 @ M2 covers {M2, M3}; extend to Range-3 @ M2 to cover M3 AND M4.
const BASE = (o: Partial<HealingSimulationInput> = {}): HealingSimulationInput => ({
    healer: HEALER,
    chargeCount: 0,
    shipSkills: allyHealSkills(),
    selfBuffs: [],
    healTargetId: HEAL_TARGET_ID,
    enemies: [enemy()],
    rounds: 3,
    healerPosition: 'M2',
    healerTargeting: {
        active: {
            target: parseTarget('allies'),
            pattern: parsePattern('Pattern-Line-Support-Range-3'),
        },
    },
    teamActors: [ally(HEAL_TARGET_ID, 'M3'), ally(SECOND_ALLY_ID, 'M4')],
    ...o,
});

describe('SP-3b: per-recipient healing report', () => {
    it('reports a distinct entry per healed ally', () => {
        idc = 0;
        const result = simulateHealing(BASE());
        const withData = result.rounds.find((r) => r.perRecipient !== undefined);
        expect(withData).toBeDefined();
        expect(Object.keys(withData!.perRecipient!)).toEqual(
            expect.arrayContaining([HEAL_TARGET_ID, SECOND_ALLY_ID])
        );
    });

    it('keeps the heal target as the primary row', () => {
        idc = 0;
        const result = simulateHealing(BASE());
        // Every existing chart reads the top-level effectiveHealing. It must still describe the
        // configured heal target, NOT the team-wide sum, or the charts silently change meaning.
        const perRecipientTotal =
            result.summary.perRecipient![HEAL_TARGET_ID].totalEffectiveHealing;
        expect(result.summary.totalEffectiveHealing).toBe(perRecipientTotal);
    });

    it('sums per-recipient effective healing to the team total', () => {
        idc = 0;
        const result = simulateHealing(BASE());
        const byRecipient = Object.values(result.summary.perRecipient!).reduce(
            (n, e) => n + e.totalEffectiveHealing,
            0
        );
        // Anti-vacuity: BOTH sides non-zero, and the second ally really did receive something —
        // otherwise this identity holds trivially on a single-recipient run.
        expect(byRecipient).toBeGreaterThan(0);
        expect(result.summary.perRecipient![SECOND_ALLY_ID].totalEffectiveHealing).toBeGreaterThan(
            0
        );
        expect(byRecipient).toBeGreaterThan(result.summary.totalEffectiveHealing);
    });

    it('reports the heal target’s own share, not the healer’s whole output', () => {
        idc = 0;
        const result = simulateHealing(BASE());
        // THE REPOINT, pinned. The direct cast-repair site is the ONLY crediting site in this
        // fixture (no HoT, no leech, no reactive), so the SOURCE axis this row used to read
        // (`perActor[FOCUS_ID]`) holds exactly Σ over recipients — the healer's whole output,
        // wherever it went. Measured on this fixture: source axis 20000 effective / 25000 overheal
        // across {healer, heal-target, ally-two}; the heal target's OWN share is 10000 / 5000, and
        // 10000 / 5000 is what the row must now report.
        const srcEffective = Object.values(result.summary.perRecipient!).reduce(
            (n, e) => n + e.totalEffectiveHealing,
            0
        );
        const srcOverheal = Object.values(result.summary.perRecipient!).reduce(
            (n, e) => n + e.totalOverheal,
            0
        );
        expect(result.summary.totalEffectiveHealing).toBeLessThan(srcEffective);
        expect(result.summary.totalOverheal).toBeLessThan(srcOverheal);
        expect(result.summary.totalEffectiveHealing).toBe(
            result.summary.perRecipient![HEAL_TARGET_ID].totalEffectiveHealing
        );
        expect(result.summary.totalOverheal).toBe(
            result.summary.perRecipient![HEAL_TARGET_ID].totalOverheal
        );

        // Throughput stays on the SOURCE axis: the row's directHeal counts every recipient, so it
        // must exceed the heal target's own directHeal share. Same run, two different questions.
        const row = result.rounds.find((r) => r.perRecipient !== undefined)!;
        expect(row.directHeal).toBeGreaterThan(row.perRecipient![HEAL_TARGET_ID].directHeal);
        expect(result.summary.totalHealing).toBe(result.summary.totalDirectHeal);
    });

    it('a NON-CAST repair (HoT tick) reaches the recipient axis', () => {
        // The tripwire for the engine half of this task. `effectiveHealing`/`overheal` now READ the
        // recipient axis, so any repair source that applies to the heal target without mirroring
        // onto that axis silently vanishes from the report. Before the axis was completed, this
        // fixture reported the HoT's whole consumption split as ZERO while `hotHeal` still showed
        // 1500/round of throughput — the exact shape that moved 7 healing goldens.
        idc = 0;
        const result = simulateHealing(
            BASE({
                healTargetId: 'healer', // self-heal: the focus IS the heal target
                teamActors: [],
                rounds: 3,
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
                                        buffName: 'Repair Over Time II',
                                        parsedEffects: { hotPct: 15 },
                                        stacks: 1,
                                        isStackable: false,
                                        duration: 2,
                                    },
                                }),
                            ],
                        },
                    ],
                },
            })
        );
        // Anti-vacuity: the HoT must actually be ticking (throughput on the SOURCE axis) —
        // otherwise "it reaches the recipient axis" would be a claim about nothing.
        expect(result.summary.totalHotHeal).toBeGreaterThan(0);
        expect(result.summary.totalDirectHeal).toBe(0); // no cast repair at all in this kit
        const ticked = result.rounds.find((r) => r.hotHeal > 0)!;
        expect(ticked.perRecipient!.attacker.hotHeal).toBe(ticked.hotHeal);
        // The healer is at full HP for the first tick, so the split shows up as over-repair.
        expect(ticked.effectiveHealing + ticked.overheal).toBe(ticked.hotHeal);
        expect(result.summary.totalOverheal).toBeGreaterThan(0);
    });
});
