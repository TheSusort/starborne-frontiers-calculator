/**
 * SP-F F2 — AEGIS's `on-ally-shield-destroyed` reactive trigger (ENGINE integration).
 *
 * AEGIS's R2 refit-active 2nd passive (verbatim from docs/ship-skills.csv): "This Unit grants
 * <unit-skill>Defense Up II</unit-skill> for 1 turn and <unit-aid>cleanses all</unit-aid> debuffs
 * when an ally within the Active pattern has their Shield destroyed." Before this task both
 * halves defaulted to `trigger:'on-cast'` (an unconditioned, always-fires grant) — no
 * shield-DESTRUCTION-scoped trigger existed anywhere (the only shield trigger was
 * `on-shield-applied`, the opposite direction — fired on a GRANT, not a loss).
 *
 * Driven through the REAL pipeline: `buildShipAbilities` parses the verbatim passive text into
 * TWO `on-ally-shield-destroyed` reactive abilities (a 'buff' grant + a 'cleanse'), both
 * `target:'ally'`. `runCombat` is exercised directly (not `simulateBattle`) so the test can (a)
 * seed a deterministic pre-combat shield via the `type:'shield', trigger:'pre-combat'` ability
 * (mirrors FrontLine's corpus shape, `preCombatBattle.integration.test.ts`) and (b) read the
 * settled `StatusEngine` state after the run via `__testTapStatusEngine` (mirrors
 * `allyCritReactivePromotion.integration.test.ts`, Howler's on-ally-crit precedent for an
 * `ally`-target reactive cleanse+grant).
 *
 * Board geometry proves the "within the Active pattern" free win too: AEGIS sits at M3 with a
 * `Pattern-Line-Support-Range-1` support pattern (`footprintAllies.test.ts`: "@ M3 → {M3, M4}"),
 * and the shielded ally sits at M4 — inside AEGIS's footprint. `footprintFilteredRecipients`
 * (triggers.ts) intersects the reaction with that footprint for free; no new geometry code.
 *
 * Non-vacuity: a control run where the enemy's damaging hit does NOT fully exhaust the shield
 * (leaves it > 0) proves the reaction is gated on FULL depletion, not merely "the shielded ally
 * was hit" — the specific condition SP-F F2 wires (engine.ts's shieldBeforeThisAbsorb > 0 &&
 * shieldPool === 0 check).
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { Ship } from '../../../types/ship';
import { Ability } from '../../../types/abilities';
import { parsePattern } from '../../targetingParser';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { StatusEngine } from '../statusEngine';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

function ship(over: Partial<Ship>): Ship {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ...({} as any), refits: [{}, {}], ...over } as Ship;
}

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

const noopActive = (): Ability => ({
    id: 'noop',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 0 },
});

const hit = (): Ability => ({
    id: 'hit',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100 },
});

const applyDebuff = (): Ability => ({
    id: 'debuff',
    type: 'debuff',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'debuff',
        buffName: 'Defense Down II',
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        application: 'apply', // guaranteed landing — no hacking/security tuning needed
        duration: 5,
    },
});

/** AEGIS grants itself the pre-combat shield seed via `seedPreCombatShields` (engine.ts) — a
 *  hand-built `type:'shield', trigger:'pre-combat'` ability (the FrontLine corpus shape,
 *  `preCombatBattle.integration.test.ts`), self-target, 100% of the carrier's OWN max HP. */
const preCombatShield = (): Ability => ({
    id: 'pre-shield',
    type: 'shield',
    target: 'self',
    trigger: 'pre-combat',
    conditions: [],
    config: { type: 'shield', pct: 100, basis: 'hp' },
});

const SHIELD_TARGET_HP = 100_000;

// Verbatim from docs/ship-skills.csv (second_passive_skill_text field, the R2 refit-active row).
const AEGIS_P2 =
    'This Unit grants <unit-skill>Defense Up II</unit-skill> for 1 turn and <unit-aid>cleanses all</unit-aid> debuffs when an ally within the Active pattern has their Shield destroyed.';

/** Extracts AEGIS's on-ally-shield-destroyed reactive abilities through the REAL parser/builder. */
function aegisReactiveAbilities(): Ability[] {
    return (
        buildShipAbilities(ship({ secondPassiveSkillText: AEGIS_P2 })).slots.find(
            (s) => s.slot === 'passive'
        )?.abilities ?? []
    );
}

function aegisBuffGrant(): Ability {
    const b = aegisReactiveAbilities().find((a) => a.type === 'buff');
    if (!b) throw new Error('mutation guard: AEGIS on-ally-shield-destroyed buff grant not found');
    return b;
}

function aegisCleanse(): Ability {
    const c = aegisReactiveAbilities().find((a) => a.type === 'cleanse');
    if (!c) throw new Error('mutation guard: AEGIS on-ally-shield-destroyed cleanse not found');
    return c;
}

describe('AEGIS on-ally-shield-destroyed abilities — extracted shape (mutation guard)', () => {
    it('buff grant rides on-ally-shield-destroyed, targeting the ally', () => {
        const b = aegisBuffGrant();
        expect(b.trigger).toBe('on-ally-shield-destroyed');
        expect(b.target).toBe('ally');
        expect(b.config).toMatchObject({ type: 'buff', buffName: 'Defense Up II' });
    });

    it('cleanse rides on-ally-shield-destroyed, targeting the ally, count "all"', () => {
        const c = aegisCleanse();
        expect(c.trigger).toBe('on-ally-shield-destroyed');
        expect(c.target).toBe('ally');
        expect(c.config).toMatchObject({ type: 'cleanse', count: 'all' });
    });
});

// =============================================================================
// Engine integration — AEGIS (M3, Pattern-Line-Support-Range-1) observes an ally (M4, front,
// pre-combat-shielded) inside its footprint. An enemy Debuffer inflicts a debuff on the ally
// (0 damage), then an enemy Breaker deals damage EXACTLY matching the shield pool, fully
// depleting it in one hit. AEGIS should react: grant the ally Defense Up II and cleanse its
// (Debuffer-inflicted) debuff.
// =============================================================================

const aegisActor = (position: Position, pattern: ParsedPattern): TeamActorEngineInput =>
    ({
        id: 'aegis',
        speed: 1, // acts last — irrelevant, the reaction is event-driven, not turn-driven
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position,
        target: parsedTarget('front'),
        // AEGIS's OWN "Active pattern" — the footprint the on-ally-shield-destroyed reaction is
        // scoped to (footprintFilteredRecipients, triggers.ts). Real AEGIS corpus value is
        // Pattern-Prolonged_Cone-Support-Range-2 (docs/ship-targeting.csv); a
        // Pattern-Line-Support-Range-1 stand-in is used here for deterministic, precedented
        // geometry (footprintAllies.test.ts: "@ M3 -> {M3, M4}") — the exact shape isn't what
        // this test is proving, only that the reaction genuinely respects SOME footprint.
        pattern,
        walk: {
            shipSkills: {
                slots: [
                    { slot: 'active', abilities: [noopActive()] },
                    { slot: 'passive', abilities: aegisReactiveAbilities() },
                ],
            },
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 0,
                hp: 20_000,
            },
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
    }) as unknown as TeamActorEngineInput;

/** A same-side ally carrying a pre-combat 100%-of-maxHP shield. Its own active is a no-op — this
 *  test only cares about what the ally RECEIVES, not what it deals. */
const shieldedAlly = (opts: { withShield: boolean }): CombatEngineInput => ({
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: {
        slots: [
            { slot: 'active', abilities: [noopActive()] },
            ...(opts.withShield
                ? [{ slot: 'passive' as const, abilities: [preCombatShield()] }]
                : []),
        ],
    },
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
    hp: SHIELD_TARGET_HP,
    speed: 10,
    healTargetId: 'attacker',
    position: 'M4',
    target: parsedTarget('front'),
    pattern: basePattern(),
});

/** enemyDebuffer inflicts Defense Down II (0 damage, guaranteed landing) BEFORE enemyBreaker
 *  deals its shield-depleting hit — speed-ordered so the debuff is present when the shield
 *  destruction fires. `breakerAttack` controls whether the hit fully drains the pool. */
const enemyDebuffer = (position: Position): EnemyAttacker =>
    ({
        id: 'enemy-debuffer',
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 1000 },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills: { slots: [{ slot: 'active', abilities: [applyDebuff()] }] },
    }) as EnemyAttacker;

const enemyBreaker = (position: Position, attack: number): EnemyAttacker =>
    ({
        id: 'enemy-breaker',
        stats: { attack, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 500 },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills: { slots: [{ slot: 'active', abilities: [hit()] }] },
    }) as EnemyAttacker;

function runAndCollect(input: CombatEngineInput) {
    const bus = createEventBus();
    const buffsApplied: Extract<CombatEvent, { type: 'buff-applied' }>[] = [];
    const shieldDestroyed: Extract<CombatEvent, { type: 'shield-destroyed' }>[] = [];
    bus.on('buff-applied', (e) => buffsApplied.push(e));
    bus.on('shield-destroyed', (e) => shieldDestroyed.push(e));
    let engine: StatusEngine | undefined;
    const result = runCombat({
        ...input,
        bus,
        __testTapStatusEngine: (e) => {
            engine = e;
        },
    });
    return { result, buffsApplied, shieldDestroyed, engine: engine! };
}

/** Total 'cleanseCount' credited to `ownerId` across every healing round (Howler precedent,
 *  `allyCritReactivePromotion.integration.test.ts`) — the reactive cleanse executor
 *  (triggers.ts `cfg.type === 'cleanse'`) credits this directly; it does NOT emit a
 *  `cleanse-performed` event (that event is exclusive to the CAST-time path, playerTurn.ts). */
const cleanseCountFor = (result: ReturnType<typeof runCombat>, ownerId: string): number =>
    (result.healing?.rounds ?? []).reduce(
        (sum, rd) => sum + (rd.perActor.get(ownerId)?.cleanseCount ?? 0),
        0
    );

describe('AEGIS (player-side) — reacts when an in-footprint ally has their Shield destroyed', () => {
    const build = (breakerAttack: number) => ({
        ...shieldedAlly({ withShield: true }),
        teamActors: [aegisActor('M3', parsePattern('Pattern-Line-Support-Range-1'))],
        enemyAttackers: [enemyDebuffer('M4'), enemyBreaker('M1', breakerAttack)],
    });

    it('the shield is fully depleted by the breaker hit → shield-destroyed fires exactly once', () => {
        const { shieldDestroyed } = runAndCollect(build(SHIELD_TARGET_HP));
        expect(shieldDestroyed).toHaveLength(1);
        expect(shieldDestroyed[0].victimId).toBe('attacker');
    });

    it('AEGIS grants the ally Defense Up II for 1 turn', () => {
        const { buffsApplied } = runAndCollect(build(SHIELD_TARGET_HP));
        const grant = buffsApplied.filter(
            (b) => b.buffName === 'Defense Up II' && b.actorId === 'attacker'
        );
        expect(grant.length).toBeGreaterThan(0);
    });

    it("AEGIS cleanses the ally's Defense Down II debuff", () => {
        const { result, engine } = runAndCollect(build(SHIELD_TARGET_HP));
        // AEGIS (the caster) is credited with a real (>0) cleanse.
        expect(cleanseCountFor(result, 'aegis')).toBeGreaterThan(0);
        // The ally's debuff store is empty afterwards — the debuff was actually removed, not
        // just a phantom credit.
        expect(engine.timedAbilityStatuses('enemy', undefined, 'attacker')).toEqual([]);
    });

    it('control: a hit that only PARTIALLY drains the shield never triggers the reaction', () => {
        // Half the shield pool — the pool survives (> 0), so shield-destroyed must not fire.
        const { shieldDestroyed, buffsApplied, engine } = runAndCollect(
            build(SHIELD_TARGET_HP / 2)
        );
        expect(shieldDestroyed).toHaveLength(0);
        expect(buffsApplied.some((b) => b.buffName === 'Defense Up II')).toBe(false);
        // The debuff survives — AEGIS never cleansed it.
        expect(
            engine
                .timedAbilityStatuses('enemy', undefined, 'attacker')
                .map((s) => s.active.buffName)
        ).toEqual(['Defense Down II']);
    });

    it('control: WITHOUT a shield at all, the same breaker hit never triggers the reaction', () => {
        const noShieldInput: CombatEngineInput = {
            ...shieldedAlly({ withShield: false }),
            teamActors: [aegisActor('M3', parsePattern('Pattern-Line-Support-Range-1'))],
            enemyAttackers: [enemyDebuffer('M4'), enemyBreaker('M1', SHIELD_TARGET_HP)],
        };
        const { shieldDestroyed, buffsApplied } = runAndCollect(noShieldInput);
        expect(shieldDestroyed).toHaveLength(0);
        expect(buffsApplied.some((b) => b.buffName === 'Defense Up II')).toBe(false);
    });

    it("footprint gate: an AEGIS OUTSIDE the ally's support pattern never reacts", () => {
        // Base-Support only covers the origin cell (footprintAllies.test.ts) — anchored at M3 it
        // covers {M3} alone, EXCLUDING the ally at M4. Same scenario, otherwise identical.
        const outOfRangeInput: CombatEngineInput = {
            ...shieldedAlly({ withShield: true }),
            teamActors: [aegisActor('M3', parsePattern('Pattern-Base-Support'))],
            enemyAttackers: [enemyDebuffer('M4'), enemyBreaker('M1', SHIELD_TARGET_HP)],
        };
        const { shieldDestroyed, buffsApplied } = runAndCollect(outOfRangeInput);
        // The shield still gets destroyed (the event is unconditional)...
        expect(shieldDestroyed).toHaveLength(1);
        // ...but AEGIS's footprint excludes the ally, so the reaction never lands.
        expect(buffsApplied.some((b) => b.buffName === 'Defense Up II')).toBe(false);
    });
});

// =============================================================================
// Team symmetry — the SAME abilities, run with AEGIS + the shielded ally on the ENEMY side and
// the debuff/shield-break delivered by PLAYER-side actors. shield-destroyed is emitted from the
// SHARED applyVictimDamage (engine.ts) and registerReactiveListeners runs per-side with no module
// state, so an enemy-side AEGIS reacting is a genuine regression guard, not an assumption.
// =============================================================================

describe('AEGIS (enemy-side) — team symmetry: an enemy AEGIS reacts to its own ally', () => {
    it('the enemy ally is granted Defense Up II and cleansed when a PLAYER hit destroys its shield', () => {
        const enemyAegis: EnemyAttacker = {
            id: 'enemy-aegis',
            stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 20_000, speed: 1 },
            chargeCount: 0,
            startCharged: false,
            position: 'M3',
            target: parsedTarget('front'),
            pattern: parsePattern('Pattern-Line-Support-Range-1'),
            shipSkills: {
                slots: [
                    { slot: 'active', abilities: [noopActive()] },
                    { slot: 'passive', abilities: aegisReactiveAbilities() },
                ],
            },
        } as EnemyAttacker;

        const enemyAlly: EnemyAttacker = {
            id: 'enemy-ally',
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defence: 0,
                hp: SHIELD_TARGET_HP,
                speed: 10,
            },
            chargeCount: 0,
            startCharged: false,
            position: 'M4',
            target: parsedTarget('front'),
            pattern: basePattern(),
            shipSkills: {
                slots: [
                    { slot: 'active', abilities: [noopActive()] },
                    { slot: 'passive', abilities: [preCombatShield()] },
                ],
            },
        } as EnemyAttacker;

        // Player-side: the top-level focus inflicts the debuff (0 damage); a teamActor deals the
        // shield-depleting hit. Both target 'front' — the enemy roster's front-most living ship
        // (enemy-ally at M4, more forward than enemy-aegis at M3).
        const playerDebuffer: CombatEngineInput = {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: { slots: [{ slot: 'active', abilities: [applyDebuff()] }] },
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
            speed: 1000,
            healTargetId: 'attacker',
            position: 'M1',
            target: parsedTarget('front'),
            pattern: basePattern(),
            teamActors: [
                {
                    id: 'player-breaker',
                    speed: 500,
                    chargeCount: 0,
                    startCharged: false,
                    selfBuffs: [],
                    enemyDebuffs: [],
                    position: 'M2',
                    target: parsedTarget('front'),
                    pattern: basePattern(),
                    walk: {
                        shipSkills: { slots: [{ slot: 'active', abilities: [hit()] }] },
                        stats: {
                            attack: SHIELD_TARGET_HP,
                            crit: 0,
                            critDamage: 0,
                            defensePenetration: 0,
                            hacking: 0,
                            defence: 0,
                            hp: 20_000,
                        },
                        selfDotModifier: 0,
                        defensePenetrationBuff: 0,
                        affinityDamageModifier: 0,
                        affinityCritCap: 100,
                        affinityCritPenalty: 0,
                        hasChargedSkill: false,
                    },
                } as TeamActorEngineInput,
            ],
            enemyAttackers: [enemyAegis, enemyAlly],
        };

        const { buffsApplied, engine, shieldDestroyed } = runAndCollect(playerDebuffer);

        expect(shieldDestroyed).toHaveLength(1);
        expect(shieldDestroyed[0].victimId).toBe('enemy-ally');

        const grant = buffsApplied.filter(
            (b) => b.buffName === 'Defense Up II' && b.actorId === 'enemy-ally'
        );
        expect(grant.length).toBeGreaterThan(0);

        // The enemy ally's debuff store ('enemy' bucket = debuffs, keyed by target id regardless
        // of which physical team the target is on) is empty — AEGIS's reactive cleanse actually
        // removed it.
        expect(
            engine
                .timedAbilityStatuses('enemy', undefined, 'enemy-ally')
                .map((s) => s.active.buffName)
        ).toEqual([]);
    });
});
