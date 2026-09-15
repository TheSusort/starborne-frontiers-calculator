/**
 * crossShipStasisReapply.integration.test.ts — #535.
 *
 * A hit on a stasised victim does not reduce Stasis where it lands; it queues a DEFERRED break into
 * `stasisBreakPending`, keyed by VICTIM and spent on that victim's next BLOCKED turn. In game the
 * reduction happens at the hit, so a Stasis arriving afterwards is weighed against the already
 * reduced incumbent, and a fresh Stasis from a DIFFERENT ship keeps its full duration (owner
 * ruling 2026-09-15).
 *
 * The engine settles a pending mark at the Stasis-APPLY seam instead — `reduceTimedEnemyStatus`
 * runs before the family contest — so the contest sees the reduced incumbent exactly as the game's
 * ordering does.
 *
 * WHAT THE ARMS DISCRIMINATE. `hitter` lands one breaking hit on the victim and is then exempt or
 * gone, so the only mark in play is its. `reapplier` lands a Stasis afterwards. Reading the round
 * the victim first acts:
 *   - a LONGER incoming Stasis must survive at its full duration (the ruling);
 *   - a SHORTER one must lose the contest and leave the incumbent MINUS the break — the case a bare
 *     clear of the mark gets wrong, and the reason this resolves rather than clears.
 *
 * HARNESS. Geometry from perFootprintStasisBreak.integration.test.ts: a fast stasis-bot seeds the
 * incumbent in round 1 and is culled that round so nothing re-seeds it.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `x${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});
const pt = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });
const damageOnly = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } }),
    ],
});
/** Damage plus a Stasis of the given duration — a real applier, not a bare debuff. */
const stasisCast = (turns: number): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 1 } }),
        ab({
            type: 'debuff',
            target: 'enemy',
            config: {
                type: 'debuff',
                buffName: 'Stasis',
                application: 'inflict',
                duration: turns,
                stacks: 1,
                isStackable: false,
                parsedEffects: {},
            },
        }),
    ],
});
const teamCaster = (
    id: string,
    position: Position,
    speed: number,
    slot: ShipSkills['slots'][number],
    hp = 1_000_000_000,
    doesntBreakStasis = false
): TeamActorEngineInput => ({
    id,
    speed,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position,
    target: pt('front'),
    pattern: basePattern(),
    doesntBreakStasis,
    walk: {
        shipSkills: { slots: [slot] },
        stats: {
            attack: 1,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 500,
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
});
const victim = (): EnemyAttacker => ({
    id: 'victim',
    stats: {
        attack: 1,
        crit: 0,
        critDamage: 0,
        defence: 0,
        hp: 1_000_000_000,
        speed: 1,
        security: 0,
        hacking: 0,
    },
    chargeCount: 0,
    startCharged: false,
    position: 'M4',
    target: pt('front'),
    pattern: basePattern(),
    shipSkills: { slots: [damageOnly()] },
});
/** Culls a 1-HP caster in round 1 so its status is applied exactly once. `sel` picks which. */
const culler = (
    id: string,
    position: Position,
    speed: number,
    sel: ParsedTarget['selection']
): EnemyAttacker => ({
    id,
    stats: {
        attack: 1_000_000,
        crit: 0,
        critDamage: 0,
        defence: 0,
        hp: 1_000_000_000,
        speed,
        security: 0,
        hacking: 0,
    },
    chargeCount: 0,
    startCharged: false,
    position,
    target: pt(sel),
    pattern: basePattern(),
    shipSkills: { slots: [damageOnly()] },
});

interface Arms {
    incumbent: number;
    incoming: number;
    /** When true the hitter never marks a break — the baseline the ruling is read against. */
    hitterExempt: boolean;
}

/** Round the victim first acts. */
const firstActs = ({ incumbent, incoming, hitterExempt }: Arms): number | undefined => {
    const bus = createEventBus();
    const acts: number[] = [];
    bus.on('ability-performed', (e: Extract<CombatEvent, { type: 'ability-performed' }>) => {
        if (e.actorId === 'victim') acts.push(e.round);
    });
    runCombat({
        attack: 1,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: { slots: [damageOnly()] },
        numRounds: 12,
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
        hacking: 0,
        doesntBreakStasis: true,
        healTargetId: 'attacker',
        mode: 'healing',
        position: 'B2',
        speed: 2,
        target: pt('front'),
        pattern: basePattern(),
        bus,
        teamActors: [
            // Seeds the incumbent in round 1, then dies to the culler.
            teamCaster('seed', 'M1', 1000, stasisCast(incumbent), 1),
            // Lands the breaking hit while the victim is stasised → queues the mark.
            teamCaster('hitter', 'M3', 800, damageOnly(), 1, hitterExempt),
            // A DIFFERENT ship applies Stasis afterwards — the ruling's subject.
            teamCaster('reapplier', 'M2', 700, stasisCast(incoming), 1, true),
        ],
        enemyAttackers: [
            victim(),
            // Kills the seed after it has seeded (M-row, back-most = M1).
            culler('cull-seed', 'M2', 900, 'back'),
            // Kills the M-row front-most player each round: the hitter in round 1 (after its one
            // breaking hit), then the re-applier in round 2 (after its one application).
            culler('cull-hitter', 'T1', 750, 'front'),
        ],
    });
    return acts[0];
};

describe("#535 — a pending break must not shave another ship's fresh Stasis", () => {
    it('a LONGER incoming Stasis keeps its full duration, exactly as if no hit had landed', () => {
        // The ruling: the earlier ship's hit spends itself on the incumbent, so a longer fresh
        // Stasis from a different ship is worth the same whether or not that hit happened.
        expect(firstActs({ incumbent: 2, incoming: 5, hitterExempt: false })).toBe(
            firstActs({ incumbent: 2, incoming: 5, hitterExempt: true })
        );
    });

    it('a SHORTER incoming Stasis loses the contest and the break still lands on the incumbent', () => {
        // The other half, and why the mark is RESOLVED rather than cleared: the incoming Stasis
        // must not win, and the break it did not clear must still shorten the incumbent — so this
        // arm has to differ from its exempt twin.
        expect(firstActs({ incumbent: 5, incoming: 2, hitterExempt: false })).not.toBe(
            firstActs({ incumbent: 5, incoming: 2, hitterExempt: true })
        );
    });
});
