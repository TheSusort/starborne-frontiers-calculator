import { describe, it, expect } from 'vitest';
import { runCombat, type CombatEngineInput, type TeamActorEngineInput } from '../engine';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { Ship } from '../../../types/ship';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { StatusEngine } from '../statusEngine';
import { bareEnemy } from '../__testutils__/bareRosterFixture';

// ---------------------------------------------------------------------------
// SP-D — Berserker's Marauder Rage II passive ("gains Marauder Rage II for 3 turns when
// hitting 3 ore more enemies") gated live on the ACTUAL per-cast footprint size.
//
// Harness mirrors aoePurge.test.ts's positional two-team battle-sim (healTargetId set unlocks
// the enemy roster; the focus needs position + parsed target so selectTurnTarget resolves a
// REAL enemy as the anchor). Berserker's REAL production-parsed passive-2 ability (from the
// verbatim docs/ship-skills.csv text) supplies the gated buff-grant under test; the damage
// ability is a hand-crafted splash hit (Berserker's own "125% damage" active text carries no
// pattern info of its own — pattern/position are encounter-level, not skill-text-derived).
//
// Distinct seam from Tygr's charge gate (playerTurn.ts's on-cast `ctx`): a passive-sourced
// TIMED self-buff can only be seeded once at combat start (seedPassiveTimedStatuses, before any
// cast has fired) unless promoted to a REACTIVE trigger — detectReactiveTrigger now routes this
// clause to `on-deal-damage`, so the buff re-evaluates at drain time (buildDrainContext) against
// the LIVE per-cast footprint recorded by engine.ts's enemiesHitThisCastByActor.
// ---------------------------------------------------------------------------
let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `ehg${++idc}`,
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

const allPattern = (): ParsedPattern => ({ raw: 'all', shape: 'all', range: 'all', modifiers: {} });

const hit = (): Ability =>
    ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } });

// Verbatim from docs/ship-skills.csv (second_passive_skill_text field). NOTE: CSV typo
// "3 ore more" preserved verbatim (not "or more") — same constant used by the SP-D
// modelCompletenessTriage probe / enemiesHitThisCast.test.ts parser block.
const BERSERKER_P2 =
    'This Unit gains <unit-skill>Marauder Rage II</unit-skill> for 3 turns when hitting 3 ore more enemies.';

function berserkerShip(): Ship {
    return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({} as any),
        refits: [{}, {}, {}, {}],
        secondPassiveSkillText: BERSERKER_P2,
    } as Ship;
}

/** Berserker's REAL production-parsed passive-2 abilities (the gated Marauder Rage II grant,
 *  carrying the enemies-hit-this-cast/gte/3 condition + the on-deal-damage reactive trigger). */
const berserkerPassiveAbilities = (): Ability[] => {
    const built = buildShipAbilities(berserkerShip());
    const passive = built.slots.find((s) => s.slot === 'passive');
    if (!passive) throw new Error('no passive slot built from Berserker text');
    return passive.abilities;
};

const berserkerShipSkills = (): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: [hit()] },
        { slot: 'passive', abilities: berserkerPassiveAbilities() },
    ],
});

/** A harmless dummy enemy: no active abilities of its own (never acts meaningfully), huge HP
 *  (never dies to the focus's splash hit), positioned so it counts toward the footprint. */
const dummyVictim = (id: string, position: Position) => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 1 },
    chargeCount: 0,
    startCharged: false,
    position,
    shipSkills: { slots: [{ slot: 'active' as const, abilities: [] }] },
});

const focusBase = (enemyPositions: Position[]): CombatEngineInput => ({
    attack: 1000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: berserkerShipSkills(),
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
    pattern: allPattern(),
    enemyAttackers: enemyPositions.map((p, i) => dummyVictim(`dummy-${i}`, p)),
});

const rageGranted = (enemyPositions: Position[], ownerId: string): boolean => {
    idc = 0;
    let engine: StatusEngine | undefined;
    runCombat({
        ...focusBase(enemyPositions),
        __testTapStatusEngine: (e) => {
            engine = e;
        },
    });
    return engine!
        .timedAbilityStatuses('self', ownerId)
        .some((b) => b.active.buffName === 'Marauder Rage II');
};

describe('SP-D: enemies-hit-this-cast live gate — Berserker Marauder Rage II (player side)', () => {
    it('splash hits 3 enemies → Marauder Rage II IS granted', () => {
        expect(rageGranted(['M4', 'M3', 'M2'], 'attacker')).toBe(true);
    });

    it('splash hits only 2 enemies → Marauder Rage II is NOT granted', () => {
        expect(rageGranted(['M4', 'M3'], 'attacker')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Team-symmetry: the SAME gate fires when Berserker is the ENEMY attacker, splashing the
// PLAYER team. Mirrors aoePurge.test.ts's "E3 Test B" side-symmetric harness — the focus is a
// passive HP sink (healTargetId unlocks the enemy roster); positioned player actors (focus +
// walked team) stand in as the enemy's footprint victims.
// ---------------------------------------------------------------------------
const sinkSkills = (): ShipSkills => ({ slots: [{ slot: 'active', abilities: [] }] });

const berserkerEnemy = (id: string): NonNullable<CombatEngineInput['enemyAttackers']>[number] => ({
    id,
    stats: { attack: 1000, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 200 },
    chargeCount: 0,
    startCharged: false,
    position: 'M4',
    target: parsedTarget('front'),
    pattern: allPattern(),
    shipSkills: berserkerShipSkills(),
});

const playerTeamActorAt = (id: string, position: Position): TeamActorEngineInput => ({
    id,
    speed: 1,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position,
    target: parsedTarget('front'),
    pattern: allPattern(),
    walk: {
        shipSkills: sinkSkills(),
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 200,
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

const enemyRageGranted = (playerPositions: Position[]): boolean => {
    idc = 0;
    let engine: StatusEngine | undefined;
    runCombat({
        attack: 0,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: sinkSkills(),
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
        position: playerPositions[0],
        target: parsedTarget('front'),
        pattern: allPattern(),
        teamActors: playerPositions
            .slice(1)
            .map((p, i) => playerTeamActorAt(`player-team-${i}`, p)),
        enemyAttackers: [berserkerEnemy('enemy-front')],
        __testTapStatusEngine: (e) => {
            engine = e;
        },
    });
    return engine!
        .timedAbilityStatuses('self', 'enemy-front')
        .some((b) => b.active.buffName === 'Marauder Rage II');
};

describe('SP-D: enemies-hit-this-cast live gate — Berserker Marauder Rage II (enemy side, team-symmetric)', () => {
    it('an ENEMY Berserker splashing 3 positioned players IS granted Marauder Rage II', () => {
        expect(enemyRageGranted(['M4', 'M3', 'M2'])).toBe(true);
    });

    it('an ENEMY Berserker splashing only 2 positioned players is NOT granted Marauder Rage II', () => {
        expect(enemyRageGranted(['M4', 'M3'])).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Tygr's self-charge-gain ("If it damages 2 or more enemies, it adds 1 charge to its Charged
// Skill") — the OTHER seam (playerTurn.ts's on-cast `ctx`, gating a `type:'charge'` payload
// ability via gateFiringAbilities, distinct from Berserker's reactive-drain seam above). DPS
// A single opponent damages exactly one enemy → the 2+ gate is not met (Tygr genuinely doesn't add
// charge against a single target); a positional splash hitting 2+ enemies meets it.
// ---------------------------------------------------------------------------
const TYGR_ACTIVE =
    'This Unit deals <unit-damage>180% damage</unit-damage> and inflicts <unit-skill>Security Down II</unit-skill> for 2 turns. If it damages 2 or more enemies, it adds <unit-aid>adds 1 charge</unit-aid> to its Charged Skill.';

function tygrShip(): Ship {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ...({} as any), refits: [{}, {}, {}, {}], activeSkillText: TYGR_ACTIVE } as Ship;
}

const tygrActiveAbilities = (): Ability[] => {
    const built = buildShipAbilities(tygrShip());
    const active = built.slots.find((s) => s.slot === 'active');
    if (!active) throw new Error('no active slot built from Tygr text');
    return active.abilities;
};

const tygrShipSkills = (): ShipSkills => ({
    slots: [{ slot: 'active', abilities: tygrActiveAbilities() }],
});

const tygrChargesAfterRound1 = (enemyPositions?: Position[]): number => {
    const result = runCombat({
        // The no-`enemyPositions` case is the single-opponent shape. A roster is now
        // required, so it gets the shared inert opponent and the boundary supplies the default
        // front-enemy/origin-only axes — one enemy damaged, so the 2+ gate is still NOT met.
        // (The `enemyPositions` branch below overrides this with its own placed roster.)
        enemyAttackers: bareEnemy({ stats: { hp: 1_000_000_000 } }),
        attack: 1000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 5, // high cap: the +1 gain never reaches the charged-skill threshold
        shipSkills: tygrShipSkills(),
        numRounds: 1,
        selfBuffs: [],
        enemyDebuffs: [],
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        // Charge accumulation is gated on hasChargedSkill (playerTurn.ts) — true here so the
        // +1 self-charge-gain ability can actually bank toward chargeCount without the ACTUAL
        // charged skill ever firing (5 is never reached by a single +1 gain).
        hasChargedSkill: true,
        startCharged: false,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        defence: 0,
        hp: 1_000_000_000,
        ...(enemyPositions
            ? {
                  healTargetId: 'attacker',
                  mode: 'healing',
                  position: 'M4',
                  target: parsedTarget('front'),
                  pattern: allPattern(),
                  enemyAttackers: enemyPositions.map((p, i) => dummyVictim(`dummy-${i}`, p)),
              }
            : {}),
    });
    return result.rounds[0].charges;
};

// `hasChargedSkill: true` (required to unlock charge accumulation at all — see
// tygrChargesAfterRound1) ALSO unlocks the baseline +1-per-active-turn cadence
// (advanceChargeCadence, state.ts) — independent of any ability. So every scenario below
// carries that +1 baseline; a MET enemies-hit-this-cast gate adds a further +1 on top
// (Tygr's ability-driven gain), observable as the delta between the met/not-met cases.
const BASELINE_CADENCE = 1;

describe('SP-D: enemies-hit-this-cast live gate — Tygr self-charge-gain', () => {
    it('single opponent, default targeting axes: only 1 enemy damaged → NOT met, no ability charge gained', () => {
        expect(tygrChargesAfterRound1()).toBe(BASELINE_CADENCE);
    });

    it('positional splash hitting 2 enemies: the gate IS met, ability charge gained on top', () => {
        expect(tygrChargesAfterRound1(['M4', 'M3'])).toBe(BASELINE_CADENCE + 1);
    });

    it('positional splash hitting only 1 enemy: the gate is NOT met, no ability charge gained', () => {
        expect(tygrChargesAfterRound1(['M4'])).toBe(BASELINE_CADENCE);
    });
});
