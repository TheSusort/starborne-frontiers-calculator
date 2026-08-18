/**
 * wave8ZeolitePurge.integration.test.ts — Ship-kit Wave 8 Task 12 (Zeolite).
 *
 * Zeolite's refit-active (R4) passive: "This Unit increases damage by 30% when hitting a
 * Defender and purges 1 buff from the enemy when dealing damage to a Defender." The +30%
 * damage gate shipped in Wave 4; the purge half ("purges 1 buff from the enemy when dealing
 * damage to a Defender") was deferred — buildShipAbilities.ts's passive-purge trigger chain had
 * no "when dealing damage to a Defender" detector, so it was silently dropped.
 *
 * The parser now emits a `purge` ability (target enemy, count 1, trigger 'on-deal-damage',
 * `enemy-type` Defender condition) — see wave8Zeolite.test.ts for the parser-level coverage.
 * This file proves the ENGINE actually fires it: triggers.ts's on-deal-damage listener already
 * routes the owner's own damage-dealing turn (Burner's Inferno rider — see
 * reactiveDotPositionalRouting.test.ts); this task additionally (a) threads the reactive
 * `victimId` seam onto the `purge` executor's target routing (it previously only read
 * `counterTargetId`) and (b) re-checks the `enemy-type` gate at drain time against the REAL
 * victim's ship role via `ctx.roleOf` (the SAME side-agnostic `roleByActorId` map Meatshield's
 * defense-substitution and Graphite's roleFilter already consume) — the generic drain gate
 * reads only the single fight-wide `enemyType`, which is undefined for an enemy-owned reaction
 * and therefore could never be team-symmetric.
 *
 * Harness mirrors reactiveDotPositionalRouting.test.ts's Burner shape (positional two-team
 * battle, position 'M4' / target 'front' on every actor so the focus's own damage lands on the
 * REAL positioned enemy, not the dummy sink) and lodolitePurgeShieldStrip's self-buff fixture
 * (a "grants itself Attack Up" ability providing something for the purge to remove).
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { Ship } from '../../../types/ship';
import type { StatusEngine } from '../statusEngine';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

// Verbatim from docs/ship-skills.csv (Zeolite refit-3/R4 passive).
const ZEOLITE_PASSIVE_R4 =
    'This Unit increases <unit-damage>damage by 30%</unit-damage> when hitting a Defender and <unit-aid>purges 1</unit-aid> buff from the enemy when dealing damage to a Defender.';
// Zeolite's REAL active ALSO carries its own unconditional on-cast purge ("purges 1 buff from
// the enemy, inflicts Defense Down III …") — a separate, pre-existing mechanic that would
// confound isolating the passive's on-deal-damage reactive under test here. Swapped for a plain
// damage active (still real production parsing via buildShipAbilities, just a different text).
const PLAIN_ACTIVE = 'This Unit deals <unit-damage>100% damage</unit-damage>.';

const zeoliteShip = (): Ship =>
    ({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({} as any),
        refits: [{}, {}, {}, {}], // R4 — third passive (the "+30%/purge vs Defender" sentence)
        activeSkillText: PLAIN_ACTIVE,
        thirdPassiveSkillText: ZEOLITE_PASSIVE_R4,
    }) as Ship;

// Zeolite's REAL production-parsed active + passive slots.
const zeoliteSkills = (): ShipSkills => {
    const built = buildShipAbilities(zeoliteShip());
    const active = built.slots.find((s) => s.slot === 'active');
    const passive = built.slots.find((s) => s.slot === 'passive');
    if (!active || !passive) throw new Error('Zeolite active/passive slots missing');
    return { slots: [active, passive] };
};

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `w8zp${++idc}`,
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
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

const hit = (multiplier = 10): Ability =>
    ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier } });

// Grants itself Attack Up (near-permanent duration so it survives to be observed) — the buff
// Zeolite's reactive purge is expected to remove from a Defender victim (and leave alone on a
// non-Defender victim).
const selfBuff = (): Ability =>
    ab({
        type: 'buff',
        target: 'self',
        trigger: 'on-cast',
        config: {
            type: 'buff',
            buffName: 'Attack Up',
            parsedEffects: { attack: 30 },
            stacks: 1,
            isStackable: false,
            duration: 99,
        },
    });

const runTapStatus = (input: CombatEngineInput): StatusEngine => {
    let engine: StatusEngine | undefined;
    runCombat({ ...input, __testTapStatusEngine: (e) => (engine = e) });
    if (!engine) throw new Error('status engine tap did not fire');
    return engine;
};
const selfBuffNames = (engine: StatusEngine, id: string): string[] =>
    engine.timedAbilityStatuses('self', id).map((b) => b.active.buffName);

describe('Wave 8 Task 12: Zeolite purges a buff when damaging a Defender (engine integration)', () => {
    // A self-buffing enemy at speed 150 (> the focus's 100) so it grants itself Attack Up
    // BEFORE Zeolite's turn every round — giving the reactive purge something to remove.
    const buffingEnemy = (role: EnemyAttacker['role']): EnemyAttacker =>
        ({
            id: 'enemy-front',
            stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000, speed: 150 },
            chargeCount: 0,
            startCharged: false,
            position: 'M4' as Position,
            target: parsedTarget('front'),
            pattern: basePattern(),
            role,
            shipSkills: { slots: [{ slot: 'active', abilities: [selfBuff(), hit(0)] }] },
        }) as EnemyAttacker;

    const focusInput = (): CombatEngineInput => ({
        enemyAttackers: [],
        attack: 10_000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: zeoliteSkills(),
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
        speed: 100,
        healTargetId: 'attacker',
        mode: 'healing',
        position: 'M4',
        target: parsedTarget('front'),
        pattern: basePattern(),
    });

    it('purges the Attack Up buff off a Defender-classed enemy Zeolite damages', () => {
        const engine = runTapStatus({
            ...focusInput(),
            enemyAttackers: [buffingEnemy('DEFENDER')],
        });
        expect(selfBuffNames(engine, 'enemy-front')).not.toContain('Attack Up');
    });

    it('CONTROL: does NOT purge a non-Defender enemy Zeolite damages (buff survives)', () => {
        const engine = runTapStatus({
            ...focusInput(),
            enemyAttackers: [buffingEnemy('ATTACKER')],
        });
        expect(selfBuffNames(engine, 'enemy-front')).toContain('Attack Up');
    });
});

describe('Wave 8 Task 12: team symmetry — an enemy-side Zeolite purges a player Defender', () => {
    // Mirror of the player-side harness: the focus (player) self-buffs at speed 150 (acts
    // before the enemy Zeolite, speed 100), giving the enemy-owned reactive purge something to
    // remove from a Defender-classed FOCUS.
    const selfBuffingFocusSkills = (): ShipSkills => ({
        slots: [{ slot: 'active', abilities: [selfBuff(), hit(0)] }],
    });

    const enemyZeolite = (): EnemyAttacker =>
        ({
            id: 'zeolite-enemy',
            stats: {
                attack: 10_000,
                crit: 0,
                critDamage: 0,
                defence: 0,
                hp: 1_000_000,
                speed: 100,
            },
            chargeCount: 0,
            startCharged: false,
            position: 'M4' as Position,
            target: parsedTarget('front'),
            pattern: basePattern(),
            shipSkills: zeoliteSkills(),
        }) as EnemyAttacker;

    const teamSymFocusInput = (
        role: NonNullable<TeamActor['role']> | undefined
    ): CombatEngineInput => ({
        attack: 0,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: selfBuffingFocusSkills(),
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
        speed: 150,
        role,
        healTargetId: 'attacker',
        mode: 'healing',
        position: 'M4',
        target: parsedTarget('front'),
        pattern: basePattern(),
        enemyAttackers: [enemyZeolite()],
    });

    it('an enemy-side Zeolite purges the Attack Up buff off a Defender-classed player focus', () => {
        const engine = runTapStatus(teamSymFocusInput('DEFENDER'));
        expect(selfBuffNames(engine, 'attacker')).not.toContain('Attack Up');
    });

    it('CONTROL: an enemy-side Zeolite does NOT purge a non-Defender player focus (buff survives)', () => {
        const engine = runTapStatus(teamSymFocusInput('ATTACKER'));
        expect(selfBuffNames(engine, 'attacker')).toContain('Attack Up');
    });
});
