/**
 * Reactive DoT positional routing.
 *
 * BUG: the reactive `cfg.type === 'dot'` branch in triggers.ts always pushed onto the
 * engine-scope `ctx.corrosionEntries` alias of the dummy `enemy` sink and stamped the
 * `dot-applied` event with `ctx.enemy.id`. In a positional (team-vs-team) sim this leaks a
 * player-side reactive corrosion onto the vestigial dummy `enemy` instead of the REAL enemy the
 * triggering ally hit — producing a spurious end-of-round "enemy: corrosion" tick and denying the
 * real enemy the reactive DoT.
 *
 * This mirrors the sibling `convert-dot` fix (corrosionToAcidicDecay.test.ts): resolve the real
 * victim via `eventCtx.victimId` and route there, keeping the dummy sink empty. The `on-ally-crit-dot`
 * listener must ALSO stamp `victimId` (it currently enqueues a bare intent), else the branch has
 * nothing to resolve.
 *
 * Harness: twoTeamBattle-style positional battle. A crit-casting team ally applies corrosion to a
 * positioned enemy (viaCrit → dot-applied), the focus carries a Crocus-style `on-ally-crit-dot`
 * reactive corrosion passive that fires "on that enemy". DPS-mode routing (dummy IS the victim)
 * stays byte-identical — covered by allyCritDot.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { CombatActor } from '../state';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `rdp${++idc}`,
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

// Focus (Crocus-style): a no-payload damage active + an on-ally-crit-dot reactive corrosion passive.
const focusSkills = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [ab({ type: 'damage', config: { type: 'damage', multiplier: 100 } })],
        },
        {
            slot: 'passive',
            abilities: [
                ab({
                    type: 'dot',
                    target: 'enemy',
                    trigger: 'on-ally-crit-dot',
                    config: {
                        type: 'dot',
                        dotType: 'corrosion',
                        tier: 5,
                        stacks: 1,
                        duration: 3,
                    },
                }),
            ],
        },
    ],
});

// A positioned team ally that crit-casts a corrosion DoT on the front enemy (viaCrit → the
// reactive listener fires with the enemy as the dot-applied targetId).
const critCorrosionAllyAt = (id: string, position: Position): TeamActor => ({
    id,
    speed: 150, // acts before the focus (100) so its crit-cast fires the reactive same round
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position,
    target: parsedTarget('front'),
    pattern: basePattern(),
    walk: {
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 100 } }),
                        ab({
                            type: 'dot',
                            config: {
                                type: 'dot',
                                dotType: 'corrosion',
                                tier: 5,
                                stacks: 1,
                                duration: 3,
                            },
                        }),
                    ],
                },
            ],
        },
        stats: {
            attack: 10000,
            crit: 100, // always crits → dot-applied carries viaCrit: true
            critDamage: 100,
            defensePenetration: 0,
            hacking: 100, // vs enemy security 0 → DoT always lands
            defence: 0,
            hp: 1_000_000_000,
        },
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: false,
    },
});

// A passive positioned enemy (bare basic attack) with huge HP so it survives the round.
const basicEnemyAt = (id: string, position: Position): EnemyAttacker =>
    ({
        id,
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp: 1_000_000_000,
            speed: 1,
            security: 0,
        },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [ab({ type: 'damage', config: { type: 'damage', multiplier: 0 } })],
                },
            ],
        },
    }) as EnemyAttacker;

const BASE = (over: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    // Focus 'attacker' at M4 targeting 'front'.
    attack: 10000,
    crit: 0, // focus itself never crits — keeps its own casts out of viaCrit events
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: focusSkills(),
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
    speed: 100,
    hacking: 100, // focus reactive DoT lands (vs enemy security 0)
    enemySecurity: 0,
    // Healing mode unlocks the positioned enemy roster (the sim's team-vs-team path).
    healTargetId: 'attacker',
    position: 'M4',
    target: parsedTarget('front'),
    pattern: basePattern(),
    teamActors: [critCorrosionAllyAt('crit-ally', 'M3')],
    enemyAttackers: [basicEnemyAt('enemy-front', 'M4')],
    ...over,
});

describe('reactive DoT positional routing — on-ally-crit-dot lands on the real enemy, not the dummy sink', () => {
    it('the focus reactive corrosion lands on the positioned enemy and the dummy enemy stays empty', () => {
        idc = 0;
        let enemyFront: CombatActor | undefined;
        let dummyEnemy: CombatActor | undefined;
        runCombat(
            BASE({
                __testTapActors: (actors) => {
                    enemyFront = actors.find((a) => a.id === 'enemy-front');
                    dummyEnemy = actors.find((a) => a.id === 'enemy');
                },
            })
        );
        if (!enemyFront) throw new Error('__testTapActors never handed out enemy-front');

        // The dummy player-offense sink must NOT receive the reactive corrosion.
        expect(dummyEnemy?.corrosionEntries ?? []).toHaveLength(0);

        // The focus's reactive corrosion (sourceId = focus 'attacker') must land on the REAL
        // positioned enemy the ally hit — "on that enemy".
        expect(enemyFront.corrosionEntries.some((e) => e.sourceId === 'attacker')).toBe(true);

        // Sanity: the ally's own crit-cast corrosion is also on the real enemy (active path).
        expect(enemyFront.corrosionEntries.some((e) => e.sourceId === 'crit-ally')).toBe(true);
    });
});

// Focus with a Burner-style on-deal-damage inferno passive (the OTHER reactive-dot trigger). Its
// own attack triggers it; the inferno must land on the enemy it hit, not the dummy sink. Without
// this, the dummy-turn-order gate would strand the stack (applied to a turnless dummy).
const burnerFocusSkills = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [ab({ type: 'damage', config: { type: 'damage', multiplier: 100 } })],
        },
        {
            slot: 'passive',
            abilities: [
                ab({
                    type: 'dot',
                    target: 'enemy',
                    trigger: 'on-deal-damage',
                    config: {
                        type: 'dot',
                        dotType: 'inferno',
                        tier: 15,
                        stacks: 1,
                        duration: 2,
                    },
                }),
            ],
        },
    ],
});

describe('reactive DoT positional routing — on-deal-damage (Burner) inferno lands on the real enemy', () => {
    it('the focus on-deal-damage inferno lands on the positioned enemy it hit, dummy stays empty', () => {
        idc = 0;
        let enemyFront: CombatActor | undefined;
        let dummyEnemy: CombatActor | undefined;
        runCombat(
            BASE({
                shipSkills: burnerFocusSkills(),
                // Drop the crit-ally so the ONLY reactive dot is the focus's on-deal-damage inferno.
                teamActors: [],
                __testTapActors: (actors) => {
                    enemyFront = actors.find((a) => a.id === 'enemy-front');
                    dummyEnemy = actors.find((a) => a.id === 'enemy');
                },
            })
        );
        if (!enemyFront) throw new Error('__testTapActors never handed out enemy-front');

        // The dummy sink must NOT receive the on-deal-damage inferno.
        expect(dummyEnemy?.infernoEntries ?? []).toHaveLength(0);
        // The inferno must land on the REAL enemy the focus attacked.
        expect(enemyFront.infernoEntries.some((e) => e.sourceId === 'attacker')).toBe(true);
    });
});
