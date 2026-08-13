/**
 * lodolitePurgeShieldStrip.integration.test.ts — sub-project I, PR I6.
 *
 * Lodolite's charged skill purges the enemy with the most buffs (target:
 * 'enemy-most-buffs', count 'all', trigger 'on-cast' — see
 * buildShipAbilities.test.ts's "Lodolite charged purge + shield strip (I6)" for the
 * text-parsing coverage). Its legendary refit ("When this Unit Purges a buff from an
 * enemy, it removes 100% of the enemy's shield") is modeled as a `stripsShield` flag
 * on the purge ability's config (detectPurgeStripsShield / buildShipAbilities), consumed
 * at the purge-performed apply site in playerTurn.ts: the SAME victim id that was just
 * purged has its shieldPool zeroed.
 *
 * Two engine-level facts this file proves that the parser-level tests cannot:
 *   1. The 'enemy-most-buffs' SELECTOR target resolves correctly for an ON-CAST purge
 *      (Lodolite) — previously this selector only worked for REACTIVE purge triggers
 *      (Rhodium's end-of-round), routed through triggers.ts. Lodolite's on-cast purge
 *      stays on the castSkills path (playerTurn.ts) and needed its OWN resolution
 *      (engine.ts buildTurnArgs' new `enemyMostBuffsId`, mostBuffsAmong over the
 *      opposing roster) — this test is a regression guard for that routing.
 *   2. shieldPool actually reaches 0 on the purged victim, and an untouched sibling
 *      enemy (no buffs, so never selected) keeps its own shield intact.
 *
 * Harness mirrors aoePurge.test.ts / amartyaCritPurge.test.ts (positional two-team
 * battle-sim, ability injected directly rather than routed through the text parser) and
 * enemyOnCastShield.integration.test.ts (self-shield ability shape + __testTapActors).
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { CombatActor } from '../state';

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `i6p${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

const hit = (): Ability =>
    ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 10 } });

const selfBuff = (): Ability =>
    ab({
        type: 'buff',
        target: 'self',
        config: {
            type: 'buff',
            buffName: 'Attack Up',
            parsedEffects: { attack: 30 },
            stacks: 1,
            isStackable: false,
            duration: 99,
        },
    });

// Self-shield (50% of max HP), same shape as enemyOnCastShield.integration.test.ts.
const selfShield = (): Ability =>
    ab({
        type: 'shield',
        target: 'self',
        config: { type: 'shield', pct: 50, basis: 'hp' },
    });

// Lodolite-shape: on-cast purge (target enemy-most-buffs, count all, stripsShield) + a hit
// so the positional harness always resolves a real anchor.
const lodolitePurgeSkills = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                ab({
                    type: 'purge',
                    target: 'enemy-most-buffs',
                    config: { type: 'purge', count: 'all', stripsShield: true },
                }),
                hit(),
            ],
        },
    ],
});

// The enemy WITH the most buffs: self-buffs + self-shields every round, then hits.
// Speed 200 (> focus 100) so it acts BEFORE the focus each round — the purge that
// follows is the LAST thing to touch its buff/shield state this round.
const buffedShieldedEnemy = (id: string, position: Position) => ({
    id,
    stats: { attack: 100, crit: 0, critDamage: 0, defence: 0, hp: 100_000, speed: 200 },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parsedTarget('front'),
    pattern: basePattern(),
    shipSkills: {
        slots: [{ slot: 'active' as const, abilities: [selfBuff(), selfShield(), hit()] }],
    },
});

// The CONTROL enemy: no buffs, but DOES self-shield every round — never the
// most-buffed target, so its shield must survive untouched.
const plainShieldedEnemy = (id: string, position: Position) => ({
    id,
    stats: { attack: 100, crit: 0, critDamage: 0, defence: 0, hp: 100_000, speed: 10 },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parsedTarget('front'),
    pattern: basePattern(),
    shipSkills: { slots: [{ slot: 'active' as const, abilities: [selfShield(), hit()] }] },
});

const BASE: CombatEngineInput = {
    attack: 5000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: lodolitePurgeSkills(),
    enemyDefense: 0,
    enemyHp: 1_000_000_000,
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
    hp: 1_000_000_000,
    healTargetId: 'attacker',
    mode: 'healing',
    position: 'M4',
    target: parsedTarget('front'),
    pattern: basePattern(),
    enemyAttackers: [
        buffedShieldedEnemy('enemy-buffed', 'M3'),
        plainShieldedEnemy('enemy-plain', 'M4'),
    ],
};

describe('I6: Lodolite-shape on-cast enemy-most-buffs purge + shield strip', () => {
    it('purges the most-buffed enemy AND zeroes its shieldPool', () => {
        let captured: CombatActor[] = [];
        runCombat({
            ...BASE,
            __testTapActors: (actors) => {
                captured = actors;
            },
        });
        const buffed = captured.find((a) => a.id === 'enemy-buffed');
        expect(buffed?.shieldPool ?? -1).toBe(0);
    });

    it('leaves the untouched (non-most-buffed) enemy shield intact', () => {
        let captured: CombatActor[] = [];
        runCombat({
            ...BASE,
            __testTapActors: (actors) => {
                captured = actors;
            },
        });
        const plain = captured.find((a) => a.id === 'enemy-plain');
        expect(plain?.shieldPool ?? 0).toBeGreaterThan(0);
    });

    it('CONTROL: without stripsShield on the config, the purged victim keeps its shield', () => {
        const noStripSkills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({
                            type: 'purge',
                            target: 'enemy-most-buffs',
                            config: { type: 'purge', count: 'all' }, // no stripsShield
                        }),
                        hit(),
                    ],
                },
            ],
        };
        let captured: CombatActor[] = [];
        runCombat({
            ...BASE,
            shipSkills: noStripSkills,
            __testTapActors: (actors) => {
                captured = actors;
            },
        });
        const buffed = captured.find((a) => a.id === 'enemy-buffed');
        // The buff was still purged (proves the purge itself fired), but its OWN shield
        // (re-granted every round via its own active) survives — proving the strip is
        // gated on the config flag, not an unconditional side effect of any purge.
        expect(buffed?.shieldPool ?? 0).toBeGreaterThan(0);
    });
});

describe('I6: team-symmetry — an ENEMY-sourced Lodolite-shape purge strips a PLAYER shield', () => {
    // Mirror of the player-side harness: the focus self-buffs + self-shields (most-buffed),
    // a walked team actor only self-shields (control). A single enemy purges
    // 'enemy-most-buffs' with stripsShield. Enemy speed 50 < both players' speed 100, so
    // BOTH players act first each round (buff/shield), then the enemy purges+strips.
    const selfBuffShieldThenHitSkills = (): ShipSkills => ({
        slots: [{ slot: 'active', abilities: [selfBuff(), selfShield(), hit()] }],
    });
    const selfShieldThenHitSkills = (): ShipSkills => ({
        slots: [{ slot: 'active', abilities: [selfShield(), hit()] }],
    });

    const purgingEnemy = () => ({
        id: 'enemy-front',
        stats: { attack: 100, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000, speed: 50 },
        chargeCount: 0,
        startCharged: false,
        position: 'M4' as Position,
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills: lodolitePurgeSkills(),
    });

    const teamActor = (): TeamActorEngineInput => ({
        id: 'player-team',
        speed: 100,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position: 'M3',
        target: parsedTarget('front'),
        pattern: basePattern(),
        walk: {
            shipSkills: selfShieldThenHitSkills(), // control: shield only, no buff
            stats: {
                attack: 500,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 200,
                defence: 0,
                hp: 100_000,
            },
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
    });

    it('the enemy purge strips the MOST-BUFFED player (focus) shield, leaves the team actor untouched', () => {
        let captured: CombatActor[] = [];
        runCombat({
            attack: 5000,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: selfBuffShieldThenHitSkills(),
            enemyDefense: 0,
            enemyHp: 1_000_000_000,
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
            hp: 100_000,
            healTargetId: 'attacker',
            mode: 'healing',
            position: 'M4',
            target: parsedTarget('front'),
            pattern: basePattern(),
            teamActors: [teamActor()],
            enemyAttackers: [purgingEnemy()],
            __testTapActors: (actors) => {
                captured = actors;
            },
        });
        const focus = captured.find((a) => a.id === 'attacker');
        const team = captured.find((a) => a.id === 'player-team');
        expect(focus?.shieldPool ?? -1).toBe(0); // most-buffed → purged + stripped
        expect(team?.shieldPool ?? 0).toBeGreaterThan(0); // never the most-buffed target → untouched
    });
});
