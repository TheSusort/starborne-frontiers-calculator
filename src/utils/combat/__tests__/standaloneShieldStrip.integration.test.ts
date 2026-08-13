/**
 * standaloneShieldStrip.integration.test.ts — PR9(b).
 *
 * "removes X% of the enemy Shield" (APEX/Laika/Malvex — see skillTextParser.test.ts's
 * "parseShieldStrip (PR9b...)" for the text-parsing coverage and buildShipAbilities.test.ts's
 * "PR9b standalone shield-strip" for the ability-build coverage). Modeled as a STANDALONE
 * `{ type:'shield-strip', pct }` ability, fired on-cast against the skill's own damage target —
 * unlike the existing I6 `stripsShield` flag on 'purge' abilities (Lodolite: "when this Unit
 * Purges a buff from an enemy, it removes 100% of the enemy's shield"), which stays gated on
 * an actual purge landing. Both apply sites now share ONE strip helper (`stripShieldPct` in
 * playerTurn.ts) that removes a PERCENTAGE of the victim's CURRENT pool — not a hard zero —
 * so a partial strip (30%/40%) and a full strip (100%, I6) are the same code path at different
 * percentages.
 *
 * Two engine-level facts this file proves that the parser/build-level tests cannot:
 *   1. A PARTIAL strip (e.g. 30%) reduces shieldPool by that fraction of its CURRENT value,
 *      not to zero — distinct from the I6 100%-only flag.
 *   2. Team symmetry: an ENEMY-sourced shield-strip ability reduces a PLAYER's shieldPool the
 *      same way a player-sourced one reduces an enemy's.
 *
 * Harness mirrors lodolitePurgeShieldStrip.integration.test.ts (positional two-team
 * battle-sim, ability injected directly, __testTapActors for post-combat state).
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { CombatActor } from '../state';

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `sss${++idc}`,
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

const selfShield = (): Ability =>
    ab({
        type: 'shield',
        target: 'self',
        config: { type: 'shield', pct: 50, basis: 'hp' },
    });

// APEX-shape: a standalone on-cast shield-strip ability co-cast beside a hit.
const stripSkills = (pct: number): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [ab({ type: 'shield-strip', config: { type: 'shield-strip', pct } }), hit()],
        },
    ],
});

// The enemy self-shields every round (50% of 100,000 max HP = 50,000, capped at max HP)
// BEFORE the focus's strip lands — speed 200 > focus's 100.
const selfShieldingEnemy = (id: string, position: Position) => ({
    id,
    stats: { attack: 100, crit: 0, critDamage: 0, defence: 0, hp: 100_000, speed: 200 },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parsedTarget('front'),
    pattern: basePattern(),
    shipSkills: { slots: [{ slot: 'active' as const, abilities: [selfShield(), hit()] }] },
});

const BASE: CombatEngineInput = {
    // Focus attack is 0 so its companion `hit()` ability (needed only so the positional
    // harness resolves a real anchor, same rationale as the I6 lodolite fixture) deals ZERO
    // ordinary damage — otherwise that damage would ALSO drain the enemy's shieldPool via the
    // normal shield-absorbs-damage-first mechanic, confounding the strip-only assertion below.
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: stripSkills(30),
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
    healTargetId: 'attacker',
    mode: 'healing',
    position: 'M4',
    target: parsedTarget('front'),
    pattern: basePattern(),
    enemyAttackers: [selfShieldingEnemy('enemy-front', 'M4')],
};

describe("PR9b: standalone shield-strip removes a PERCENTAGE of the victim's CURRENT shield (not a hard zero)", () => {
    it("a 30% strip leaves 70% of the enemy's current shield intact", () => {
        let captured: CombatActor[] = [];
        runCombat({
            ...BASE,
            shipSkills: stripSkills(30),
            __testTapActors: (actors) => {
                captured = actors;
            },
        });
        const enemy = captured.find((a) => a.id === 'enemy-front')!;
        // Enemy self-shields to 50,000 (speed 200, acts first), THEN the focus's 30% strip
        // lands this same round (speed 100 < 200, focus acts after) → 50,000 * 0.7 = 35,000.
        expect(enemy.shieldPool).toBe(35000);
    });

    it('a 100% strip (numerically identical to the I6 full-strip case) zeroes the shield', () => {
        let captured: CombatActor[] = [];
        runCombat({
            ...BASE,
            shipSkills: stripSkills(100),
            __testTapActors: (actors) => {
                captured = actors;
            },
        });
        const enemy = captured.find((a) => a.id === 'enemy-front')!;
        expect(enemy.shieldPool).toBe(0);
    });

    it('CONTROL: without a shield-strip ability, the enemy keeps its full self-granted shield', () => {
        const noStripSkills: ShipSkills = { slots: [{ slot: 'active', abilities: [hit()] }] };
        let captured: CombatActor[] = [];
        runCombat({
            ...BASE,
            shipSkills: noStripSkills,
            __testTapActors: (actors) => {
                captured = actors;
            },
        });
        const enemy = captured.find((a) => a.id === 'enemy-front')!;
        expect(enemy.shieldPool).toBe(50000);
    });
});

describe('PR9b: team symmetry — an ENEMY-sourced shield-strip ability reduces a PLAYER shield the same way', () => {
    const selfShieldThenHitSkills = (): ShipSkills => ({
        slots: [{ slot: 'active', abilities: [selfShield(), hit()] }],
    });

    const strippingEnemy = (pct: number) => ({
        id: 'enemy-front',
        // attack: 0 for the same reason as BASE.attack above — the companion hit() must not
        // deal ordinary damage into the focus's shieldPool and confound the strip assertion.
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000, speed: 50 },
        chargeCount: 0,
        startCharged: false,
        position: 'M4' as Position,
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills: stripSkills(pct),
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
            shipSkills: { slots: [{ slot: 'active' as const, abilities: [hit()] }] }, // control: no shield
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

    it("the enemy's 30% strip reduces the FOCUS player's (self-shielding, speed 100 > enemy speed 50) shield by 30% of its current pool", () => {
        let captured: CombatActor[] = [];
        runCombat({
            attack: 5000,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: selfShieldThenHitSkills(),
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
            hp: 100_000,
            healTargetId: 'attacker',
            mode: 'healing',
            position: 'M4',
            target: parsedTarget('front'),
            pattern: basePattern(),
            teamActors: [teamActor()],
            enemyAttackers: [strippingEnemy(30)],
            __testTapActors: (actors) => {
                captured = actors;
            },
        });
        const focus = captured.find((a) => a.id === 'attacker')!;
        const team = captured.find((a) => a.id === 'player-team')!;
        // Focus self-shields to 50,000 (speed 100 > enemy's 50, acts first this round), then the
        // enemy's 30% strip lands → 50,000 * 0.7 = 35,000.
        expect(focus.shieldPool).toBe(35000);
        // The team actor never self-shields (control kit) — nothing for the strip to touch.
        expect(team.shieldPool).toBe(0);
    });
});
