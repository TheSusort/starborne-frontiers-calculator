/**
 * Task 5: buildEnemyPlayerActorRuntime — enemy PlayerActorRuntime construction.
 *
 * Verifies that an enemy attacker gets a full PlayerActorRuntime (partitioned skills,
 * own gate instances, neutral affinity placeholder, correct side/kind, real stats).
 */
import { describe, it, expect } from 'vitest';
import { buildEnemyPlayerActorRuntime } from '../engine';
import { createStatusEngine } from '../statusEngine';
import { Ability, ShipSkills } from '../../../types/abilities';
import { SelectedGameBuff } from '../../../types/calculator';

let idCounter = 0;
const ab = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `er${++idCounter}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...partial,
});

const makeStatusEngine = () =>
    createStatusEngine({
        selfBuffs: [],
        enemyDebuffs: [],
        landsTimedEnemyApplication: () => true,
    });

const emptyDebuffLookup = (): Map<string, SelectedGameBuff[]> => new Map();

describe('buildEnemyPlayerActorRuntime', () => {
    // ── Basic: manual enemy (no shipSkills) ───────────────────────────────────
    it('manual enemy: populates all PlayerActorRuntime fields with own gates + neutral affinity', () => {
        idCounter = 0;
        const statusEngine = makeStatusEngine();
        const runtime = buildEnemyPlayerActorRuntime(
            {
                id: 'atk1',
                stats: {
                    attack: 4000,
                    crit: 30,
                    critDamage: 100,
                    speed: 50,
                    defence: 3000,
                    hp: 50000,
                },
                chargeCount: 0,
                startCharged: false,
            },
            { statusEngine, playerIds: ['attacker'], enemyDebuffLookup: emptyDebuffLookup() }
        );

        // actor side/kind
        expect(runtime.actor.side).toBe('enemy');
        expect(runtime.actor.kind).toBe('enemy');
        expect(runtime.actor.id).toBe('atk1');

        // focus is always false for enemy actors
        expect(runtime.focus).toBe(false);

        // stats match input (real defence/hp, not forced to 0 like EnemyAttackerRuntime)
        expect(runtime.attack).toBe(4000);
        expect(runtime.crit).toBe(30);
        expect(runtime.critDamage).toBe(100);
        expect(runtime.defence).toBe(3000); // real defence from input
        expect(runtime.hp).toBe(50000); // real hp from input

        // neutral affinity placeholder (Task 9 wires real matchup)
        expect(runtime.affinityDamageModifier).toBe(0);
        expect(runtime.affinityCritCap).toBe(100);
        expect(runtime.affinityCritPenalty).toBe(0);
        expect(runtime.affinityDisadvantage).toBe(false);

        // empty lookups (walked-style — payloads carry effects)
        expect(runtime.selfBuffLookup.size).toBe(0);

        // castSkills and reactiveAbilities present (empty for manual enemy)
        expect(runtime.castSkills).toBeDefined();
        expect(runtime.reactiveAbilities).toBeDefined();
        expect(Array.isArray(runtime.reactiveAbilities)).toBe(true);

        // own gate instances are functions
        expect(typeof runtime.activeCritGate).toBe('function');
        expect(typeof runtime.chargedCritGate).toBe('function');
        expect(typeof runtime.activeHealCritGate).toBe('function');
        expect(typeof runtime.chargedHealCritGate).toBe('function');
        expect(typeof runtime.debuffLandingGate).toBe('function');
        expect(typeof runtime.extendChanceGate).toBe('function');
        expect(typeof runtime.landsTimedEnemyApplication).toBe('function');
    });

    // ── Gate isolation: each enemy gets DISTINCT gate instances ───────────────
    it('two enemies get distinct gate instances (own deterministic streams)', () => {
        idCounter = 0;
        const statusEngine = makeStatusEngine();
        const ctx = {
            statusEngine,
            playerIds: ['attacker'],
            enemyDebuffLookup: emptyDebuffLookup(),
        };

        const r1 = buildEnemyPlayerActorRuntime(
            {
                id: 'e1',
                stats: { attack: 1000, crit: 50, critDamage: 100, speed: 50 },
                chargeCount: 0,
                startCharged: false,
            },
            ctx
        );
        const r2 = buildEnemyPlayerActorRuntime(
            {
                id: 'e2',
                stats: { attack: 2000, crit: 50, critDamage: 100, speed: 40 },
                chargeCount: 0,
                startCharged: false,
            },
            ctx
        );

        // All six gate types are DIFFERENT objects between the two runtimes
        expect(r1.activeCritGate).not.toBe(r2.activeCritGate);
        expect(r1.chargedCritGate).not.toBe(r2.chargedCritGate);
        expect(r1.activeHealCritGate).not.toBe(r2.activeHealCritGate);
        expect(r1.chargedHealCritGate).not.toBe(r2.chargedHealCritGate);
        expect(r1.debuffLandingGate).not.toBe(r2.debuffLandingGate);
        expect(r1.extendChanceGate).not.toBe(r2.extendChanceGate);
    });

    // ── Walk enemy: reactive abilities partitioned out ────────────────────────
    it('walk enemy: reactive abilities partitioned out of castSkills', () => {
        idCounter = 0;
        // A shipSkills with one on-cast damage ability and one reactive (on-crit) buff
        const onCritBuff = ab({
            type: 'buff',
            trigger: 'on-crit',
            target: 'self',
            config: {
                type: 'buff',
                buffName: 'Speed Up',
                parsedEffects: {},
                stacks: 1,
                isStackable: false,
                duration: 2,
            },
        });
        const damageAbility = ab({
            type: 'damage',
            config: { type: 'damage', multiplier: 120 },
        });
        const shipSkills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [damageAbility, onCritBuff],
                },
            ],
        };
        const statusEngine = makeStatusEngine();
        const runtime = buildEnemyPlayerActorRuntime(
            {
                id: 'walk-enemy',
                stats: { attack: 5000, crit: 30, critDamage: 100, speed: 60 },
                chargeCount: 2,
                startCharged: false,
                shipSkills,
            },
            { statusEngine, playerIds: ['attacker'], enemyDebuffLookup: emptyDebuffLookup() }
        );

        // The reactive buff was partitioned OUT of castSkills
        const castAbilities = runtime.castSkills.slots.flatMap((s) => s.abilities);
        expect(castAbilities).toHaveLength(1);
        expect(castAbilities[0].id).toBe(damageAbility.id);

        // The reactive buff ended up in reactiveAbilities
        expect(runtime.reactiveAbilities).toHaveLength(1);
        expect(runtime.reactiveAbilities[0].ability.id).toBe(onCritBuff.id);
    });

    // ── enemyDebuffLookup is forwarded to the runtime ─────────────────────────
    it('enemyDebuffLookup from context is threaded into the runtime', () => {
        idCounter = 0;
        const statusEngine = makeStatusEngine();
        const lookup = new Map<string, SelectedGameBuff[]>([
            [
                'Defense Shred',
                [
                    {
                        id: 'ds1',
                        buffName: 'Defense Shred',
                        stacks: 1,
                        isStackable: true,
                        parsedEffects: { defense: -10 },
                    },
                ],
            ],
        ]);
        const runtime = buildEnemyPlayerActorRuntime(
            {
                id: 'atk-x',
                stats: { attack: 1000, crit: 0, critDamage: 0, speed: 50 },
                chargeCount: 0,
                startCharged: false,
            },
            { statusEngine, playerIds: ['attacker'], enemyDebuffLookup: lookup }
        );
        expect(runtime.enemyDebuffLookup).toBe(lookup);
    });
});
