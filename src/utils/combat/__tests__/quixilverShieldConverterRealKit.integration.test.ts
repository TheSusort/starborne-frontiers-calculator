/**
 * Quixilver's REAL charged skill — "deals 130% damage … and gains Shield Converter" — arms the
 * one-shot nullify. Her parsed grant carries NO duration (the text states none), which is the shape
 * the synthetic fixtures in shieldConverter.integration.test.ts never use: they hand the status a
 * numeric duration, so they prove the mechanic but not that the real kit reaches it.
 *
 * In-fight: Quixilver fires her charged skill in round 1, then an enemy hits her for 5,000. The hit
 * is nullified and her shield grows by 5,000. Both sides.
 *
 * The routing rule lives in `classifyCastStatus` (engine.ts); the corpus tripwire at the bottom
 * fails if any firing-slot one-shot persistent grant classifies into the aura store again.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runCombat, classifyCastStatus, type CombatEngineInput } from '../engine';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { ONE_SHOT_PERSISTENT_BUFFS } from '../../../constants/oneShotPersistentBuffs';
import { SHIELD_CONVERTER } from '../shieldConverter';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { Position } from '../../../types/encounters';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data) — copy them in before running'
        );
    }
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

const DIRECT_HIT = 5000; // attack 5000 × 100% vs defence 0, no crit.
const HP = 10_000_000;

const quixilverCharged = (): Ability[] => {
    const ship = buildTraceShip('Quixilver');
    if (!ship) throw new Error('Quixilver missing from reference data');
    const slot = buildShipAbilities(ship).slots.find((s) => s.slot === 'charged');
    if (!slot) throw new Error('Quixilver has no charged slot');
    return slot.abilities;
};

const noopDamage = (): Ability => ({
    id: 'noop-dmg',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 0 },
});

const basicAttack = (): Ability => ({
    id: 'basic',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100 },
});

// The holder fires her charged skill once (startCharged, a cadence that never re-arms), acts first,
// and deals no damage of her own (attack 0), so the only hit in the fight is the incoming one.
const holderSkills = (): ShipSkills['slots'] => [
    { slot: 'active', abilities: [noopDamage()] },
    { slot: 'charged', abilities: quixilverCharged() },
];

const playerHolder = (id: string, position: Position): TeamActor => ({
    id,
    speed: 1000,
    chargeCount: 99,
    startCharged: true,
    selfBuffs: [],
    enemyDebuffs: [],
    position,
    walk: {
        shipSkills: { slots: holderSkills() },
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 0,
            defence: 0,
            hp: HP,
        },
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: true,
    },
});

const enemy = (
    id: string,
    position: Position,
    over: Partial<EnemyAttacker> & { attack: number; speed: number }
): EnemyAttacker => ({
    id,
    stats: { attack: over.attack, crit: 0, critDamage: 0, defence: 0, hp: HP, speed: over.speed },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    shipSkills: { slots: [{ slot: 'active', abilities: [basicAttack()] }] },
    ...over,
});

const base = (over: Partial<CombatEngineInput>): CombatEngineInput => ({
    enemyAttackers: [],
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [{ slot: 'active', abilities: [noopDamage()] }] },
    numRounds: 1,
    selfBuffs: [],
    enemyDebuffs: [],
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: HP,
    healTargetId: 'attacker',
    mode: 'healing',
    ...over,
});

describe("Quixilver's real charged skill arms Shield Converter", () => {
    it('player side: the next direct hit after her charged cast is nullified into Shield', () => {
        const result = runCombat(
            base({
                teamActors: [playerHolder('quix', 'M4')],
                enemyAttackers: [enemy('e1', 'M1', { attack: DIRECT_HIT, speed: 1 })],
            })
        );
        const r1 = result.rounds[0];
        expect(r1.perActorIncoming?.['quix']?.incoming).toBeCloseTo(DIRECT_HIT, 6);
        expect(r1.perActorIncoming?.['quix']?.convertedToShield).toBeCloseTo(DIRECT_HIT, 6);
    });

    it('enemy side: an enemy Quixilver converts the player hit that follows her charged cast', () => {
        const result = runCombat(
            base({
                attack: DIRECT_HIT,
                shipSkills: { slots: [{ slot: 'active', abilities: [basicAttack()] }] },
                enemyAttackers: [
                    enemy('quix', 'M4', {
                        attack: 0,
                        speed: 1000,
                        chargeCount: 99,
                        startCharged: true,
                        shipSkills: { slots: holderSkills() },
                    }),
                ],
            })
        );
        const r1 = result.rounds[0];
        expect(r1.perActorIncoming?.['quix']?.incoming).toBeCloseTo(DIRECT_HIT, 6);
        expect(r1.perActorIncoming?.['quix']?.convertedToShield).toBeCloseTo(DIRECT_HIT, 6);
    });
});

describe('corpus tripwire: a firing-slot one-shot persistent grant never lands in the aura store', () => {
    it('classifies every such grant into a store the one-shot readers can spend', () => {
        const seen: string[] = [];
        for (const rec of loadShipSkillRecords()) {
            const ship = buildTraceShip(rec.name);
            if (!ship) continue;
            for (const slot of buildShipAbilities(ship).slots) {
                if (slot.slot !== 'active' && slot.slot !== 'charged') continue;
                for (const ab of slot.abilities) {
                    if (ab.config.type !== 'buff' && ab.config.type !== 'debuff') continue;
                    if (!ONE_SHOT_PERSISTENT_BUFFS.has(ab.config.buffName)) continue;
                    seen.push(`${rec.name}:${ab.config.buffName}`);
                    expect(
                        classifyCastStatus(slot.slot, ab.config).kind,
                        `${rec.name} ${slot.slot} ${ab.config.buffName}`
                    ).not.toBe('aura');
                }
            }
        }
        // Non-vacuity: the census must actually meet Quixilver's grant.
        expect(seen).toContain(`Quixilver:${SHIELD_CONVERTER}`);
    });
});
