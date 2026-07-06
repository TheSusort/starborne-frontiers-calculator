/**
 * PR-B1: Paracelsus's "Upon being killed by direct Damage" clause routes BOTH halves onto the
 * existing on-destroyed trigger:
 *   (a) a 50%-max-HP retaliation (`type: 'damage'`, `hpBasisPct`) against the killer, and
 *   (b) an ally-wide Everliving Regeneration II grant (`type: 'buff'`, `target: 'all-allies'`) —
 *       previously wired onto on-cast; PR-B1 moves it onto on-destroyed too.
 *
 * Model-completeness triage locked the ability SHAPE (modelCompletenessTriage.test.ts, SP-B).
 * These are the ENGINE-level integration tests proving the shapes actually EXECUTE:
 *   - the retaliation credits real (mitigated) damage against the actor that landed the killing
 *     DIRECT blow (the same credit-only reactive-damage executor Vindicator's on-resist proc
 *     uses — see vindicatorOnResistDamage.integration.test.ts for the precedent: this executor
 *     never mutates a victim's live HP, it credits the owner's round damage-dealt bucket),
 *   - the buff lands on every LIVING ally,
 *   - and BOTH hold identically whether Paracelsus is a PLAYER-side team actor or an
 *     ENEMY-side attacker (team symmetry) — mirroring the Battlecry/Last Wish on-destroyed
 *     precedents (equipmentAbilities.integration.test.ts) for the positional two-team harness.
 *
 * Each scenario carries a gate-flip CONTROL (Paracelsus's passive replaced by a plain basic
 * attack) proving the observed retaliation credit + buff are caused by the real parsed
 * ability, not some baseline artefact.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { ShipSkills } from '../../../types/abilities';
import type { Ship } from '../../../types/ship';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

// Verbatim from docs/ship-skills.csv (second_passive_skill_text field) — same constant as the
// SP-B triage probe (modelCompletenessTriage.test.ts). Do not alter.
const PARACELSUS_P2 =
    'Upon being killed by direct Damage, this Unit deals <unit-damage>Damage equal to 50%</unit-damage> of its max HP and grants allies <unit-skill>Everliving Regeneration II</unit-skill> for 4 turns.';

/** Minimal Ship stub — mirrors modelCompletenessTriage.test.ts's `ship()` helper. */
function makeShip(over: Partial<Ship>): Ship {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ...({} as any), refits: [{}, {}, {}, {}], ...over } as Ship;
}

/** Single-hit, harmless (multiplier 0) basic attack — keeps the round cadence without
 *  contributing any of its own credited damage (isolates the retaliation credit). */
const basicAttackSlot = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        {
            id: 'basic-atk',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'damage', multiplier: 0 },
        },
    ],
});

/** Builds Paracelsus's REAL production passive slot from the verbatim text (buildShipAbilities —
 *  the same path simulateBattle feeds the engine), paired with a no-op active. */
function buildParacelsusSlots(): ShipSkills['slots'] {
    const built = buildShipAbilities(makeShip({ secondPassiveSkillText: PARACELSUS_P2 }));
    const passive = built.slots.find((s) => s.slot === 'passive');
    if (!passive) throw new Error('no passive slot built from Paracelsus text');
    return [basicAttackSlot(), passive];
}

/** Control slots: no Paracelsus passive at all — proves the main run's credit/buff are caused
 *  by the real parsed ability, not some baseline artefact. */
const controlSlots = (): ShipSkills['slots'] => [basicAttackSlot()];

const PARA_HP = 10_000;
const EXPECTED_RETALIATION = PARA_HP * 0.5; // hpBasisPct 50, defence 0 → exact (no mitigation/crit)
const REGEN_BUFF = 'Everliving Regeneration II';
const REGEN_DURATION = 4;

const parsedTargetFront = (): ParsedTarget => ({ raw: 'front', side: 'enemy', selection: 'front' });
// Line-Range-1: origin (front-most) full damage + one covered cell (half damage).
const lineRange1 = (): ParsedPattern => ({
    raw: 'line-range-1',
    shape: 'line',
    range: 1,
    modifiers: {},
});

// ═══════════════════════════════════════════════════════════════════════════════════
// Scenario A — Paracelsus is a PLAYER-side team actor.
// ═══════════════════════════════════════════════════════════════════════════════════
//
// Board: surviving focus 'attacker' at M3 (covered, huge HP, receives the buff); team actor
// 'paracelsus' at M4 (origin, tiny HP, one-shot); enemy 'killer' at M1 firing a lethal
// Line-Range-1 hit at `front`. The killer is fast (acts first); paracelsus/attacker are slow
// (playerActorAt's template speed 1), so the kill lands round 1.

function playerActorAt(
    id: string,
    position: Position,
    slots: ShipSkills['slots'],
    hp: number
): TeamActorEngineInput {
    return {
        id,
        speed: 1,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position,
        target: parsedTargetFront(),
        pattern: lineRange1(),
        walk: {
            shipSkills: { slots },
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 0,
                hp,
            },
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
            healModifier: 0,
        },
    };
}

/** An enemy attacker firing a REAL damaging (100%) Line-Range-1 hit at `front` — the killer. */
function offensiveEnemyAt(id: string, position: Position, attack: number): EnemyAttacker {
    return {
        id,
        stats: { attack, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 1_000 },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parsedTargetFront(),
        pattern: lineRange1(),
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        {
                            id: 'killer-hit',
                            type: 'damage',
                            target: 'enemy',
                            trigger: 'on-cast',
                            conditions: [],
                            config: { type: 'damage', multiplier: 100, hits: 1 },
                        },
                    ],
                },
            ],
        } as ShipSkills,
    } as EnemyAttacker;
}

const FOCUS_HP = 1_000_000_000;

const playerScenarioInput = (paracelsusSlots: ShipSkills['slots']): CombatEngineInput => ({
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [basicAttackSlot()] },
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
    hp: FOCUS_HP,
    healModifier: 0,
    healTargetId: 'attacker',
    position: 'M3', // focus is the COVERED survivor
    target: parsedTargetFront(),
    pattern: lineRange1(),
    teamActors: [playerActorAt('paracelsus', 'M4', paracelsusSlots, PARA_HP)],
    enemyAttackers: [offensiveEnemyAt('killer', 'M1', 1_000_000_000)],
});

/** Runs a scenario input, collecting ship-destroyed/buff-applied events + credited direct
 *  damage per source id. */
function runScenario(input: CombatEngineInput) {
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    bus.on('ship-destroyed', (e) => events.push(e as CombatEvent));
    bus.on('buff-applied', (e) => events.push(e as CombatEvent));
    const creditedDirect = new Map<string, number>();
    runCombat({
        ...input,
        bus,
        __testTapCreditDamage: (id, channel, amount) => {
            if (channel === 'direct')
                creditedDirect.set(id, (creditedDirect.get(id) ?? 0) + amount);
        },
    });
    return { events, creditedDirect };
}

describe('Paracelsus on-destroyed retaliation + ally-buff — player side', () => {
    it('Paracelsus killed by direct damage: retaliation credits ~50% of its max HP; allies get Everliving Regeneration II', () => {
        const { events, creditedDirect } = runScenario(playerScenarioInput(buildParacelsusSlots()));

        // Sanity: Paracelsus actually died to a DIRECT hit.
        const destroyed = events.filter(
            (e) => e.type === 'ship-destroyed' && e.actorId === 'paracelsus'
        );
        expect(destroyed.length).toBeGreaterThanOrEqual(1);
        expect(destroyed.some((e) => e.type === 'ship-destroyed' && e.byDirectDamage)).toBe(true);

        // (a) Retaliation: the dying Paracelsus's death credits ~50% of its own max HP as
        // 'direct' damage (defence 0, crit 0, same-affinity → no mitigation/bonus, so the raw
        // credited amount equals the basis exactly — mirrors the Vindicator on-resist pin).
        expect(creditedDirect.get('paracelsus') ?? 0).toBeCloseTo(EXPECTED_RETALIATION, 0);

        // (b) Ally-buff: the surviving ally 'attacker' receives Everliving Regeneration II
        // for its full 4-turn duration.
        const regen = events.filter(
            (e) =>
                e.type === 'buff-applied' && e.buffName === REGEN_BUFF && e.actorId === 'attacker'
        );
        expect(regen.length).toBeGreaterThanOrEqual(1);
        expect(regen.some((e) => e.type === 'buff-applied' && e.duration === REGEN_DURATION)).toBe(
            true
        );
    });

    it('CONTROL — Paracelsus with no passive: dying credits nothing and grants no buff', () => {
        const { events, creditedDirect } = runScenario(playerScenarioInput(controlSlots()));

        const destroyed = events.filter(
            (e) => e.type === 'ship-destroyed' && e.actorId === 'paracelsus'
        );
        expect(destroyed.length).toBeGreaterThanOrEqual(1); // still dies (same lethal hit)

        expect(creditedDirect.get('paracelsus') ?? 0).toBe(0);
        expect(
            events.filter((e) => e.type === 'buff-applied' && e.buffName === REGEN_BUFF)
        ).toHaveLength(0);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════════
// Scenario B — Paracelsus is an ENEMY-side attacker (team symmetry mirror of Scenario A).
// ═══════════════════════════════════════════════════════════════════════════════════
//
// Board: player 'attacker' at M1 (fast, deals the lethal Line-Range-1 hit at `front`);
// enemy 'paracelsus-e' at M4 (origin, tiny HP, one-shot, carries the same real Paracelsus
// passive); enemy 'enemy-ally' at M2 (outside the AoE footprint — untouched, survives,
// receives the buff). This exercises the SEPARATE enemy-side reactive registration
// (registerReactiveListeners' second call in engine.ts) end-to-end.

function enemyActorAt(
    id: string,
    position: Position,
    slots: ShipSkills['slots'],
    hp: number,
    speed = 10
): EnemyAttacker {
    return {
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp, speed },
        chargeCount: 0,
        startCharged: false,
        position,
        shipSkills: { slots },
    } as EnemyAttacker;
}

const enemyScenarioInput = (paracelsusSlots: ShipSkills['slots']): CombatEngineInput => ({
    attack: 1_000_000_000, // dwarfs PARA_HP → guaranteed one-shot direct hit on paracelsus-e
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [basicAttackSlot()] }, // placeholder; replaced below with a REAL attack
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
    speed: 100, // fast — the player acts first each round
    healTargetId: 'attacker',
    position: 'M1',
    target: parsedTargetFront(),
    pattern: lineRange1(),
    enemyAttackers: [
        enemyActorAt('paracelsus-e', 'M4', paracelsusSlots, PARA_HP),
        enemyActorAt('enemy-ally', 'M2', [basicAttackSlot()], 1_000_000_000),
    ],
});

// The player's own basic attack must actually deal damage (100% multiplier) to land the
// lethal hit — overrides the placeholder harmless slot above.
const playerLethalAttackSlots: ShipSkills['slots'] = [
    {
        slot: 'active',
        abilities: [
            {
                id: 'player-hit',
                type: 'damage',
                target: 'enemy',
                trigger: 'on-cast',
                conditions: [],
                config: { type: 'damage', multiplier: 100, hits: 1 },
            },
        ],
    },
];

describe('Paracelsus on-destroyed retaliation + ally-buff — enemy side (team symmetry)', () => {
    it('An enemy Paracelsus killed by direct damage: retaliation credits ~50% of its max HP against the killer; enemy allies get Everliving Regeneration II', () => {
        const { events, creditedDirect } = runScenario({
            ...enemyScenarioInput(buildParacelsusSlots()),
            shipSkills: { slots: playerLethalAttackSlots },
        });

        const destroyed = events.filter(
            (e) => e.type === 'ship-destroyed' && e.actorId === 'paracelsus-e'
        );
        expect(destroyed.length).toBeGreaterThanOrEqual(1);
        expect(destroyed.some((e) => e.type === 'ship-destroyed' && e.byDirectDamage)).toBe(true);

        // (a) Retaliation: credited against the dying enemy Paracelsus's own bucket, routed at
        // the player 'attacker' (the killer) — same magnitude as the player-side scenario.
        expect(creditedDirect.get('paracelsus-e') ?? 0).toBeCloseTo(EXPECTED_RETALIATION, 0);

        // (b) Ally-buff: the surviving enemy ally receives Everliving Regeneration II.
        const regen = events.filter(
            (e) =>
                e.type === 'buff-applied' && e.buffName === REGEN_BUFF && e.actorId === 'enemy-ally'
        );
        expect(regen.length).toBeGreaterThanOrEqual(1);
        expect(regen.some((e) => e.type === 'buff-applied' && e.duration === REGEN_DURATION)).toBe(
            true
        );
    });

    it('CONTROL — enemy Paracelsus with no passive: dying credits nothing and grants no buff', () => {
        const { events, creditedDirect } = runScenario({
            ...enemyScenarioInput(controlSlots()),
            shipSkills: { slots: playerLethalAttackSlots },
        });

        const destroyed = events.filter(
            (e) => e.type === 'ship-destroyed' && e.actorId === 'paracelsus-e'
        );
        expect(destroyed.length).toBeGreaterThanOrEqual(1);

        expect(creditedDirect.get('paracelsus-e') ?? 0).toBe(0);
        expect(
            events.filter((e) => e.type === 'buff-applied' && e.buffName === REGEN_BUFF)
        ).toHaveLength(0);
    });
});
