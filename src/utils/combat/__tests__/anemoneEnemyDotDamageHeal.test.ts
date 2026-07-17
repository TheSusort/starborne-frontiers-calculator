/**
 * Ship-kit correctness audit, Wave 3, Task 6 — Anemone's `on-enemy-dot-damage` reactive trigger
 * (ENGINE integration).
 *
 * Anemone's second passive (verbatim from docs/ship-skills.csv, the repair clause): "When an
 * enemy takes damage from a Damage over Time effect, <unit-damage>repair 5%</unit-damage> of
 * this Unit's Max HP." Before this task this fell through to the default `trigger:'on-cast'` —
 * an unconditioned self-heal that fires on every single cast, riding whichever skill Anemone used
 * that turn, regardless of whether any DoT ever ticked (investigation appendix §D/finding #2).
 *
 * Exercised through the REAL production pipeline (`buildShipAbilities` fed verbatim skill text,
 * never a hand-built ability). Follows the `onEnemyTauntGainedReactivePromotion.integration.test.ts`
 * / `sansiEnemyRepairedHeal.test.ts` harness style: a mutation-guard shape check, then `runCombat`
 * engine tests proving the reactive fire is gated on a REAL `dot-ticked` event (not on-cast), and
 * that it fires only when the DoT tick lands on an OPPOSING actor — never when the tick lands on
 * Anemone's own side.
 *
 * The underlying `dot-ticked` bus event only fires for the per-victim tick path when the ticking
 * actor is genuinely POSITIONAL against a positioned opposing roster (`isPositional`,
 * `positionalBinding.ts`) — so every test here is a real positional multi-actor team battle
 * (mirrors `perVictimDotTick.integration.test.ts`'s harness), not the single-dummy DPS/trace mode
 * where this bug would stay invisible (investigation appendix §E).
 *
 * Anemone's heal is SELF-target, so `eventCtx.victimId` (stamped by the new `triggers.ts` case)
 * is not consumed by the executor for THIS ability (`reactiveRecipients` resolves target==='self'
 * to `[intent.ownerId]` unconditionally) — the tests here verify the TRIGGER GATING (fires only
 * on a real opposing-side DoT tick), which is the actual bug being fixed.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { Ship } from '../../../types/ship';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { ActiveDoTStack, CombatActor } from '../state';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

function ship(over: Partial<Ship>): Ship {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ...({} as any), refits: [{}, {}, {}, {}], ...over } as Ship;
}

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});

// AoE pattern: origin + one covered cell one step toward back (Pattern-Line-Range-1). Anchored at
// the FRONT actor it covers the one immediately behind it — mirrors perVictimDotTick's harness.
const lineRange1Pattern = (): ParsedPattern => ({
    raw: 'line-range-1',
    shape: 'line',
    range: 1,
    modifiers: {},
});

// A small single-hit basic attack — harmless against the huge-HP actors below, just enough to
// give the caster a valid turn (and, where relevant, a valid firing footprint) each round.
const basicAttack = (): Ability => ({
    id: 'anemone-basic-atk',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100 },
});

const basicSlot = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [basicAttack()],
});

// Verbatim Anemone 2nd-passive text (docs/ship-skills.csv) — both sentences, so the parser sees
// the SAME multi-sentence context production code sees (the first sentence shares the "Damage
// over Time effect" tail but not the "when an enemy takes damage from" phrase — the sentence-
// scoped detector must not co-trigger on it).
const ANEMONE_P2 =
    "This Unit takes 25% less direct damage from enemies debuffed with a Damage over Time effect.<br /><br />When an enemy takes damage from a Damage over Time effect, <unit-damage>repair 5%</unit-damage> of this Unit's Max HP.";

/** Extracts Anemone's on-enemy-dot-damage self-heal through the REAL parser/builder. */
function anemoneHealAbility(): Ability {
    const abilities =
        buildShipAbilities(ship({ secondPassiveSkillText: ANEMONE_P2 })).slots.find(
            (s) => s.slot === 'passive'
        )?.abilities ?? [];
    const heal = abilities.find((a) => a.type === 'heal' && a.target === 'self');
    if (!heal) throw new Error('mutation guard: Anemone on-enemy-dot-damage self-heal not found');
    return heal;
}

// Sanity-check the extracted ability BEFORE using it as engine input — a mutation guard so a
// regression in the parser/builder wiring fails loudly here rather than silently no-op'ing below.
describe('Anemone heal — extracted ability shape (mutation guard)', () => {
    it('rides on-enemy-dot-damage, self-targeted, flat 5% of Max HP', () => {
        const heal = anemoneHealAbility();
        expect(heal.trigger).toBe('on-enemy-dot-damage');
        expect(heal.target).toBe('self');
        expect(heal.config.type).toBe('heal');
        if (heal.config.type === 'heal') {
            expect(heal.config.pct).toBe(5);
            expect(heal.config.basis).toBe('hp');
        }
    });
});

const anemoneFocusSkills = (): ShipSkills => ({
    slots: [basicSlot(), { slot: 'passive', abilities: [anemoneHealAbility()] }],
});

// A pre-seeded corrosion stack (tier 5, stacks 1) ticks stacks × (tier/100) × victimOwnMaxHp
// (neutral mults) — 0.05 × maxHp.
const corrosion = (
    tier: number,
    stacks: number,
    remainingRounds: number,
    sourceId: string
): ActiveDoTStack => ({ tier, stacks, remainingRounds, sourceId });

const enemyAt = (id: string, position: Position, hp: number, speed: number): EnemyAttacker =>
    ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp, speed },
        chargeCount: 0,
        startCharged: false,
        position,
        shipSkills: { slots: [] } as ShipSkills,
    }) as EnemyAttacker;

const teamStats = (hp: number) => ({
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    defence: 0,
    hp,
    hacking: 0,
});

const teamAlly = (id: string, position: Position, hp: number, speed: number): TeamActor =>
    ({
        id,
        speed,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position,
        target: parsedTarget('front'),
        pattern: lineRange1Pattern(),
        walk: {
            shipSkills: { slots: [basicSlot()] },
            stats: teamStats(hp),
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
    }) as TeamActor;

// Tap an ordered log of reactive-heal-performed events (the log-only event a reactive heal emits
// — see triggers.ts's #2 log-visibility comment; it never re-triggers on-repair listeners).
function collectReactiveHeals(input: CombatEngineInput) {
    const bus = createEventBus();
    const reactiveHeals: Extract<CombatEvent, { type: 'reactive-heal-performed' }>[] = [];
    bus.on('reactive-heal-performed', (e) => reactiveHeals.push(e));
    const result = runCombat({ ...input, bus });
    return { reactiveHeals, result };
}

describe('Anemone (player-side) — self-heal fires on a REAL positional ENEMY DoT tick, not on-cast', () => {
    it('an enemy taking a corrosion DoT tick fires the reactive self-heal (5% of Max HP) each ticking round', () => {
        // Positional battle: Anemone (attacker, M4) fires a harmless basic attack at `front`
        // (Line-Range-1, covers M4+M3 — both huge-HP so never die). enemy-back (M2) sits OUTSIDE
        // that footprint with maxHp 10000 and carries a corrosion stack applied by 'attacker'
        // (Anemone herself) — mirrors perVictimDotTick's C.1 case, where the applier (attacker,
        // default speed 100) acts before the low-speed enemy-back within round 1, so the tick
        // lands starting round 1. tick = 0.05 × 10000 = 500 per round (2 rounds → 2 ticks).
        const input: CombatEngineInput = {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: anemoneFocusSkills(),
            enemyDefense: 0,
            enemyHp: 1_000_000_000,
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
            hp: 1_000_000,
            healTargetId: 'attacker',
            position: 'M4',
            target: parsedTarget('front'),
            pattern: lineRange1Pattern(),
            enemyAttackers: [
                enemyAt('enemy-front', 'M4', 1_000_000_000, 1),
                enemyAt('enemy-mid', 'M3', 1_000_000_000, 1),
                enemyAt('enemy-back', 'M2', 10_000, 1),
            ],
            __testTapActors: (actors: CombatActor[]) => {
                actors
                    .find((a) => a.id === 'enemy-back')
                    ?.corrosionEntries.push(corrosion(5, 1, 5, 'attacker'));
            },
        };

        const { reactiveHeals, result } = collectReactiveHeals(input);
        const anemoneHeals = reactiveHeals.filter((e) => e.casterId === 'attacker');

        // Sanity: enemy-back's corrosion DoT actually ticked (the trigger's gating event).
        expect(result.rounds[0].perTargetDamage?.['enemy-back']).toBe(500);

        // The fix: the reactive self-heal fired once PER TICKING ROUND (both rounds, since the
        // corrosion stack outlives the 2-round fight), each at 5% of Anemone's own max HP — not
        // once per cast regardless of any DoT activity.
        expect(anemoneHeals).toHaveLength(2);
        for (const e of anemoneHeals) expect(e.amount).toBeCloseTo(1_000_000 * 0.05, 5);
    });

    it('a DoT tick on Anemone’s OWN side (a player ally) does NOT fire the reactive self-heal', () => {
        // team-ally (player side, M2) carries a corrosion stack applied by 'enemy-front' — ticks
        // via the per-victim playerSink branch (mirrors perVictimDotTick's C.2 case). The tick's
        // targetId ('team-ally') is SAME-SIDE as Anemone (both player), so isOpposing must reject
        // it — a DoT tick anywhere is not enough; it must land on an OPPOSING actor.
        const input: CombatEngineInput = {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: anemoneFocusSkills(),
            enemyDefense: 0,
            enemyHp: 1_000_000_000,
            numRounds: 3,
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
            healTargetId: 'attacker',
            position: 'M4',
            target: parsedTarget('front'),
            pattern: lineRange1Pattern(),
            teamActors: [teamAlly('team-ally', 'M2', 10_000, 100)],
            enemyAttackers: [
                enemyAt('enemy-front', 'M4', 1_000_000_000, 1),
                enemyAt('enemy-mid', 'M3', 1_000_000_000, 1),
            ],
            __testTapActors: (actors: CombatActor[]) => {
                actors
                    .find((a) => a.id === 'team-ally')
                    ?.corrosionEntries.push(corrosion(5, 1, 9, 'enemy-front'));
            },
        };

        const { reactiveHeals, result } = collectReactiveHeals(input);

        // Sanity: team-ally's corrosion DoT actually ticked at some point (the applier
        // 'enemy-front' acts after the players in round 1, so the first tick lands round 2).
        const tickedRound = result.rounds.find((r) => r.perTargetDamage?.['team-ally'] === 500);
        expect(tickedRound).toBeDefined();

        // The reactive self-heal must NEVER fire from this own-side tick.
        const anemoneHeals = reactiveHeals.filter((e) => e.casterId === 'attacker');
        expect(anemoneHeals).toHaveLength(0);
    });
});

describe('Anemone (enemy-side) — team symmetry: an enemy Anemone reacts to a PLAYER-side DoT tick', () => {
    it('a corrosion tick on a player team actor fires the enemy Anemone’s reactive self-heal', () => {
        // enemy-anemone (M4) is the enemy-side reactor. team-victim (player, M2) carries a
        // corrosion stack applied by 'enemy-anemone' herself — she acts first each round (speed
        // 1000 vs team-victim's 10), so the tick lands starting round 1, just like the
        // player-side positive case above (roles reversed).
        const enemyAnemone: EnemyAttacker = {
            id: 'enemy-anemone',
            stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000, speed: 1000 },
            chargeCount: 0,
            startCharged: false,
            position: 'M4',
            shipSkills: anemoneFocusSkills(),
        } as EnemyAttacker;

        const teamVictim: TeamActor = teamAlly('team-victim', 'M2', 10_000, 10);

        const input: CombatEngineInput = {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: { slots: [basicSlot()] },
            enemyDefense: 0,
            enemyHp: 1_000_000_000,
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
            healTargetId: 'attacker',
            position: 'M4',
            target: parsedTarget('front'),
            pattern: lineRange1Pattern(),
            teamActors: [teamVictim],
            enemyAttackers: [enemyAnemone],
            __testTapActors: (actors: CombatActor[]) => {
                actors
                    .find((a) => a.id === 'team-victim')
                    ?.corrosionEntries.push(corrosion(5, 1, 5, 'enemy-anemone'));
            },
        };

        const { reactiveHeals, result } = collectReactiveHeals(input);

        // Sanity: team-victim's corrosion DoT actually ticked.
        const tickedRound = result.rounds.find((r) => r.perTargetDamage?.['team-victim'] === 500);
        expect(tickedRound).toBeDefined();

        // Symmetry: the enemy-side Anemone fires its reactive heal exactly like a player-side one.
        const enemyHeals = reactiveHeals.filter((e) => e.casterId === 'enemy-anemone');
        expect(enemyHeals.length).toBeGreaterThanOrEqual(1);
        for (const e of enemyHeals) expect(e.amount).toBeCloseTo(1_000_000 * 0.05, 5);

        // And it must never be misrouted onto the player focus.
        expect(reactiveHeals.some((e) => e.casterId === 'attacker')).toBe(false);
    });
});
