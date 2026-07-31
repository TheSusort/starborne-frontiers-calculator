/**
 * Reaction-applied DoTs are REAL DoTs on the REAL victim.
 *
 * Three corpus passives inflict a DoT-named status from a reaction (docs/ship-skills.csv):
 *   - Ruiner   "inflicts Bomb II for 2 turns on any enemy performing a repair"  (on-enemy-repaired)
 *   - Warden   "When directly damaged, this Unit inflicts Corrosion I … on that enemy" (on-attacked)
 *   - Shepherd "When directly damaged, this Unit inflicts Corrosion I … on its attacker" (on-attacked)
 *
 * They used to build as name-only `debuff` statuses with empty parsedEffects — a deliberate Phase
 * 4c PR 1 decision made when only the singular focus-dummy enemy carried DoT containers, so a real
 * DoT here would have phantom-credited ticks the sim never resolved. That premise is gone: enemies
 * are positioned actors with their OWN corrosion/inferno/bomb containers that tick and burst on
 * their own turns (engine.ts `applyPositionedTimedBurst` / `tickDoTs`). A name-only status means a
 * Bomb that never counts down, never explodes and never deals damage — the reported bug.
 *
 * Two things must both hold, and the second is easy to miss: the reactive `dot` executor resolves
 * its victim from `eventCtx.victimId`, but `on-attacked` / `on-enemy-repaired` stamp
 * `counterTargetId` instead. Without that fallback the DoT lands in `ctx.pendingBombs` — the
 * vestigial DPS-dummy `enemy` actor — and still never bursts.
 */
import { describe, it, expect } from 'vitest';
import { parsePattern, parseTarget } from '../../targetingParser';
import { runCombat, type CombatEngineInput } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { Ship } from '../../../types/ship';

const RUINER_P1 =
    'This Unit inflicts <unit-skill>Bomb II</unit-skill> for 2 turns on any enemy performing a <unit-aid>repair</unit-aid>, once per round per enemy.';
const WARDEN_P1 =
    'When directly damaged, this Unit inflicts <unit-skill>Corrosion I</unit-skill> for 2 turns on that enemy and <unit-damage>repairs itself 3%</unit-damage> of its Max HP.';

function passiveAbilities(text: string): Ability[] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ship = { refits: [], firstPassiveSkillText: text } as any as Ship;
    return buildShipAbilities(ship).slots.flatMap((s) => s.abilities);
}

// =============================================================================
// Builder shape (mutation guards) — a real `dot`, not a name-only `debuff`.
// =============================================================================

describe('reactive passive DoT — extracted ability shape', () => {
    it("Ruiner's on-enemy-repaired Bomb II is a dot ability (dotType bomb, tier 200, 2 turns)", () => {
        const abilities = passiveAbilities(RUINER_P1);
        const bomb = abilities.find((a) => a.type === 'dot');
        expect(bomb).toBeDefined();
        expect(bomb!.trigger).toBe('on-enemy-repaired');
        expect(bomb!.target).toBe('enemy');
        expect(bomb!.oncePerRoundPerEnemy).toBe(true);
        expect(bomb!.config).toMatchObject({
            type: 'dot',
            dotType: 'bomb',
            tier: 200,
            stacks: 1,
            duration: 2,
        });
        // The inert name-only debuff twin must be GONE, not merely accompanied by a dot —
        // otherwise the status shows up twice in the log and once in the debuff store.
        expect(
            abilities.some((a) => a.config.type === 'debuff' && a.config.buffName === 'Bomb II')
        ).toBe(false);
    });

    it("Warden's on-attacked Corrosion I is a dot ability (dotType corrosion, tier 3)", () => {
        const abilities = passiveAbilities(WARDEN_P1);
        const dot = abilities.find((a) => a.type === 'dot');
        expect(dot).toBeDefined();
        expect(dot!.trigger).toBe('on-attacked');
        expect(dot!.config).toMatchObject({ type: 'dot', dotType: 'corrosion', tier: 3 });
        expect(
            abilities.some((a) => a.config.type === 'debuff' && a.config.buffName === 'Corrosion I')
        ).toBe(false);
    });
});

// =============================================================================
// Engine: the Bomb lands on the real repairing enemy, counts down on ITS turns, and bursts.
// =============================================================================

const noopAttack = (multiplier = 0): Ability => ({
    id: 'atk',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier, hits: 1 },
});

/** Heliodor's shape: a self-repair reaction — "an enemy performing a repair", which is what
 *  wakes Ruiner's Bomb. A plain on-cast self-heal is enough to emit the repair event. */
const selfHeal = (): Ability => ({
    id: 'self-heal',
    type: 'heal',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'heal', pct: 5, basis: 'target-hp' },
});

function ruinerVsRepairingEnemy(numRounds: number, ruinerSpeed = 500) {
    const bus = createEventBus();
    const dotApplied: Extract<CombatEvent, { type: 'dot-applied' }>[] = [];
    const detonated: Extract<CombatEvent, { type: 'bomb-detonated' }>[] = [];
    bus.on('dot-applied', (e) => dotApplied.push(e));
    bus.on('bomb-detonated', (e) => detonated.push(e));

    const ruinerSkills: ShipSkills = {
        slots: [
            { slot: 'active', abilities: [noopAttack(100)] },
            { slot: 'passive', abilities: passiveAbilities(RUINER_P1) },
        ],
    };

    const input: CombatEngineInput = {
        attack: 10_000,
        crit: 0,
        critDamage: 150,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: ruinerSkills,
        enemyDefense: 0,
        enemyHp: 1_000_000_000,
        numRounds,
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
        // Default 500: Ruiner acts FIRST, so the Bomb is planted after it already has a
        // last-turn ctx. Pass a lower speed to exercise the faster-healer round-1 case.
        speed: ruinerSpeed,
        hacking: 100_000, // land the DoT deterministically
        healTargetId: 'attacker',
        positionalTeamBattle: true,
        position: 'M1',
        target: parseTarget('front'),
        pattern: parsePattern('Pattern-Base'),
        enemyAttackers: [
            {
                id: 'healer',
                stats: {
                    attack: 0,
                    crit: 0,
                    critDamage: 0,
                    speed: 100,
                    defence: 0,
                    hp: 500_000,
                    security: 0,
                },
                chargeCount: 0,
                startCharged: false,
                position: 'M1',
                target: parseTarget('front'),
                pattern: parsePattern('Pattern-Base'),
                shipSkills: { slots: [{ slot: 'active', abilities: [selfHeal()] }] },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any,
        ],
        bus,
    };

    runCombat(input);
    return { dotApplied, detonated };
}

describe('Ruiner Bomb II from a repair reaction — lands on the repairer and detonates', () => {
    it('applies a bomb dot to the repairing enemy (not the DPS dummy sink)', () => {
        const { dotApplied } = ruinerVsRepairingEnemy(1);
        const bombs = dotApplied.filter((e) => e.dotType === 'bomb');
        expect(bombs.length).toBeGreaterThan(0);
        expect(bombs[0].targetId).toBe('healer');
        expect(bombs[0].sourceId).toBe('attacker');
    });

    it('the bomb counts down on the enemy’s own turns and detonates for real damage', () => {
        const { detonated } = ruinerVsRepairingEnemy(4);
        expect(detonated.length).toBeGreaterThan(0);
        expect(detonated[0].victimId).toBe('healer');
        expect(detonated[0].actorId).toBe('attacker');
        expect(detonated[0].damage).toBeGreaterThan(0);
    });

    // A bomb snapshots the applier's effective attack at APPLICATION (unlike corrosion/inferno,
    // which resolve the applier's ctx at each tick). The snapshot used to come only from the
    // applier's last-turn ctx, so a reaction that fired before the applier's first turn of the
    // run — a faster enemy healing in round 1, which is the common case for enemy healers — was
    // dropped outright: no bomb, no log line, nothing. It now falls back to the applier's LIVE
    // effective attack.
    it('a repair BEFORE the applier’s first turn still plants a bomb (faster healer, round 1)', () => {
        const { dotApplied, detonated } = ruinerVsRepairingEnemy(4, 1);
        const bombs = dotApplied.filter((e) => e.dotType === 'bomb');
        expect(bombs.length).toBeGreaterThan(0);
        expect(bombs[0].targetId).toBe('healer');
        expect(bombs[0].round).toBe(1);
        // And it is a REAL bomb, not a zero-damage placeholder.
        expect(detonated.length).toBeGreaterThan(0);
        expect(detonated[0].damage).toBeGreaterThan(0);
    });
});
