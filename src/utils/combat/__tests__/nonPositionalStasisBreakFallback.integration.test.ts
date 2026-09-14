/**
 * nonPositionalStasisBreakFallback.integration.test.ts — the `?? <cast-time set>` fallback in
 * `resolveAnchorStasisBreak(<site>DriveAnchorStasis ?? <site>TurnStasisHitVictims, ...)`.
 *
 * `<site>DriveAnchorStasis` is assigned only when `drivePositionalTurnApply` actually ran, which
 * requires a damage ability to have fired this cast (`positionalScalars` is `hasDamageAbility ?
 * ... : undefined` — see playerTurn.ts). A PURE debuff cast (no damage ability at all) never sets
 * `positionalScalars`, so the `positional` gate is false regardless of board layout and
 * `<site>DriveAnchorStasis` stays `undefined` — the fallback operand,
 * `<site>TurnStasisHitVictims`, is what `resolveAnchorStasisBreak` actually reads.
 *
 * `<site>TurnStasisHitVictims` is populated by the cast-time `onHitBreakStasis` hook
 * (playerTurn.ts), which fires once per turn whenever this cast has a live, currently-stasised
 * target and the attacker does not carry `doesntBreakStasis` — independent of whether any ability
 * in the kit deals damage. So a debuff-only attacker with a stasised front target exercises the
 * fallback operand on every turn it takes.
 *
 * FIXTURE. Geometry lifted from `perFootprintStasisBreak.integration.test.ts`'s focus-site
 * section: a fast player stasis-bot (M4) seeds Stasis on the enemy front victim (M4) in round 1,
 * an enemy culler (T1, Line-Range-1) one-shots the bot that same round so Stasis is applied
 * exactly once, and the SUT breaker sits at the player rear column (M1) so the culler's
 * front-anchored AoE never reaches it. The SUT's kit here is a single DEBUFF ability with no
 * damage component — the one difference from that file's breaker, and the one that keeps this
 * cast off the positional drive for its whole run.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type Selection = ParsedTarget['selection'];

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `npsbf${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

const parsedTarget = (selection: Selection): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});

/** An ally-target selection: `selectTurnTarget` resolves no opposing victim for it, so
 *  `tgtWasStasised` is false and `onHitBreakStasis` is never wired — the inert shape used to keep
 *  the focus actor from also marking the shared victim in the team/enemy-site variants below. */
const ALLY_TARGET: ParsedTarget = { raw: 'ally-team', side: 'ally', selection: 'team' };

const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });
const lineRange1Pattern = (): ParsedPattern => ({
    raw: 'line-range-1',
    shape: 'line',
    range: 1,
    modifiers: {},
});

const basicAttack = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } }),
    ],
});

const stasisInflictAttack = (turns: number): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } }),
        ab({
            type: 'debuff',
            target: 'enemy',
            config: {
                type: 'debuff',
                buffName: 'Stasis',
                application: 'inflict',
                duration: turns,
                stacks: 1,
                isStackable: false,
                parsedEffects: {},
            },
        }),
    ],
});

/** The SUT's kit: ONE debuff ability, no damage ability anywhere in the slot list. With no
 *  damage ability firing, `positionalScalars` stays `undefined` for this cast — see file header —
 *  so this attacker's turns never reach `drivePositionalTurnApply`, on ANY board layout. */
const debuffOnlyAttack = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        ab({
            type: 'debuff',
            target: 'enemy',
            config: {
                type: 'debuff',
                buffName: 'Weaken',
                application: 'inflict',
                duration: 1,
                stacks: 1,
                isStackable: false,
                parsedEffects: {},
            },
        }),
    ],
});

const collectAbilityPerformed = (input: CombatEngineInput) => {
    const bus = createEventBus();
    const performed: Extract<CombatEvent, { type: 'ability-performed' }>[] = [];
    bus.on('ability-performed', (e) => performed.push(e));
    const result = runCombat({ ...input, bus });
    return { result, performed };
};

const firedRounds = (
    performed: Extract<CombatEvent, { type: 'ability-performed' }>[],
    actorId: string
): number[] => performed.filter((e) => e.actorId === actorId).map((e) => e.round);

// Stasis(6) hit every round loses 2 turns/round (the deferred break's −1 plus the natural
// Post-Turn −1), clearing inside a 4-round run; hit never breaks it stays locked the whole run.
const STASIS_LONG = 6;
const ROUNDS = 4;

// Fast player stasis-bot (hp 1 — the culler one-shots it), hacking 200 vs the victim's
// security 0 so Stasis always lands.
const playerStasisBot = (): TeamActorEngineInput => ({
    id: 'pbot',
    speed: 1000,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position: 'M4',
    target: parsedTarget('front'),
    pattern: basePattern(),
    walk: {
        shipSkills: { slots: [stasisInflictAttack(STASIS_LONG)] },
        stats: {
            attack: 1,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 200,
            defence: 0,
            hp: 1,
        },
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: false,
        healModifier: 0,
    },
});

// High-HP enemy front victim with a basicAttack so it CAN emit ability-performed once freed.
const enemyVictim = (): EnemyAttacker => ({
    id: 'enemy-victim',
    stats: {
        attack: 1,
        crit: 0,
        critDamage: 0,
        defence: 0,
        hp: 1_000_000_000,
        speed: 1,
        security: 0,
        hacking: 0,
    },
    chargeCount: 0,
    startCharged: false,
    position: 'M4',
    target: parsedTarget('front'),
    pattern: basePattern(),
    shipSkills: { slots: [basicAttack()] },
});

// Enemy culler (T-row): row-scan reaches the player M-row first, Line-Range-1 anchors the
// front-most M-column occupant (the bot at M4) and one-shots it in round 1 — the SUT sits at the
// rear column M1, outside that AoE's footprint.
const enemyCuller = (): EnemyAttacker => ({
    id: 'culler',
    stats: {
        attack: 1_000_000,
        crit: 0,
        critDamage: 0,
        defence: 0,
        hp: 1_000_000_000,
        speed: 500,
        security: 0,
        hacking: 0,
    },
    chargeCount: 0,
    startCharged: false,
    position: 'T1',
    target: parsedTarget('front'),
    pattern: lineRange1Pattern(),
    shipSkills: { slots: [basicAttack()] },
});

const SUT_BASE = (doesntBreakStasis: boolean): CombatEngineInput => ({
    attack: 1,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [debuffOnlyAttack()] },
    numRounds: ROUNDS,
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
    hacking: 0,
    doesntBreakStasis,
    healTargetId: 'attacker',
    mode: 'healing',
    position: 'M1',
    speed: 100,
    target: parsedTarget('front'),
    pattern: basePattern(),
    teamActors: [playerStasisBot()],
    enemyAttackers: [enemyVictim(), enemyCuller()],
});

describe('the non-positional cast-time Stasis-break fallback (focus site)', () => {
    it("a debuff-only attacker (no damage ability, never positional) breaks the front victim's Stasis", () => {
        const { performed } = collectAbilityPerformed(SUT_BASE(false));

        // Stasis(6) ≫ 4 rounds under natural decay alone — it could only have acted because
        // something broke it, and the SUT here has no damage ability, so the drive's
        // `onVictimPreImpact` mark never ran: this can only be the cast-time `onHitBreakStasis`
        // fallback resolving through `resolveAnchorStasisBreak`.
        expect(firedRounds(performed, 'enemy-victim').length).toBeGreaterThan(0);
    });

    it('NON-VACUOUS control: the SAME debuff-only attacker WITH doesntBreakStasis never breaks it', () => {
        const { performed } = collectAbilityPerformed(SUT_BASE(true));

        // doesntBreakStasis ⇒ `onHitBreakStasis` is never wired at all (tgtWasStasised is
        // false), so the aggregate set stays empty and the victim keeps its Stasis the whole run.
        expect(firedRounds(performed, 'enemy-victim')).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------------------------
// TEAM SITE — the walked-team-actor mirror. The focus is parked on an ALLY_TARGET (no opposing
// victim ⇒ its own `onHitBreakStasis` is never wired), so the only cast that can mark
// 'enemy-victim' is the walked team actor's `teamDriveAnchorStasis ?? teamTurnStasisHitVictims`.
// ---------------------------------------------------------------------------------------------

const teamDebuffOnlySut = (doesntBreakStasis: boolean): TeamActorEngineInput => ({
    id: 'team-sut',
    speed: 100,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    doesntBreakStasis,
    position: 'M1',
    target: parsedTarget('front'),
    pattern: basePattern(),
    walk: {
        shipSkills: { slots: [debuffOnlyAttack()] },
        stats: {
            attack: 1,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 0,
            defence: 0,
            hp: 1_000_000_000,
        },
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: false,
        healModifier: 0,
    },
});

const TEAM_SUT_BASE = (doesntBreakStasis: boolean): CombatEngineInput => ({
    attack: 1,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [] },
    numRounds: ROUNDS,
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
    hacking: 0,
    healTargetId: 'attacker',
    mode: 'healing',
    // Inert: ally-targeted, no abilities. Never resolves an opposing victim, so it can never
    // itself mark 'enemy-victim' — isolates the team site's own fallback.
    position: 'B1',
    speed: 1,
    target: ALLY_TARGET,
    pattern: basePattern(),
    teamActors: [playerStasisBot(), teamDebuffOnlySut(doesntBreakStasis)],
    enemyAttackers: [enemyVictim(), enemyCuller()],
});

describe('the non-positional cast-time Stasis-break fallback (team site)', () => {
    it("a debuff-only walked team actor (no damage ability, never positional) breaks the front victim's Stasis", () => {
        const { performed } = collectAbilityPerformed(TEAM_SUT_BASE(false));

        expect(firedRounds(performed, 'enemy-victim').length).toBeGreaterThan(0);
    });

    it('NON-VACUOUS control: the SAME walked team actor WITH doesntBreakStasis never breaks it', () => {
        const { performed } = collectAbilityPerformed(TEAM_SUT_BASE(true));

        expect(firedRounds(performed, 'enemy-victim')).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------------------------
// ENEMY SITE — the enemy-carrier mirror. Sides flipped: a fast ENEMY stasis-bot seeds Stasis on a
// PLAYER victim, a PLAYER culler kills the bot, and the debuff-only SUT is itself an
// `EnemyAttacker`. The focus is again parked on an ALLY_TARGET so it cannot also mark the victim.
// ---------------------------------------------------------------------------------------------

const enemyStasisBot = (): EnemyAttacker => ({
    id: 'ebot',
    stats: {
        attack: 1,
        crit: 0,
        critDamage: 0,
        defence: 0,
        hp: 1,
        speed: 1000,
        security: 0,
        hacking: 200,
    },
    chargeCount: 0,
    startCharged: false,
    position: 'M4',
    target: parsedTarget('front'),
    pattern: basePattern(),
    shipSkills: { slots: [stasisInflictAttack(STASIS_LONG)] },
});

// High-HP player victim with a basicAttack so it CAN emit ability-performed once freed.
const playerVictim = (): TeamActorEngineInput => ({
    id: 'player-victim',
    speed: 1,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position: 'M4',
    target: parsedTarget('front'),
    pattern: basePattern(),
    walk: {
        shipSkills: { slots: [basicAttack()] },
        stats: {
            attack: 1,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 0,
            defence: 0,
            hp: 1_000_000_000,
            security: 0,
        },
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: false,
        healModifier: 0,
    },
});

// Player culler (T-row): row-scan reaches the enemy M-row first, Line-Range-1 anchors the
// front-most M-column occupant (the enemy bot at M4) and one-shots it in round 1.
const playerCuller = (): TeamActorEngineInput => ({
    id: 'player-culler',
    speed: 500,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position: 'T1',
    target: parsedTarget('front'),
    pattern: lineRange1Pattern(),
    walk: {
        shipSkills: { slots: [basicAttack()] },
        stats: {
            attack: 1_000_000,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 0,
            defence: 0,
            hp: 1_000_000_000,
        },
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: false,
        healModifier: 0,
    },
});

// The enemy debuff-only SUT: rear column M1, outside the player culler's Line-Range-1 footprint.
const enemyDebuffOnlySut = (doesntBreakStasis: boolean): EnemyAttacker => ({
    id: 'enemy-sut',
    stats: {
        attack: 1,
        crit: 0,
        critDamage: 0,
        defence: 0,
        hp: 1_000_000_000,
        speed: 100,
        security: 0,
        hacking: 0,
    },
    chargeCount: 0,
    startCharged: false,
    doesntBreakStasis,
    position: 'M1',
    target: parsedTarget('front'),
    pattern: basePattern(),
    shipSkills: { slots: [debuffOnlyAttack()] },
});

const ENEMY_SUT_BASE = (doesntBreakStasis: boolean): CombatEngineInput => ({
    attack: 1,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [] },
    numRounds: ROUNDS,
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
    hacking: 0,
    healTargetId: 'attacker',
    mode: 'healing',
    // Inert — see the TEAM SITE section's note.
    position: 'B1',
    speed: 1,
    target: ALLY_TARGET,
    pattern: basePattern(),
    teamActors: [playerVictim(), playerCuller()],
    enemyAttackers: [enemyStasisBot(), enemyDebuffOnlySut(doesntBreakStasis)],
});

describe('the non-positional cast-time Stasis-break fallback (enemy site)', () => {
    it("a debuff-only enemy attacker (no damage ability, never positional) breaks the player victim's Stasis", () => {
        const { performed } = collectAbilityPerformed(ENEMY_SUT_BASE(false));

        expect(firedRounds(performed, 'player-victim').length).toBeGreaterThan(0);
    });

    it('NON-VACUOUS control: the SAME enemy attacker WITH doesntBreakStasis never breaks it', () => {
        const { performed } = collectAbilityPerformed(ENEMY_SUT_BASE(true));

        expect(firedRounds(performed, 'player-victim')).toHaveLength(0);
    });
});
