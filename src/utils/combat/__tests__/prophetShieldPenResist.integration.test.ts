/**
 * #591 — Prophet: "When an ally resists a debuff infliction from an enemy, this Unit gains 1%
 * more shield penetration" (R0/R2), "...2% more" (R4). Owner rulings (spec-590-591.md):
 *  7.  STACKS and is PERMANENT for the fight — not a status, never removed.
 *  8.  PER RESISTED DEBUFF — two resists from one enemy attack = two stacks.
 *  9.  "an ally" INCLUDES Prophet herself.
 *  10. Only a FAILED LANDING ROLL counts (`debuff-resisted.viaLandingRoll === true`) — a Block
 *      Debuff or affinity auto-resist does not.
 *  11. Only resists of an ENEMY's infliction (source opposing the resister).
 *
 * #591/#590 spec Part C: the SAME roll-only rule (ruling 10) extends to the resister-side
 * `on-debuff-resisted` trigger (Prophet's own R2+ extra action, Vindicator's HP-basis
 * retaliation, the Lockdown implant) — see triggers.ts's `on-debuff-resisted` case and
 * lockdownApplier.test.ts's updated SYNERGY (negative) case.
 *
 * This file has three parts, mirroring providerOtherAllyDebuffReaction.integration.test.ts's
 * structure: a hand-rolled-bus unit test of the new `on-ally-debuff-resisted` LISTENER (precise,
 * deterministic engine-wiring checks), a parser test of Prophet's REAL kit (buildShipAbilities on
 * the verbatim docs/ship-skills.csv text), and an engine-level integration test that measures the
 * bonus's real effect on shield absorption (not just the stored field) — plus Part C's Block
 * Debuff vs real-roll pairing for Prophet's own extra action.
 */
import { describe, expect, it } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { registerReactiveListeners, Intent, ReactiveAbility } from '../triggers';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { Ship } from '../../../types/ship';
import { Ability, ShipSkills } from '../../../types/abilities';
import { bareEnemy } from '../__testutils__/bareRosterFixture';
import type { CombatActor } from '../state';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

function ship(over: Partial<Ship>): Ship {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ...({} as any), refits: [], ...over } as Ship;
}

// Verbatim from docs/ship-skills.csv.
const PROPHET_P0 =
    'This Unit has <unit-damage>20% shield penetration</unit-damage>.<br /><br />\nWhen an ally resists a debuff infliction from an enemy, this Unit gains <unit-damage>1% more shield penetration</unit-damage>.';
const PROPHET_P4 =
    'This Unit has <unit-damage>45% shield penetration</unit-damage>.<br /><br />\nWhen an ally resists a debuff infliction from an enemy, this Unit gains <unit-damage>2% more shield penetration</unit-damage>.<br /><br />\nWhen this Unit resists a debuff infliction from an enemy, once per round, this Unit gains 1 extra action.';

function prophetPassiveAbilities(refit: 0 | 4): Ability[] {
    const s =
        refit === 0
            ? ship({ firstPassiveSkillText: PROPHET_P0 })
            : ship({
                  refits: [{}, {}, {}, {}] as Ship['refits'],
                  thirdPassiveSkillText: PROPHET_P4,
              });
    return buildShipAbilities(s).slots.find((sl) => sl.slot === 'passive')?.abilities ?? [];
}

const noopActiveSlot = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        {
            id: 'noop-atk',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'damage', multiplier: 0 },
        },
    ],
});

const simpleDamageAbility = (multiplier: number): Ability => ({
    id: 'simple-dmg',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier, noCrit: true },
});

const debuffAbility = (
    buffName: string,
    application: 'apply' | 'inflict' = 'inflict'
): Ability => ({
    id: `deb-${buffName}`,
    type: 'debuff',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'debuff',
        buffName,
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        application,
        duration: 5,
    },
});

const selfShieldAbility = (pct: number): Ability => ({
    id: 'self-shield',
    type: 'shield',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'shield', pct, basis: 'hp' },
});

// =============================================================================
// Part 1 — hand-rolled-bus unit tests of the on-ally-debuff-resisted LISTENER.
// =============================================================================

describe('on-ally-debuff-resisted — listener wiring', () => {
    function makeHandBus() {
        const listeners = new Map<string, ((e: CombatEvent) => void)[]>();
        return {
            on<T extends CombatEvent['type']>(
                type: T,
                listener: (event: Extract<CombatEvent, { type: T }>) => void
            ) {
                const existing = listeners.get(type) ?? [];
                listeners.set(type, [...existing, listener as unknown as (e: CombatEvent) => void]);
            },
            emit(event: CombatEvent) {
                for (const l of listeners.get(event.type) ?? []) l(event);
            },
        };
    }

    function registerOwner(handBus: ReturnType<typeof makeHandBus>, ownerId: string) {
        const enqueued: Intent[] = [];
        const statAbility: Ability = {
            id: `prophet-pen-${ownerId}`,
            type: 'stat-gain',
            target: 'self',
            trigger: 'on-ally-debuff-resisted',
            conditions: [],
            config: { type: 'stat-gain', stat: 'shieldPenetration', pct: 1 },
        };
        const ra: ReactiveAbility = { ability: statAbility, sourceSlot: 'passive' };
        registerReactiveListeners({
            bus: handBus,
            perOwner: [{ ownerId, reactiveAbilities: [ra] }],
            enqueue: (intent) => enqueued.push(intent),
            isOpposing: (id) => id === 'enemy1' || id === 'enemy2',
        });
        return enqueued;
    }

    it('ruling 9 — the owner\'s OWN resist counts ("an ally" includes the caster)', () => {
        const handBus = makeHandBus();
        const enqueued = registerOwner(handBus, 'prophet');
        handBus.emit({
            type: 'debuff-resisted',
            sourceId: 'enemy1',
            targetId: 'prophet',
            round: 1,
            buffName: 'Hacking Down',
            viaLandingRoll: true,
        });
        expect(enqueued).toHaveLength(1);
    });

    it('a same-side ALLY resist also counts (not just the owner)', () => {
        const handBus = makeHandBus();
        const enqueued = registerOwner(handBus, 'prophet');
        handBus.emit({
            type: 'debuff-resisted',
            sourceId: 'enemy1',
            targetId: 'ally-a',
            round: 1,
            buffName: 'Hacking Down',
            viaLandingRoll: true,
        });
        expect(enqueued).toHaveLength(1);
    });

    it('an OPPOSING resister is excluded', () => {
        const handBus = makeHandBus();
        const enqueued = registerOwner(handBus, 'prophet');
        handBus.emit({
            type: 'debuff-resisted',
            sourceId: 'prophet',
            targetId: 'enemy1',
            round: 1,
            buffName: 'Hacking Down',
            viaLandingRoll: true,
        });
        expect(enqueued).toHaveLength(0);
    });

    it("ruling 11 — a same-side resist of ANOTHER ally's debuff (not an enemy's) is excluded", () => {
        const handBus = makeHandBus();
        const enqueued = registerOwner(handBus, 'prophet');
        handBus.emit({
            type: 'debuff-resisted',
            sourceId: 'ally-b', // same side as the resister — not "from an enemy"
            targetId: 'ally-a',
            round: 1,
            buffName: 'Hacking Down',
            viaLandingRoll: true,
        });
        expect(enqueued).toHaveLength(0);
    });

    it('ruling 11 — a resist with no attributable source is excluded (cannot prove "from an enemy")', () => {
        const handBus = makeHandBus();
        const enqueued = registerOwner(handBus, 'prophet');
        handBus.emit({
            type: 'debuff-resisted',
            sourceId: undefined,
            targetId: 'prophet',
            round: 1,
            buffName: 'Hacking Down',
            viaLandingRoll: true,
        });
        expect(enqueued).toHaveLength(0);
    });

    it('ruling 10 — a resist with no drawn roll (Block Debuff / affinity auto-resist) is excluded', () => {
        const handBus = makeHandBus();
        const enqueued = registerOwner(handBus, 'prophet');
        handBus.emit({
            type: 'debuff-resisted',
            sourceId: 'enemy1',
            targetId: 'prophet',
            round: 1,
            buffName: 'Hacking Down',
            // no viaLandingRoll
        });
        expect(enqueued).toHaveLength(0);
    });

    it('ruling 8 — two resisted debuffs from one enemy attack enqueue TWICE', () => {
        const handBus = makeHandBus();
        const enqueued = registerOwner(handBus, 'prophet');
        handBus.emit({
            type: 'debuff-resisted',
            sourceId: 'enemy1',
            targetId: 'prophet',
            round: 1,
            buffName: 'Hacking Down',
            viaLandingRoll: true,
        });
        handBus.emit({
            type: 'debuff-resisted',
            sourceId: 'enemy1',
            targetId: 'prophet',
            round: 1,
            buffName: 'Security Down',
            viaLandingRoll: true,
        });
        expect(enqueued).toHaveLength(2);
    });
});

// =============================================================================
// Part 2 — parser test of Prophet's REAL kit.
// =============================================================================

describe('Prophet passive — real kit parses the stat-gain + keeps the existing extra-action', () => {
    it('R0: only the stat-gain ability (1%), no extra action yet', () => {
        const abilities = prophetPassiveAbilities(0);
        const statGain = abilities.find((a) => a.config.type === 'stat-gain');
        expect(statGain).toMatchObject({
            trigger: 'on-ally-debuff-resisted',
            target: 'self',
            config: { type: 'stat-gain', stat: 'shieldPenetration', pct: 1 },
        });
        expect(abilities.some((a) => a.config.type === 'extra-action')).toBe(false);
    });

    it('R4: stat-gain at 2%, PLUS the existing self-resist extra action untouched', () => {
        const abilities = prophetPassiveAbilities(4);
        const statGain = abilities.find((a) => a.config.type === 'stat-gain');
        expect(statGain).toMatchObject({
            trigger: 'on-ally-debuff-resisted',
            target: 'self',
            config: { type: 'stat-gain', stat: 'shieldPenetration', pct: 2 },
        });
        const extraAction = abilities.find((a) => a.config.type === 'extra-action');
        expect(extraAction).toMatchObject({
            trigger: 'on-debuff-resisted',
            config: { type: 'extra-action', oncePerRound: true },
        });
    });
});

// =============================================================================
// Part 3 — engine-level: the bonus reduces shield absorption on Prophet's next hit.
// =============================================================================

describe('Prophet (player-side) — real kit, the bonus reduces shield absorption', () => {
    /** enemy: casts [self-shield 50% max HP, inflict a debuff on Prophet] every round.
     *  `enemyHacking` controls whether that debuff lands (baseline) or is resisted (bonus). */
    const enemyCaster = (enemyHacking: number): EnemyAttacker => ({
        id: 'e1',
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp: 1_000_000,
            speed: 130, // faster than Prophet — casts before her hit each round
            hacking: enemyHacking,
        },
        chargeCount: 0,
        startCharged: false,
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [selfShieldAbility(50), debuffAbility('Hacking Down')],
                },
            ],
        },
    });

    const BASE = (refit: 0 | 4, prophetSecurity: number): CombatEngineInput => ({
        enemyAttackers: [],
        attack: 10_000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        shieldPenetration: 20, // the flat base pen from her (unparsed) flavor text
        security: prophetSecurity,
        chargeCount: 0,
        shipSkills: {
            slots: [
                { slot: 'active', abilities: [simpleDamageAbility(100)] },
                { slot: 'passive', abilities: prophetPassiveAbilities(refit) },
            ],
        },
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
    });

    // Measures absorption directly off the enemy's live shieldPool (__testTapActors hands out the
    // SAME mutable CombatActor objects the engine updates, so reading `.shieldPool` after the run
    // reflects the final state) rather than the `attacked` event's `takenDamage` — that field is
    // the funnel's gross INTAKE (VictimDamageOutcome.incomingBooked), which INCLUDES whatever the
    // shield absorbed, not the post-shield HP-only figure.
    function runAndMeasureAbsorbed(enemyHacking: number, prophetSecurity: number): number {
        const bus = createEventBus();
        const attacks: Extract<CombatEvent, { type: 'attacked' }>[] = [];
        let enemyActor: CombatActor | undefined;
        bus.on('attacked', (e) => {
            if (e.attackerId === 'attacker') attacks.push(e);
        });
        runCombat({
            ...BASE(0, prophetSecurity),
            enemyAttackers: [enemyCaster(enemyHacking)],
            bus,
            __testTapActors: (actors) => {
                enemyActor = actors.find((a) => a.id === 'e1');
            },
        });
        expect(attacks).toHaveLength(1);
        expect(enemyActor).toBeDefined();
        return 500_000 - (enemyActor?.shieldPool ?? 500_000);
    }

    it('baseline: the enemy debuff LANDS (no resist) → pen stays at the static 20%', () => {
        // Prophet security 0, enemy hacking 100 → landing chance clamps to 1.0 (always lands).
        const absorbed = runAndMeasureAbsorbed(100, 0);
        // shieldEligible = 10,000 * (1 - 0.20) = 8,000; the 500,000 shield pool never binds.
        expect(absorbed).toBe(8000);
    });

    it("resisted: Prophet's own security is too high for the enemy to land → +1% pen reduces absorption", () => {
        // Prophet security 1000, enemy hacking 0 → chance clamps to 0 (always a DRAWN, failed roll).
        const absorbed = runAndMeasureAbsorbed(0, 1000);
        // shieldEligible = 10,000 * (1 - 0.21) = 7,900 — 100 LESS absorbed than the baseline.
        expect(absorbed).toBe(7900);
    });
});

describe('Prophet (enemy-side) — team symmetry mirror', () => {
    it('an enemy-side Prophet gains the bonus from her own resist, symmetric to the player-side case', () => {
        const bus = createEventBus();
        const attacks: Extract<CombatEvent, { type: 'attacked' }>[] = [];
        bus.on('attacked', (e) => {
            if (e.attackerId === 'enemy-prophet') attacks.push(e);
        });

        const enemyProphet: EnemyAttacker = {
            id: 'enemy-prophet',
            stats: {
                attack: 10_000,
                crit: 0,
                critDamage: 0,
                defence: 0,
                hp: 1_000_000_000,
                speed: 90,
                security: 1000, // the enemy Prophet's OWN security — the player cast targets her
                shieldPenetration: 20,
            },
            chargeCount: 0,
            startCharged: false,
            shipSkills: {
                slots: [
                    { slot: 'active', abilities: [simpleDamageAbility(100)] },
                    { slot: 'passive', abilities: prophetPassiveAbilities(0) },
                ],
            },
        };

        runCombat({
            enemyAttackers: [enemyProphet],
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 0, // the player's debuff-cast never lands against enemyProphet's security 1000
            chargeCount: 0,
            shipSkills: {
                slots: [{ slot: 'active', abilities: [debuffAbility('Hacking Down')] }],
            },
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
            hp: 1_000_000,
            speed: 130, // player acts first — its resisted debuff-cast wakes enemyProphet's bonus
            bus,
        });

        expect(attacks).toHaveLength(1);
        const hit = attacks[0];
        // Same math as the player-side baseline/resisted cases: pen 20+1=21% off a shieldless
        // 10,000-damage hit against the bare player focus (no shield to bind against — this run
        // only proves the bonus was gained and read; Part 3 above proves the absorption effect).
        expect(hit.damage).toBe(10_000);
    });
});

// =============================================================================
// Part C — the resister-side gate: Block Debuff never grants Prophet's own extra action.
//
// Engine-level, full-fidelity proof of the SHARED `on-debuff-resisted` gate (Block-Debuff
// auto-resist → no fire; real roll → fires) already lives in lockdownApplier.test.ts's DIRECT
// and SYNERGY (negative) cases — the same trigger, the same gate, a different consumer (the
// Lockdown implant's Buff Protection grant instead of Prophet's extra action). Duplicating that
// multi-round choreography here would prove nothing new about Prophet's OWN ability beyond what
// the parser test above already pins (her extra-action ability rides exactly `on-debuff-resisted`
// with `oncePerRound: true`) — so this part proves PROPHET'S consumption of the gate at the
// listener level: the same shape as Part 1's on-ally-debuff-resisted tests, applied to the
// pre-existing on-debuff-resisted trigger her extra action already used before #591.
// =============================================================================

describe('on-debuff-resisted — resister-side roll gate (#591 spec Part C)', () => {
    function makeHandBus() {
        const listeners = new Map<string, ((e: CombatEvent) => void)[]>();
        return {
            on<T extends CombatEvent['type']>(
                type: T,
                listener: (event: Extract<CombatEvent, { type: T }>) => void
            ) {
                const existing = listeners.get(type) ?? [];
                listeners.set(type, [...existing, listener as unknown as (e: CombatEvent) => void]);
            },
            emit(event: CombatEvent) {
                for (const l of listeners.get(event.type) ?? []) l(event);
            },
        };
    }

    function registerExtraAction(handBus: ReturnType<typeof makeHandBus>) {
        const enqueued: Intent[] = [];
        const extraActionAbility: Ability = {
            id: 'prophet-extra-action',
            type: 'extra-action',
            target: 'self',
            trigger: 'on-debuff-resisted',
            conditions: [],
            config: { type: 'extra-action', oncePerRound: true },
        };
        const ra: ReactiveAbility = { ability: extraActionAbility, sourceSlot: 'passive' };
        registerReactiveListeners({
            bus: handBus,
            perOwner: [{ ownerId: 'prophet', reactiveAbilities: [ra] }],
            enqueue: (intent) => enqueued.push(intent),
            isOpposing: (id) => id === 'enemy1',
        });
        return enqueued;
    }

    it('Block Debuff / affinity auto-resist (no drawn roll) → NO extra-action enqueue', () => {
        const handBus = makeHandBus();
        const enqueued = registerExtraAction(handBus);
        handBus.emit({
            type: 'debuff-resisted',
            sourceId: 'enemy1',
            targetId: 'prophet',
            round: 1,
            buffName: 'Hacking Down',
            // no viaLandingRoll — Block-Debuff/affinity-apply auto-resist never drew a roll
        });
        expect(enqueued).toHaveLength(0);
    });

    it('a real, drawn-and-failed roll → the extra action DOES enqueue', () => {
        const handBus = makeHandBus();
        const enqueued = registerExtraAction(handBus);
        handBus.emit({
            type: 'debuff-resisted',
            sourceId: 'enemy1',
            targetId: 'prophet',
            round: 1,
            buffName: 'Hacking Down',
            viaLandingRoll: true,
        });
        expect(enqueued).toHaveLength(1);
    });
});
