/**
 * SP-4b-2 D6 — the PASSIVE-SLOT damage instance on a POSITIONAL run, and the footprint it uses.
 *
 * The always-active passive slot can carry its own gated `damage` ability (Judge: "At the start of
 * the round, this Unit deals 60% damage to all enemies with less than 50% HP"). `runPlayerTurn`
 * folds it into the aggregate `directDamage`, which is the whole story on a NON-positional cast.
 * On a POSITIONAL cast the scalar direct credit is suppressed and the round is re-derived from the
 * per-victim apply — whose payload carries only the FIRING skill's scalars. The instance was
 * computed and then dropped (measured on the Judge fixture: round-4 `directDamage` 23000 where the
 * pre-positional engine reported 29000).
 *
 * THE DESIGN CALL these tests pin: the instance resolves its OWN footprint, from the passive damage
 * ability's OWN `target` — never the firing hit's. Judge's passive is `all-enemies` while its
 * firing skill is single-`enemy`, and a pattern belongs to a SLOT (active/charged), not to the
 * ship, so there is no firing footprint the passive could legitimately inherit. Sharing it would be
 * wrong in BOTH directions, which is why both directions are asserted here — a single-target
 * fixture passing is not evidence:
 *   • an `all-enemies` passive under a SINGLE-TARGET cast must reach every enemy (case 1);
 *   • an `enemy` passive under an AoE cast must reach ONLY the anchor (case 2).
 * Case 2 is the one that fails if the footprint is shared.
 *
 * Credit is asserted in `perTargetDealt`, per victim and keyed to the acting attacker — not as a
 * total that merely rose.
 *
 * Crit 0 everywhere → exact integers, no RNG drawn.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { ShipSkills, Ability, AbilityTarget, IncomingCondition } from '../../../types/abilities';
import { setKeyedRng, makeKeyedRng } from '../../calculators/rateAccumulator';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

let idc = 0;
const damageAbility = (multiplier: number, target: AbilityTarget = 'enemy'): Ability => ({
    id: `psd${++idc}`,
    type: 'damage',
    target,
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier },
});

/** A victim-side `incoming-block` passive (the D-PR3 surface `applyVictimDamage` consults on every
 *  `byDirectDamage` intake). `procChance` defaults to 1 so the OUTCOME is deterministic — the DRAW
 *  still happens either way, which is what the rate-gate test below counts. */
const incomingBlockAbility = (cfg: {
    condition: IncomingCondition;
    blockPct: number;
    procChance?: number;
    oncePerRound?: boolean;
}): Ability => ({
    id: `psb${++idc}`,
    type: 'incoming-block',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'incoming-block',
        condition: cfg.condition,
        procChance: cfg.procChance ?? 1,
        blockPct: cfg.blockPct,
        oncePerRound: cfg.oncePerRound ?? false,
    },
});

/** A victim-side Reflect (`damage-reflection`) passive — no `requirePrimaryTarget`, i.e. the
 *  gear-set shape rather than Nosorog's. The engine keys on `config.type`, not on the placeholder
 *  top-level `type` (same shape as `hitMitigation.integration.test.ts`'s `reflectPassive`). */
const reflectAbility = (pct: number): Ability => ({
    id: `psr${++idc}`,
    type: 'modifier',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage-reflection', pct },
});

/** Victim-side kit: passive-slot defensive abilities only, no damage of its own. */
const victimKit = (...abilities: Ability[]): ShipSkills => ({
    slots: [{ slot: 'passive', abilities }],
});

/** Active slot = the firing skill; passive slot = the separate damage instance under test. */
const kit = (
    firingMultiplier: number,
    passiveMultiplier: number,
    passiveTarget: AbilityTarget
): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: [damageAbility(firingMultiplier)] },
        { slot: 'passive', abilities: [damageAbility(passiveMultiplier, passiveTarget)] },
    ],
});

const frontTarget = (): ParsedTarget => ({ raw: 'front', side: 'enemy', selection: 'front' });
/** The anchor cell alone (range MUST be 0 — see DEFAULT_BASE_PATTERN). */
const singleCell = (): ParsedPattern => ({ raw: 'single', shape: 'base', range: 0, modifiers: {} });
/** Origin + one covered cell one step back: anchored at M4 it also covers M3 (at half damage). */
const lineRange1 = (): ParsedPattern => ({ raw: 'line-1', shape: 'line', range: 1, modifiers: {} });

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];
/** A walked PLAYER ally with no kit and no attack: a pure victim on the player roster, so the
 *  enemy's `all-enemies` passive instance has somebody to reach besides the focus. */
const allyAt = (id: string, position: Position): TeamActor => {
    const stats = {
        attack: 0,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        shieldPenetration: 0,
        hacking: 0,
        security: 0,
        defence: 0,
        hp: 1_000_000,
    };
    return {
        id,
        speed: 10,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position,
        shipSkills: { slots: [] },
        stats,
        walk: {
            shipSkills: { slots: [] },
            stats,
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
    };
};
const enemyAt = (
    id: string,
    position: Position,
    attack = 0,
    speed = 1,
    shipSkills: ShipSkills = { slots: [] }
): EnemyAttacker =>
    ({
        id,
        stats: { attack, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed },
        chargeCount: 0,
        startCharged: false,
        position,
        shipSkills,
    }) as EnemyAttacker;

const FOCUS_ATTACK = 1000;

const BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    attack: FOCUS_ATTACK,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: kit(100, 50, 'all-enemies'),
    enemyDefense: 0,
    enemyHp: 1_000_000_000,
    numRounds: 1,
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
    hp: 1_000_000_000,
    healModifier: 0,
    healTargetId: 'attacker',
    mode: 'healing',
    speed: 100,
    position: 'M4',
    target: frontTarget(),
    pattern: singleCell(),
    enemyAttackers: [enemyAt('e-front', 'M4'), enemyAt('e-mid', 'M3'), enemyAt('e-back', 'M2')],
    ...overrides,
});

describe('SP-4b-2 D6 — the passive-slot damage instance resolves its OWN footprint', () => {
    it("an 'all-enemies' passive under a SINGLE-TARGET cast reaches every enemy, credited per victim", () => {
        const result = runCombat(BASE());
        const dealt = result.rounds[0].perTargetDealt?.['attacker'];

        // Firing hit: 1000 × 100%, single cell → the M4 anchor only.
        // Passive instance: 1000 × 50% = 500, own footprint = the whole opposing board (shape
        // 'all' → every occupied cell at ORIGIN role, i.e. FULL damage, no covered halving).
        expect(dealt?.['e-front']).toBe(1000 + 500);
        expect(dealt?.['e-mid']).toBe(500);
        expect(dealt?.['e-back']).toBe(500);

        // Keyed to the ACTING attacker, not the victim and not the retired dummy sink.
        expect(Object.keys(result.rounds[0].perTargetDealt ?? {})).toEqual(['attacker']);
        expect(result.rounds[0].perTargetDealt?.['e-front']).toBeUndefined();

        // Σ over victims = the whole turn's outgoing damage, each share counted once. (The row's
        // own `directDamage` scalar stays 0 on a positional run by design — the DPS calculator
        // re-derives it from THIS map; `dpsSimulator.test.ts`'s Judge case covers that end.)
        const total = Object.values(dealt ?? {}).reduce((s, n) => s + n, 0);
        expect(total).toBe(1000 + 3 * 500);
    });

    // THE DISCRIMINATING CASE. If the instance shared the firing hit's footprint, the covered M3
    // victim would take a passive share too. Its own `target: 'enemy'` says one enemy — the anchor.
    it("an 'enemy' passive under an AoE cast reaches ONLY the anchor, not the firing footprint", () => {
        const result = runCombat(
            BASE({
                shipSkills: kit(100, 50, 'enemy'),
                pattern: lineRange1(), // anchor M4 (full) + covered M3 (half)
            })
        );
        const dealt = result.rounds[0].perTargetDealt?.['attacker'];

        // Anchor: firing 1000 + passive 500.
        expect(dealt?.['e-front']).toBe(1000 + 500);
        // Covered footprint victim: the FIRING hit's half share (500) and NOTHING from the
        // passive. A shared footprint would make this 500 + 250 (or 500 + 500).
        expect(dealt?.['e-mid']).toBe(500);
        // Outside every footprint.
        expect(dealt?.['e-back']).toBeUndefined();
    });

    // Team symmetry (LOCKED: passives fire on both sides). A Judge-style kit on an ENEMY actor
    // lands its passive-slot instance on the PLAYER roster, credited to the enemy.
    it('the enemy side lands its own passive-slot instance on the player roster', () => {
        const result = runCombat(
            BASE({
                // The focus does not attack this round's ordering question at all — the enemy is
                // faster and acts first; only the enemy's credit is asserted.
                enemyAttackers: [enemyAt('e-front', 'M4', 800, 500, kit(100, 50, 'all-enemies'))],
                teamActors: [allyAt('ally-1', 'M3')],
            })
        );
        const dealt = result.rounds[0].perTargetDealt?.['e-front'];
        // 800 attack: firing 800 on its single-cell anchor, passive 400 on EVERY player actor.
        expect(dealt?.['attacker']).toBe(800 + 400);
        expect(dealt?.['ally-1']).toBe(400);
    });
});

/**
 * SP-4b-2 D6, task-14 finding 2 — WHAT THE INSTANCE ACTUALLY DOES AT THE VICTIM FUNNEL.
 *
 * The D6 work claimed the passive-slot instance "draws no RNG". That is true of CRIT alone
 * (`hit.didCrit` is decided once in `runPlayerTurn` and every footprint victim reuses it) and FALSE
 * in general. The instance lands through `tb.applyToVictim` → `applyOutgoingToEnemy`, which passes
 * `byDirectDamage: true`, so `applyVictimDamage` runs its full direct-intake surface on it:
 *   • the victim's `directIntakeIndex` advances (so the instance counts as an nth direct hit);
 *   • an `incoming-block` ability is consulted, which ROLLS a `makeRateGate` draw on that victim's
 *     own `<id>:proc` sub-stream — a draw, whatever its outcome;
 *   • it sets neither `isReflected` nor `isCounter`, so it provokes Reflect thorns.
 *
 * That behaviour is correct — it IS a real damage instance — but nothing pinned it, so the false
 * claim could have been carried into a later PR as a planning assumption. These are the pins.
 *
 * The blocker sits on `e-mid` in most cases: the firing cast is single-cell on the M4 anchor, so
 * `e-mid` is reached by the PASSIVE INSTANCE AND NOTHING ELSE. Any effect observed there is the
 * instance's, with no need to disentangle it from the firing hit.
 *
 * Crit 0 everywhere → exact integers; every block outcome below is forced (procChance 1 or 0), so
 * no assertion depends on a draw's VALUE.
 */
describe('SP-4b-2 D6 — the passive-slot instance is a real direct-damage intake', () => {
    it("an 'incoming-block' on a victim only the passive reaches still blocks the instance", () => {
        const result = runCombat(
            BASE({
                enemyAttackers: [
                    enemyAt('e-front', 'M4'),
                    // Halves every direct hit it takes. Only the passive instance reaches it.
                    enemyAt(
                        'e-mid',
                        'M3',
                        0,
                        1,
                        victimKit(incomingBlockAbility({ condition: 'always', blockPct: 0.5 }))
                    ),
                    enemyAt('e-back', 'M2'),
                ],
            })
        );
        const dealt = result.rounds[0].perTargetDealt?.['attacker'];

        // The instance's 500 share, halved by the block: the block path SAW it.
        expect(dealt?.['e-mid']).toBe(250);
        // Same instance, same share, on the two enemies without the ability — so the 250 above is
        // the block, not a footprint or a magnitude difference.
        expect(dealt?.['e-back']).toBe(500);
        expect(dealt?.['e-front']).toBe(1000 + 500);
    });

    it("the instance advances `directIntakeIndex`, so an 'nth-hit-2plus' block catches it", () => {
        // `nth-hit-2plus` blocks from the SECOND direct intake of the round onward. On the anchor
        // the firing hit is intake #1 and the passive instance is intake #2 (staged before, applied
        // after), so the instance — and only the instance — is blocked.
        const nthBlock = () =>
            victimKit(incomingBlockAbility({ condition: 'nth-hit-2plus', blockPct: 1 }));
        const result = runCombat(
            BASE({
                enemyAttackers: [
                    enemyAt('e-front', 'M4', 0, 1, nthBlock()),
                    enemyAt('e-mid', 'M3', 0, 1, nthBlock()),
                ],
            })
        );
        const dealt = result.rounds[0].perTargetDealt?.['attacker'];

        // Anchor: firing 1000 lands (intake #1), the passive's 500 is fully blocked (intake #2).
        // If the instance did not go through the intake counter at all, this would read 1500.
        expect(dealt?.['e-front']).toBe(1000);
        // The counter is PER VICTIM: on e-mid the instance is intake #1, so the same ability does
        // not fire and the full 500 lands. This is what rules out "the block always eats it".
        expect(dealt?.['e-mid']).toBe(500);
    });

    it("the instance rolls a rate-gate draw on the victim's own `<id>:proc` sub-stream", () => {
        // The DRAW is what is asserted, not its outcome — `procChance: 0` makes the block never
        // fire, so the damage is untouched and the only observable is the stream consumption.
        const SEED = 0x9d6_1a7;
        const drawsPerKey = (passiveMultiplier: number): Map<string, number> => {
            const counts = new Map<string, number>();
            const inner = makeKeyedRng(SEED);
            setKeyedRng((key) => {
                counts.set(key, (counts.get(key) ?? 0) + 1);
                return inner(key);
            });
            try {
                const result = runCombat(
                    BASE({
                        shipSkills: kit(100, passiveMultiplier, 'all-enemies'),
                        enemyAttackers: [
                            enemyAt('e-front', 'M4'),
                            enemyAt(
                                'e-mid',
                                'M3',
                                0,
                                1,
                                victimKit(
                                    incomingBlockAbility({
                                        condition: 'always',
                                        blockPct: 1,
                                        procChance: 0,
                                    })
                                )
                            ),
                        ],
                    })
                );
                // Guard against a vacuous run: with multiplier 50 the instance really did land its
                // full 500 on e-mid (procChance 0 → nothing blocked), and with 0 it never existed.
                expect(result.rounds[0].perTargetDealt?.['attacker']?.['e-mid']).toBe(
                    passiveMultiplier === 0 ? undefined : 500
                );
                return counts;
            } finally {
                setKeyedRng(makeKeyedRng(SEED));
            }
        };

        // No passive instance → nothing ever reaches e-mid → its proc stream is never touched.
        expect(drawsPerKey(0).get('e-mid:proc')).toBeUndefined();
        // With the instance → exactly one draw, from the instance's own intake.
        expect(drawsPerKey(50).get('e-mid:proc')).toBe(1);
    });

    it('the instance provokes Reflect thorns back at the attacker', () => {
        const result = runCombat(
            BASE({
                enemyAttackers: [
                    enemyAt('e-front', 'M4'),
                    // Reflects 10% of the direct damage it takes. Reached only by the instance.
                    enemyAt('e-mid', 'M3', 0, 1, victimKit(reflectAbility(10))),
                ],
            })
        );
        const round = result.rounds[0];

        // The instance's 500 lands in full (no block here) …
        expect(round.perTargetDealt?.['attacker']?.['e-mid']).toBe(500);
        // … and 10% of it bounces back, credited to the REFLECTOR against the attacker. The
        // attacker's own defence is 0 and both sides are affinity-neutral, so the bounce is exact.
        // `isAnchor: false` exempts the instance from a `requirePrimaryTarget` reflect (Nosorog);
        // the gear-set shape asserted here carries no such gate and fires.
        expect(round.perTargetDealt?.['e-mid']?.['attacker']).toBe(50);
        // The un-reflecting anchor bounces nothing — so the 50 above is the ability, not a fixture
        // artefact.
        expect(round.perTargetDealt?.['e-front']).toBeUndefined();
    });

    // Team symmetry (LOCKED). The ENEMY side's passive-slot instance is the same real intake
    // against a PLAYER victim: it advances the player's `directIntakeIndex` and its block fires.
    it("an enemy's passive-slot instance is an nth direct intake on the player it hits", () => {
        const result = runCombat(
            BASE({
                // The focus is the victim here: no damage kit, one nth-hit-2plus block.
                shipSkills: victimKit(
                    incomingBlockAbility({ condition: 'nth-hit-2plus', blockPct: 1 })
                ),
                // Faster than the focus, so it acts first and the focus's own (absent) cast cannot
                // reorder the player's intakes.
                enemyAttackers: [enemyAt('e-front', 'M4', 800, 500, kit(100, 50, 'all-enemies'))],
                // A second player victim the enemy's FIRING hit cannot reach (single-cell on the
                // M4 anchor), reached by the passive instance alone and carrying no block. Without
                // it this case is VACUOUS: the focus's 800 is the firing hit's, so `toBe(800)`
                // reads the same whether the instance lands and is blocked, is never staged, or
                // never fires at all. `ally-1` moves only when the instance actually lands.
                teamActors: [allyAt('ally-1', 'M3')],
            })
        );
        const dealt = result.rounds[0].perTargetDealt?.['e-front'];
        // Enemy firing hit 800 = the focus's intake #1 (lands); enemy passive instance 400 =
        // intake #2 (fully blocked). Without the instance passing through the intake surface this
        // would read 1200 — the same discriminator as the player-side case above, mirrored.
        expect(dealt?.['attacker']).toBe(800);
        // The SAME instance, unblocked, on the ally it is the only thing to reach. This is the
        // assertion that fails if the instance is not staged/landed at all — 800 above would not.
        expect(dealt?.['ally-1']).toBe(400);
    });
});
