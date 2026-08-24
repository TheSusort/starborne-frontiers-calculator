/**
 * wave7LingsheStealthScope.integration.test.ts — Ship-kit Wave 7 (Lingshe).
 *
 * Lingshe R4 passive: "When this Unit detonates a Bomb it gains Stealth for 2 turn." This shared
 * the `on-bomb-detonated` trigger with Demolisher's VICTIM-scoped "when a Bomb explodes on an
 * enemy", and the listener had NO detonator filter — so Lingshe gained Stealth from ANY bomb
 * bursting on an enemy (a natural countdown-0 expiry, another ship's detonation, anything).
 *
 * The fix:
 *   - parser: "detonates a bomb" → new DETONATOR-scoped `on-self-bomb-detonated` trigger.
 *   - event: `bomb-detonated` carries `detonatorId` — the actor who ACTIVELY caused the burst
 *     (the detonate()/countdown-reduce caster), UNDEFINED for a natural countdown-0 expiry.
 *   - listener: on-self-bomb-detonated fires only when `detonatorId === ownerId`.
 *
 * So Lingshe gains Stealth ONLY when she herself forces a detonation — never from a bomb that
 * merely expires (or that another ship detonates). Drives the REAL engine via runCombat, mirroring
 * bombCountdownReduce.test.ts's regression harness (positioned victim, security 0 → unconditional
 * landing, `__testTapActors` to seed pending bombs).
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { PendingBomb } from '../state';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { Ship } from '../../../types/ship';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';

// Verbatim from docs/ship-skills.csv (Lingshe third_passive_skill_text — the R4 variant).
const LINGSHE_PASSIVE_R4 =
    'When this Unit detonates a <unit-skill>Bomb</unit-skill> it gains <unit-skill>Stealth</unit-skill> for 2 turn.<br /><br />\n\nThis Unit deals 1% more detonation damage per 10% crit power it has.';

const lingsheShip = (): Ship =>
    ({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({} as any),
        refits: [{}, {}, {}, {}], // R4 — third passive applies
        thirdPassiveSkillText: LINGSHE_PASSIVE_R4,
    }) as Ship;

// Lingshe's REAL production-parsed passive slot (the on-self-bomb-detonated Stealth grant).
const lingshePassiveSlot = (): ShipSkills['slots'][number] => {
    const passive = buildShipAbilities(lingsheShip()).slots.find((s) => s.slot === 'passive');
    if (!passive) throw new Error('Lingshe passive slot missing');
    return passive;
};

// A minimal bomb-countdown-reduce active (the forced-detonation driver). Slot is irrelevant to the
// detonator identity — reduceEnemyBombs stamps detonatorId = the acting caster regardless of slot.
const reduceActive = (): Ability => ({
    id: 'lingshe-reduce',
    type: 'bomb-countdown-reduce',
    target: 'all-enemies',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'bomb-countdown-reduce', turns: 1 },
});

// A no-op active (0% damage) — used for the "natural expiry" case where Lingshe does NOTHING that
// could detonate a bomb herself.
const noopActive = (): Ability => ({
    id: 'lingshe-noop',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 0 },
});

const lingsheSkills = (active: Ability): ShipSkills => ({
    slots: [{ slot: 'active', abilities: [active] }, lingshePassiveSlot()],
});

const parsedFrontTarget = (): ParsedTarget => ({ raw: 'front', side: 'enemy', selection: 'front' });
const singleTargetPattern = (): ParsedPattern => ({
    raw: 'base',
    shape: 'base',
    range: 0,
    modifiers: {},
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

const victimAt = (id: string, hp: number): EnemyAttacker => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp, speed: 1, security: 0 },
    chargeCount: 0,
    startCharged: false,
    position: 'M4',
    shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
});

const bomb = (countdown: number, sourceId: string): PendingBomb => ({
    countdown,
    damagePerStack: 1000,
    stacks: 1,
    tier: 100,
    sourceId,
    affinityMult: 1,
    detonationDamageModifier: 0,
    splashModifier: 0,
});

const BASE = (over: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    enemyAttackers: [],
    attack: 100,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: lingsheSkills(noopActive()),
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
    hacking: 200,
    healTargetId: 'attacker',
    mode: 'healing',
    position: 'M4',
    target: parsedFrontTarget(),
    pattern: singleTargetPattern(),
    ...over,
});

const run = (input: CombatEngineInput) => {
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    bus.on('bomb-detonated', (e) => events.push(e as CombatEvent));
    bus.on('buff-applied', (e) => events.push(e as CombatEvent));
    const result = runCombat({ ...input, bus });
    return { events, result };
};

const stealthGrants = (events: CombatEvent[], ownerId: string): number =>
    events.filter(
        (e) => e.type === 'buff-applied' && e.actorId === ownerId && e.buffName === 'Stealth'
    ).length;

describe('Lingshe Stealth-on-detonate — DETONATOR-scoped (Ship-kit W7)', () => {
    it('does NOT gain Stealth from a bomb that naturally expires (nobody detonated it)', () => {
        const { events } = run(
            BASE({
                shipSkills: lingsheSkills(noopActive()),
                enemyAttackers: [victimAt('victim', 1_000_000)],
                // A countdown-1 bomb applied by a DIFFERENT actor — it reaches 0 on the enemy's
                // own turn and bursts via processBombs (natural expiry → detonatorId undefined).
                __testTapActors: (actors) => {
                    actors
                        .find((a) => a.id === 'victim')
                        ?.pendingBombs.push(bomb(1, 'other-applier'));
                },
            })
        );
        // The bomb DID detonate (natural expiry)...
        const det = events.filter((e) => e.type === 'bomb-detonated');
        expect(det.length).toBeGreaterThan(0);
        // ...with NO detonator (natural expiry).
        expect(det.every((e) => e.type === 'bomb-detonated' && e.detonatorId === undefined)).toBe(
            true
        );
        // ...so Lingshe gains NO Stealth (the pre-fix global listener would have granted it).
        expect(stealthGrants(events, 'attacker')).toBe(0);
    });

    it('gains Stealth when SHE forces a detonation (detonatorId = Lingshe)', () => {
        const { events } = run(
            BASE({
                shipSkills: lingsheSkills(reduceActive()),
                enemyAttackers: [victimAt('victim', 1_000_000)],
                // A countdown-1 bomb applied by ANOTHER actor — Lingshe's reduce forces it to 0
                // THIS cast (detonatorId = Lingshe even though she didn't apply it).
                __testTapActors: (actors) => {
                    actors
                        .find((a) => a.id === 'victim')
                        ?.pendingBombs.push(bomb(1, 'other-applier'));
                },
            })
        );
        const det = events.filter((e) => e.type === 'bomb-detonated');
        expect(det.length).toBeGreaterThan(0);
        // The burst is credited to the ORIGINAL applier (actorId) but the DETONATOR is Lingshe.
        expect(det.some((e) => e.type === 'bomb-detonated' && e.actorId === 'other-applier')).toBe(
            true
        );
        expect(det.every((e) => e.type === 'bomb-detonated' && e.detonatorId === 'attacker')).toBe(
            true
        );
        // Lingshe gains Stealth from HER detonation.
        expect(stealthGrants(events, 'attacker')).toBeGreaterThan(0);
    });
});

describe('Lingshe Stealth-on-detonate — team symmetry (enemy-side Lingshe)', () => {
    // An enemy-side Lingshe forcing a detonation on a PLAYER-side bomb must gain Stealth the same
    // way — detonatorId is the acting caster regardless of side.
    const enemyLingshe = (): EnemyAttacker => ({
        id: 'lingshe-enemy',
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            speed: 200,
            hp: 1_000_000,
            defence: 0,
            hacking: 200,
        },
        chargeCount: 0,
        startCharged: false,
        position: 'M4',
        shipSkills: lingsheSkills(reduceActive()),
    });

    it('an enemy-side Lingshe gains Stealth from HER own forced detonation on a player bomb', () => {
        const bus = createEventBus();
        const events: CombatEvent[] = [];
        bus.on('bomb-detonated', (e) => events.push(e as CombatEvent));
        bus.on('buff-applied', (e) => events.push(e as CombatEvent));
        runCombat({
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
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
            security: 0, // player focus takes the forced burst without resisting the reduce
            speed: 1,
            healTargetId: 'attacker',
            mode: 'healing',
            enemyAttackers: [enemyLingshe()],
            __testTapActors: (actors) => {
                // Seed a bomb on the PLAYER focus ('attacker') for the enemy Lingshe to detonate.
                actors
                    .find((a) => a.id === 'attacker')
                    ?.pendingBombs.push(bomb(1, 'player-applier'));
            },
            bus,
        });
        const det = events.filter((e) => e.type === 'bomb-detonated');
        expect(det.length).toBeGreaterThan(0);
        expect(
            det.every((e) => e.type === 'bomb-detonated' && e.detonatorId === 'lingshe-enemy')
        ).toBe(true);
        expect(stealthGrants(events, 'lingshe-enemy')).toBeGreaterThan(0);
    });
});
