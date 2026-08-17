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
import { ShipSkills, Ability, AbilityTarget } from '../../../types/abilities';
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
                teamActors: [
                    {
                        id: 'ally-1',
                        speed: 10,
                        chargeCount: 0,
                        startCharged: false,
                        selfBuffs: [],
                        enemyDebuffs: [],
                        position: 'M3',
                        shipSkills: { slots: [] },
                        stats: {
                            attack: 0,
                            crit: 0,
                            critDamage: 0,
                            defensePenetration: 0,
                            shieldPenetration: 0,
                            hacking: 0,
                            security: 0,
                            defence: 0,
                            hp: 1_000_000,
                        },
                        walk: {
                            shipSkills: { slots: [] },
                            stats: {
                                attack: 0,
                                crit: 0,
                                critDamage: 0,
                                defensePenetration: 0,
                                shieldPenetration: 0,
                                hacking: 0,
                                security: 0,
                                defence: 0,
                                hp: 1_000_000,
                            },
                            selfDotModifier: 0,
                            defensePenetrationBuff: 0,
                            affinityDamageModifier: 0,
                            affinityCritCap: 100,
                            affinityCritPenalty: 0,
                            hasChargedSkill: false,
                        },
                    },
                ],
            })
        );
        const dealt = result.rounds[0].perTargetDealt?.['e-front'];
        // 800 attack: firing 800 on its single-cell anchor, passive 400 on EVERY player actor.
        expect(dealt?.['attacker']).toBe(800 + 400);
        expect(dealt?.['ally-1']).toBe(400);
    });
});
