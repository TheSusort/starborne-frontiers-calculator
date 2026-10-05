/**
 * Protection does not redirect a skill that targets the entire battlefield. The catalogue's
 * Protection text: "Redirects 10% of all direct damage dealt to allies to this Unit ... Damage is
 * not redirected for skills that target the entire battlefield."
 *
 * Curator (Pattern-All, "deals 60% damage to all enemies") hits a victim and Meatshield, who starts
 * combat with 3 Protection stacks (a 30% redirect) and turns damage taken through Protection into
 * a Damage over Time effect. Attack 10,000, crit 0, defence 0, so every 60% hit is 6,000 as
 * thrown. Every case runs with the attacker on the player side and on the enemy side.
 *
 * Validity arm: the same board with a single-target 60% attacker still redirects 30% of the
 * victim's hit to Meatshield (4,200 taken, and Meatshield carries the Protection DoT).
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { parsePattern, parseTarget } from '../../targetingParser';
import {
    boardInput,
    hitKit,
    NO_KIT,
    realKit,
    type BoardUnit,
    type Placement,
} from '../__testutils__/realKitBoard';
import type { ShipSkills } from '../../../types/abilities';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(7));

/** A real kit with its active/charged emptied, so only its passive acts. */
const passiveOnly = (ship: string): ShipSkills => ({
    slots: realKit(ship).slots.map((s) =>
        s.slot === 'passive' ? s : { slot: s.slot, abilities: [] }
    ),
});

interface Round1 {
    /** What each struck unit TOOK from the attacker's cast. */
    taken: Map<string, number>;
    /** The protector's debuffs at the end of round 1. */
    protectorDebuffs: string[];
}

const runRound1 = (input: Parameters<typeof runCombat>[0], attackerId: string): Round1 => {
    const bus = createEventBus();
    const taken = new Map<string, number>();
    let protectorDebuffs: string[] = [];
    bus.on('attacked', (e: Extract<CombatEvent, { type: 'attacked' }>) => {
        if (e.attackerId !== attackerId || e.round !== 1) return;
        taken.set(e.targetId, (taken.get(e.targetId) ?? 0) + (e.takenDamage ?? 0));
    });
    bus.on('status-snapshot', (e: Extract<CombatEvent, { type: 'status-snapshot' }>) => {
        if (e.actorId === 'meatshield' && e.round === 1) protectorDebuffs = e.debuffNames;
    });
    runCombat({ ...input, bus });
    for (const [k, v] of taken) taken.set(k, Math.round(v));
    return { taken, protectorDebuffs };
};

const board = (
    placement: Placement,
    attackerKit: ShipSkills,
    wholeBattlefield: boolean,
    charged = false
) => {
    const attacker: BoardUnit = {
        id: 'curator',
        kit: attackerKit,
        position: 'M4',
        speed: 300,
        attack: 10_000,
        ...(charged ? { chargeCount: 1, startCharged: true } : { chargeCount: 4 }),
        ...(wholeBattlefield
            ? { target: parseTarget('all'), pattern: parsePattern('Pattern-All') }
            : {}),
    };
    const victim: BoardUnit = { id: 'victim', kit: NO_KIT, position: 'M4', speed: 2 };
    const protector: BoardUnit = {
        id: 'meatshield',
        kit: passiveOnly('Meatshield'),
        position: 'B4',
        speed: 1,
    };
    const { input, id } = boardInput(placement, attacker, [], [victim, protector], 1);
    return { input, attackerId: id(attacker), victimId: id(victim) };
};

describe.each<Placement>(['player', 'enemy'])('attacker on the %s side', (placement) => {
    it('Curator active: the victim takes its whole hit and nothing reaches Meatshield', () => {
        const { input, attackerId, victimId } = board(placement, realKit('Curator'), true);
        const r = runRound1(input, attackerId);
        expect(r.taken.get(victimId)).toBe(6000);
        expect(r.taken.get('meatshield')).toBe(6000);
        expect(r.protectorDebuffs).toEqual([]);
    });

    it('Curator charged (also Pattern-All): the victim takes its whole 125% hit', () => {
        const { input, attackerId, victimId } = board(placement, realKit('Curator'), true, true);
        const r = runRound1(input, attackerId);
        expect(r.taken.get(victimId)).toBe(12500);
        expect(r.protectorDebuffs).toEqual([]);
    });

    it('validity: a single-target 60% hit is still redirected (4200 taken, Protection DoT)', () => {
        const { input, attackerId, victimId } = board(placement, hitKit(60), false);
        const r = runRound1(input, attackerId);
        expect(r.taken.get(victimId)).toBe(4200);
        expect(r.protectorDebuffs).toEqual(['Damage over Time']);
    });
});
