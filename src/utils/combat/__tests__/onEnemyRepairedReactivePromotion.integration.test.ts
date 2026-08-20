/**
 * Phase 3 PR-F — combat-integration tests for the `on-enemy-repaired` recipient + Ruiner
 * promotions:
 *   - Ruiner (1st passive): "This Unit inflicts Bomb II for 2 turns on any enemy performing a
 *     repair, once per round per enemy" — on-enemy-repaired, REPAIRER-routed via
 *     eventCtx.counterTargetId (fed by repairerId), capped once per round PER ENEMY
 *     (oncePerRoundPerEnemy).
 *   - Amartya (1st passive): "When an enemy defender is directly repaired, this Unit inflicts
 *     1 stack of Defense Shred on that defender" — on-enemy-repaired, RECIPIENT-routed via
 *     eventCtx.repairedEnemyIds (repairedRecipientTargeted), with NO per-round cap.
 *
 * Both owner abilities are extracted through the REAL production path (`buildShipAbilities`)
 * fed verbatim skill text copied from `docs/ship-skills.csv` (parser source of truth) — never a
 * hand-built ability array. The surrounding cast (enemies/allies that merely need to perform a
 * repair to generate the triggering event) are minimal hand-built actors, following
 * `allyDebuffReactivePromotion.integration.test.ts`'s harness style.
 *
 * Non-vacuity: reverting the PR-F src changes (skillTextParser.ts / buildShipAbilities.ts /
 * triggers.ts) turns every "fires"/"routes" assertion in this file red (verified manually — see
 * the PR-F report for the exact revert/restore transcript).
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { Ship } from '../../../types/ship';
import { Ability, ShipSkills } from '../../../types/abilities';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

function ship(over: Partial<Ship>): Ship {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ...({} as any), refits: [{}, {}, {}, {}], ...over } as Ship;
}

// A no-op active (0-multiplier hit) so a focus/team actor with no offensive purpose still takes
// a valid turn each round without ending combat early or erroring.
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

/** Collect every `debuff-applied` AND `dot-applied` event from a run — the discrete infliction
 *  events, one per landed application, carrying the exact `targetId` the executor routed to.
 *  Ruiner's Bomb rides `dot-applied` (it is a real bomb DoT since 2026-07-31); Amartya's Defense
 *  Shred rides `debuff-applied`. Both are normalised to `{buffName, targetId}` so the routing
 *  assertions below read the same for either. */
function runAndCollectDebuffs(input: CombatEngineInput) {
    const bus = createEventBus();
    const debuffsApplied: { buffName: string; targetId: string }[] = [];
    bus.on('debuff-applied', (e) =>
        debuffsApplied.push({ buffName: e.buffName, targetId: e.targetId })
    );
    bus.on('dot-applied', (e: Extract<CombatEvent, { type: 'dot-applied' }>) =>
        debuffsApplied.push({ buffName: dotDisplayName(e), targetId: e.targetId })
    );
    runCombat({ ...input, bus });
    return { debuffsApplied };
}

/** "bomb"/tier 200 → "Bomb II" — the name the old `debuff-applied` event carried, so the
 *  assertions below stay written in the skill text's own vocabulary. */
function dotDisplayName(e: Extract<CombatEvent, { type: 'dot-applied' }>): string {
    const family = e.dotType.charAt(0).toUpperCase() + e.dotType.slice(1);
    const perTier: Record<string, number> = { bomb: 100, inferno: 15, corrosion: 3 };
    const step = perTier[e.dotType];
    if (step === undefined || e.tier === undefined) return family;
    const numeral = ['', 'I', 'II', 'III'][Math.round(e.tier / step)] ?? '';
    return numeral ? `${family} ${numeral}` : family;
}

// A plain self-heal (10% of own max HP, unconditional — heals even at full HP since the engine
// pushes every recipient onto `healTargets` regardless of actual consumption) — the minimal
// "this actor performs a repair" trigger for on-enemy-repaired.
const selfHeal = (id: string): Ability => ({
    id,
    type: 'heal',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'heal', pct: 10, basis: 'target-hp' },
});

// A heal targeting a SINGLE other same-side actor ('ally' target) — for an enemy caster this
// resolves to the lowest-HP OTHER living enemy ally (never the caster); for a player caster this
// resolves to CombatEngineInput.healTargetId. Used to prove Amartya's Defense Shred lands on the
// RECIPIENT, distinct from the caster.
const healAlly = (id: string): Ability => ({
    id,
    type: 'heal',
    target: 'ally',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'heal', pct: 10, basis: 'target-hp' },
});

// An AoE heal ('all-allies' target) — a SINGLE cast that repairs EVERY same-side actor, emitting
// ONE heal-performed event whose `targets` lists all recipients. Used to exercise the
// repairedEnemyIds.length > 1 fan-out (one repair event → Defense Shred on each repaired
// recipient). NOTE: 'all-allies' includes the caster itself (there is no caster-excluding
// multi-recipient heal target — 'ally' is single, 'adjacent-allies' isn't resolved by the heal
// path), so the caster is legitimately one of the repaired recipients and receives Defense Shred
// too. The discriminating assertion is that the OTHER (non-caster) recipients each receive it from
// the one event — under a hypothetical repairer-only routing ONLY the caster would.
const healAllAllies = (id: string): Ability => ({
    id,
    type: 'heal',
    target: 'all-allies',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'heal', pct: 10, basis: 'target-hp' },
});

// Liberator-style once-per-round self extra-action (verified game rule: re-inserts the actor at
// its speed position; the fastest remaining actor acts again immediately). Used to make the SAME
// actor perform two repairs within a single round — the only way this per-turn engine produces
// two `heal-performed` events from one caster in one round.
const extraAction = (id: string): Ability => ({
    id,
    type: 'extra-action',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'extra-action', oncePerRound: true },
});

// =============================================================================
// Ruiner — "This Unit inflicts Bomb II for 2 turns on any enemy performing a repair, once per
// round per enemy" (docs/ship-skills.csv, verbatim).
// =============================================================================

const RUINER_P2 =
    'This Unit inflicts <unit-skill>Bomb II</unit-skill> for 2 turns on any enemy performing a <unit-aid>repair</unit-aid>, once per round per enemy.';

/** Extracts Ruiner's Bomb-on-enemy-repair DoT through the REAL parser/builder. */
function ruinerBombAbility(): Ability {
    const abilities =
        buildShipAbilities(ship({ firstPassiveSkillText: RUINER_P2 })).slots.find(
            (s) => s.slot === 'passive'
        )?.abilities ?? [];
    const bomb = abilities.find(
        (a) => a.type === 'dot' && a.config.type === 'dot' && a.config.dotType === 'bomb'
    );
    if (!bomb) throw new Error('mutation guard: Ruiner Bomb-on-enemy-repair dot not found');
    return bomb;
}

// Sanity-check the extracted ability BEFORE using it as engine input — a mutation guard so a
// regression in the parser/builder wiring fails loudly here rather than silently no-op'ing the
// engine tests below.
describe('Ruiner Bomb — extracted ability shape (mutation guard)', () => {
    it('rides on-enemy-repaired, enemy-targeted, with the once-per-round-per-enemy cap flag set', () => {
        const bomb = ruinerBombAbility();
        expect(bomb.trigger).toBe('on-enemy-repaired');
        expect(bomb.target).toBe('enemy');
        expect(bomb.oncePerRoundPerEnemy).toBe(true);
        // NOT recipient-targeted — Ruiner routes to the REPAIRER, Amartya's flag stays unset here.
        expect(bomb.repairedRecipientTargeted).toBeUndefined();
    });
});

describe('Ruiner (player-side) — Bomb routes to the REPAIRER, capped once per round PER ENEMY', () => {
    const ruinerFocusSkills = (): ShipSkills => ({
        slots: [noopActiveSlot(), { slot: 'passive', abilities: [ruinerBombAbility()] }],
    });

    // enemy-x: fastest, self-heals AND grants itself one extra action → repairs TWICE this round.
    const enemyX = (): EnemyAttacker =>
        ({
            id: 'enemy-x',
            stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000, speed: 1000 },
            chargeCount: 0,
            startCharged: false,
            shipSkills: {
                slots: [
                    { slot: 'active', abilities: [selfHeal('x-heal')] },
                    { slot: 'passive', abilities: [extraAction('x-extra')] },
                ],
            },
        }) as EnemyAttacker;

    // enemy-y: no extra action → repairs ONCE this round. A DIFFERENT repairer from enemy-x.
    const enemyY = (): EnemyAttacker =>
        ({
            id: 'enemy-y',
            stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000, speed: 500 },
            chargeCount: 0,
            startCharged: false,
            shipSkills: { slots: [{ slot: 'active', abilities: [selfHeal('y-heal')] }] },
        }) as EnemyAttacker;

    const BASE = (): CombatEngineInput => ({
        attack: 0,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: ruinerFocusSkills(),
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
        // Ruiner is the SLOWEST actor here, so both enemies repair before it has ever acted —
        // which is exactly the case the bomb applier's live-effective-attack fallback covers
        // (no last-turn ctx to snapshot). Keep it that way: it is the harder path.
        speed: 1,
        healTargetId: 'attacker',
        mode: 'healing',
        enemyAttackers: [enemyX(), enemyY()],
    });

    it('enemy-x repairs TWICE this round but receives Bomb II only ONCE (per-enemy cap); enemy-y (a DIFFERENT enemy) still gets its own Bomb II', () => {
        const { debuffsApplied } = runAndCollectDebuffs(BASE());
        const bombs = debuffsApplied.filter((d) => d.buffName === 'Bomb II');
        // Routing proof: the Bomb lands on the ACTUAL repairer id, not a shared default target —
        // if routing were broken (falling back to the singular default enemy store) neither
        // enemy-x nor enemy-y would appear here at all.
        expect(bombs.filter((b) => b.targetId === 'enemy-x')).toHaveLength(1);
        expect(bombs.filter((b) => b.targetId === 'enemy-y')).toHaveLength(1);
        expect(bombs).toHaveLength(2);
    });
});

describe('Ruiner (enemy-side) — team symmetry: an enemy Ruiner reacts to a PLAYER repair', () => {
    it('Bomb lands on the repairing PLAYER actor (attacker), not a default target', () => {
        const enemyRuiner: EnemyAttacker = {
            id: 'enemy-ruiner',
            stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 10 },
            chargeCount: 0,
            startCharged: false,
            shipSkills: { slots: [{ slot: 'passive', abilities: [ruinerBombAbility()] }] },
        } as EnemyAttacker;

        const input: CombatEngineInput = {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: { slots: [{ slot: 'active', abilities: [selfHeal('atk-heal')] }] },
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
            speed: 200, // player acts first — its self-repair wakes the enemy reactive same round
            healTargetId: 'attacker',
            mode: 'healing',
            enemyAttackers: [enemyRuiner],
        };

        const { debuffsApplied } = runAndCollectDebuffs(input);
        const bombs = debuffsApplied.filter((d) => d.buffName === 'Bomb II');
        expect(bombs).toHaveLength(1);
        expect(bombs[0].targetId).toBe('attacker');
    });
});

// =============================================================================
// Amartya — "When an enemy defender is directly repaired, this Unit inflicts 1 stack of
// Defense Shred on that defender" (docs/ship-skills.csv, verbatim).
// =============================================================================

const AMARTYA_P2 =
    'When an enemy defender is directly repaired, this Unit inflicts 1 stack of <unit-skill>Defense Shred</unit-skill> on that defender.';

/** Extracts Amartya's recipient-targeted Defense Shred through the REAL parser/builder. */
function amartyaDefenseShredAbility(): Ability {
    const abilities =
        buildShipAbilities(ship({ firstPassiveSkillText: AMARTYA_P2 })).slots.find(
            (s) => s.slot === 'passive'
        )?.abilities ?? [];
    const shred = abilities.find((a) => a.type === 'debuff');
    if (!shred) throw new Error('mutation guard: Amartya Defense Shred not found');
    return shred;
}

describe('Amartya Defense Shred — extracted ability shape (mutation guard)', () => {
    it('rides on-enemy-repaired, enemy-targeted, RECIPIENT-routed, with NO per-round cap', () => {
        const shred = amartyaDefenseShredAbility();
        expect(shred.trigger).toBe('on-enemy-repaired');
        expect(shred.target).toBe('enemy');
        expect(shred.repairedRecipientTargeted).toBe(true);
        // No frequency cap — "on that defender" fires every qualifying repair.
        expect(shred.oncePerRoundPerEnemy).toBeUndefined();
        expect(shred.oncePerRound).toBeUndefined();
    });
});

describe('Amartya (player-side) — Defense Shred lands on the REPAIRED RECIPIENT, not the healer; no cap', () => {
    const amartyaFocusSkills = (): ShipSkills => ({
        slots: [noopActiveSlot(), { slot: 'passive', abilities: [amartyaDefenseShredAbility()] }],
    });

    // enemy-healer heals enemy-defender (its only OTHER living enemy ally) each of its turns.
    // `twice` grants it an extra action so it repairs enemy-defender TWICE in one round —
    // proving Amartya carries NO per-round cap (unlike Ruiner).
    const enemyHealer = (twice: boolean): EnemyAttacker =>
        ({
            id: 'enemy-healer',
            stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000, speed: 1000 },
            chargeCount: 0,
            startCharged: false,
            shipSkills: {
                slots: twice
                    ? [
                          { slot: 'active', abilities: [healAlly('heal-ally')] },
                          { slot: 'passive', abilities: [extraAction('healer-extra')] },
                      ]
                    : [{ slot: 'active', abilities: [healAlly('heal-ally')] }],
            },
        }) as EnemyAttacker;

    const enemyDefender = (): EnemyAttacker =>
        ({
            id: 'enemy-defender',
            stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000, speed: 500 },
            chargeCount: 0,
            startCharged: false,
            shipSkills: { slots: [] } as ShipSkills,
        }) as EnemyAttacker;

    const BASE = (twice: boolean): CombatEngineInput => ({
        attack: 0,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: amartyaFocusSkills(),
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
        speed: 1,
        healTargetId: 'attacker',
        mode: 'healing',
        enemyAttackers: [enemyHealer(twice), enemyDefender()],
    });

    it('lands on enemy-defender (the repaired recipient), NEVER on enemy-healer', () => {
        const { debuffsApplied } = runAndCollectDebuffs(BASE(false));
        const shred = debuffsApplied.filter((d) => d.buffName === 'Defense Shred');
        expect(shred).toHaveLength(1);
        expect(shred[0].targetId).toBe('enemy-defender');
        expect(shred.some((d) => d.targetId === 'enemy-healer')).toBe(false);
    });

    it('NO per-round cap: two repairs of the SAME recipient in one round produce TWO Defense Shred applications', () => {
        const { debuffsApplied } = runAndCollectDebuffs(BASE(true));
        const shred = debuffsApplied.filter(
            (d) => d.buffName === 'Defense Shred' && d.targetId === 'enemy-defender'
        );
        expect(shred).toHaveLength(2);
    });

    it('multi-recipient fan-out: a SINGLE AoE heal repairing 2+ defenders inflicts Defense Shred on EACH repaired defender from that one event', () => {
        // One all-allies heal cast → ONE heal-performed event with targets
        // [enemy-aoe-healer, enemy-def-1, enemy-def-2]. The repairedEnemyIds fan-out must land
        // Defense Shred on each repaired recipient — this is the core new Layer-2 behavior
        // (a single repair EVENT distributing "on that defender" across every recipient), as
        // opposed to the separate-events case above (which uses two distinct heal-performed
        // events via an extra action).
        const aoeHealer: EnemyAttacker = {
            id: 'enemy-aoe-healer',
            stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000, speed: 1000 },
            chargeCount: 0,
            startCharged: false,
            shipSkills: { slots: [{ slot: 'active', abilities: [healAllAllies('aoe-heal')] }] },
        } as EnemyAttacker;
        const def1: EnemyAttacker = {
            id: 'enemy-def-1',
            stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000, speed: 500 },
            chargeCount: 0,
            startCharged: false,
            shipSkills: { slots: [] } as ShipSkills,
        } as EnemyAttacker;
        const def2: EnemyAttacker = {
            id: 'enemy-def-2',
            stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000, speed: 400 },
            chargeCount: 0,
            startCharged: false,
            shipSkills: { slots: [] } as ShipSkills,
        } as EnemyAttacker;

        // Tap heal-performed too, to PROVE the fan-out came from a SINGLE cast (not several).
        const bus = createEventBus();
        const debuffsApplied: Extract<CombatEvent, { type: 'debuff-applied' }>[] = [];
        const healsPerformed: Extract<CombatEvent, { type: 'heal-performed' }>[] = [];
        bus.on('debuff-applied', (e) => debuffsApplied.push(e));
        bus.on('heal-performed', (e) => healsPerformed.push(e));
        runCombat({ ...BASE(false), enemyAttackers: [aoeHealer, def1, def2], bus });

        // Exactly ONE repair event this round (the single AoE cast), carrying all three recipients.
        expect(healsPerformed).toHaveLength(1);
        expect(new Set(healsPerformed[0].targets)).toEqual(
            new Set(['enemy-aoe-healer', 'enemy-def-1', 'enemy-def-2'])
        );

        const shred = debuffsApplied.filter((d) => d.buffName === 'Defense Shred');
        // Fan-out proof: BOTH non-caster defenders receive Defense Shred from the one event
        // (repairer-only routing would touch neither — it would target just the caster).
        expect(shred.filter((d) => d.targetId === 'enemy-def-1')).toHaveLength(1);
        expect(shred.filter((d) => d.targetId === 'enemy-def-2')).toHaveLength(1);
        // The caster self-repaired (all-allies includes self) → it too is a repaired defender and
        // correctly receives one. Total = one per repaired recipient in the single event.
        expect(shred.filter((d) => d.targetId === 'enemy-aoe-healer')).toHaveLength(1);
        expect(shred).toHaveLength(3);
    });
});

describe('Amartya (enemy-side) — team symmetry: an enemy Amartya reacts to a PLAYER repair-to-ally', () => {
    it('Defense Shred lands on the REPAIRED player ally (teamActor), not the healer (attacker)', () => {
        const enemyAmartya: EnemyAttacker = {
            id: 'enemy-amartya',
            stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 10 },
            chargeCount: 0,
            startCharged: false,
            shipSkills: { slots: [{ slot: 'passive', abilities: [amartyaDefenseShredAbility()] }] },
        } as EnemyAttacker;

        const recipientAlly: TeamActor = {
            id: 'ally-recipient',
            speed: 50,
            chargeCount: 0,
            startCharged: false,
            selfBuffs: [],
            enemyDebuffs: [],
            walk: {
                shipSkills: { slots: [noopActiveSlot()] },
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
        } as TeamActor;

        const input: CombatEngineInput = {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: { slots: [{ slot: 'active', abilities: [healAlly('heal-ally')] }] },
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
            speed: 200, // player acts first — its repair-to-ally wakes the enemy reactive same round
            healTargetId: 'ally-recipient',
            mode: 'healing',
            teamActors: [recipientAlly],
            enemyAttackers: [enemyAmartya],
        };

        const { debuffsApplied } = runAndCollectDebuffs(input);
        const shred = debuffsApplied.filter((d) => d.buffName === 'Defense Shred');
        expect(shred).toHaveLength(1);
        expect(shred[0].targetId).toBe('ally-recipient');
        expect(shred.some((d) => d.targetId === 'attacker')).toBe(false);
    });
});
