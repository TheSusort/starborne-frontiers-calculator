/**
 * APEX's own passive shields count for her charged skill's shield check in the same cast (owner
 * ruling R47, 2026-10-05, Q10).
 *
 * Charged: "This Unit deals 220% damage and inflicts Attack Down II and Out. Damage Down II for 2
 * turns. If this Unit has an active shield, the primary target is inflicted with Disable for 2
 * turns." Passive: "This Unit gains a shield equal to 3% of their max HP when an enemy gets
 * inflicted with a debuff." The 3% shield arrives as the cast's first debuff lands, in written
 * order (once per skill cast — `Ability.oncePerRootCast`), so APEX starting the cast unshielded is
 * shielded by the time the Disable clause is checked. Her Block Shield shares that cap but spends
 * it only when its "3 or more debuffs" condition passes, so the Disable that brings the enemy to 3
 * still inflicts it.
 *
 * Board: APEX starts charged with no shield and casts once at a lone enemy. Her hacking dwarfs its
 * security unless a case says otherwise. Run with APEX on the player side and on the enemy side.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { parsePattern } from '../../targetingParser';
import {
    boardInput,
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
beforeEach(() => setupKeyedRng(47));

/** APEX's real charged skill, with or without her real passive. */
const apexKit = (withPassive: boolean): ShipSkills => ({
    slots: realKit('APEX').slots.filter(
        (s) => s.slot === 'charged' || s.slot === 'active' || (withPassive && s.slot === 'passive')
    ),
});

interface Outcome {
    /** Debuffs landed on the enemy, in order. */
    landed: string[];
    resisted: string[];
    /** Disable control events on the enemy. */
    disableControls: number;
}

const castOnce = (placement: Placement, kit: ShipSkills, enemySecurity: number): Outcome => {
    const apex: BoardUnit = {
        id: 'apex',
        kit,
        position: 'M4',
        speed: 300,
        attack: 1000,
        hacking: 1e6,
        hp: 100_000,
        chargeCount: 3,
        startCharged: true,
    };
    const enemy: BoardUnit = {
        id: 'victim',
        kit: NO_KIT,
        position: 'M4',
        speed: 1,
        security: enemySecurity,
    };
    const { input, id } = boardInput(placement, apex, [], [enemy], 1);
    const enemyId = id(enemy);
    const bus = createEventBus();
    const out: Outcome = { landed: [], resisted: [], disableControls: 0 };
    bus.on('debuff-applied', (e: Extract<CombatEvent, { type: 'debuff-applied' }>) => {
        if (e.targetId === enemyId) out.landed.push(e.buffName);
    });
    bus.on('debuff-resisted', (e: Extract<CombatEvent, { type: 'debuff-resisted' }>) => {
        if (e.targetId === enemyId) out.resisted.push(e.buffName);
    });
    bus.on('control-applied', (e: Extract<CombatEvent, { type: 'control-applied' }>) => {
        if (e.targetId === enemyId && e.effect === 'disable') out.disableControls++;
    });
    runCombat({ ...input, bus });
    return out;
};

/** APEX casts her charged on a Line: the primary (M4, unbeatable security) and a covered enemy
 *  behind it (M3, security 0). */
const castOnLine = (
    placement: Placement
): Record<'primary' | 'covered', { landed: string[]; resisted: string[] }> => {
    const apex: BoardUnit = {
        id: 'apex',
        kit: apexKit(true),
        position: 'M4',
        speed: 300,
        attack: 1000,
        hacking: 1e6,
        hp: 100_000,
        chargeCount: 3,
        startCharged: true,
        pattern: parsePattern('Pattern-Line-Range-1'),
    };
    const primary: BoardUnit = {
        id: 'primary',
        kit: NO_KIT,
        position: 'M4',
        speed: 1,
        security: 1e9,
    };
    const covered: BoardUnit = { id: 'covered', kit: NO_KIT, position: 'M3', speed: 1 };
    const { input, id } = boardInput(placement, apex, [], [primary, covered], 1);
    const out = {
        primary: { landed: [] as string[], resisted: [] as string[] },
        covered: { landed: [] as string[], resisted: [] as string[] },
    };
    const which = (targetId: string) =>
        targetId === id(primary) ? out.primary : targetId === id(covered) ? out.covered : undefined;
    const bus = createEventBus();
    bus.on('debuff-applied', (e: Extract<CombatEvent, { type: 'debuff-applied' }>) => {
        which(e.targetId)?.landed.push(e.buffName);
    });
    bus.on('debuff-resisted', (e: Extract<CombatEvent, { type: 'debuff-resisted' }>) => {
        which(e.targetId)?.resisted.push(e.buffName);
    });
    runCombat({ ...input, bus });
    return out;
};

describe.each<Placement>(['player', 'enemy'])('APEX on the %s side', (placement) => {
    it('unshielded APEX: her two debuffs land, their shields arrive, Disable lands', () => {
        const o = castOnce(placement, apexKit(true), 0);
        // Disable is the enemy's third debuff, so her passive's "3 or more debuffs on a debuff
        // infliction" then inflicts Block Shield.
        expect(o.landed).toEqual([
            'Attack Down II',
            'Out. Damage Down II',
            'Disable',
            'Block Shield',
        ]);
        expect(o.disableControls).toBe(1);
    });

    it('negative: without her passive no shield arrives, so the Disable clause is skipped', () => {
        const o = castOnce(placement, apexKit(false), 0);
        expect(o.landed).toEqual(['Attack Down II', 'Out. Damage Down II']);
        expect(o.resisted).not.toContain('Disable');
        expect(o.disableControls).toBe(0);
    });

    it('reverse board: the primary resists, a second struck enemy takes the debuffs — still shielded', () => {
        // "when AN enemy gets inflicted": the shields come from the covered enemy's landings,
        // so the Disable clause is attempted on the primary (which then resists it too).
        const o = castOnLine(placement);
        expect(o.primary.landed).toEqual([]);
        expect(o.covered.landed).toEqual(
            expect.arrayContaining(['Attack Down II', 'Out. Damage Down II'])
        );
        expect(o.primary.resisted).toEqual(['Attack Down II', 'Out. Damage Down II', 'Disable']);
    });

    it('negative: both debuffs resisted, no shield arrives, the Disable clause is skipped', () => {
        const o = castOnce(placement, apexKit(true), 1e9);
        // Instrument: the earlier clauses really were rolled and resisted.
        expect(o.resisted).toEqual(['Attack Down II', 'Out. Damage Down II']);
        expect(o.landed).toEqual([]);
        expect(o.disableControls).toBe(0);
    });
});

/** APEX's kit with her charged skill's two debuffs re-worded as "applies" — debuffs her passive's
 *  "gets inflicted" shield does not see. */
const apexAppliedDebuffsKit = (): ShipSkills => ({
    slots: apexKit(true).slots.map((s) =>
        s.slot !== 'charged'
            ? s
            : {
                  ...s,
                  abilities: s.abilities.map((a) =>
                      a.config.type === 'debuff' && a.config.buffName !== 'Disable'
                          ? { ...a, config: { ...a.config, application: 'apply' as const } }
                          : a
                  ),
              }
    ),
});

describe.each<Placement>(['player', 'enemy'])(
    'APEX on the %s side, earlier debuffs applied rather than inflicted',
    (placement) => {
        it('her "inflicted" shield does not see them, so the Disable clause is skipped', () => {
            const passive = apexKit(true).slots.find((s) => s.slot === 'passive');
            expect(
                passive?.abilities.some(
                    (a) =>
                        a.type === 'shield' &&
                        a.trigger === 'on-enemy-debuff-inflicted' &&
                        a.triggerApplicationFilter === 'inflict'
                )
            ).toBe(true);
            const o = castOnce(placement, apexAppliedDebuffsKit(), 0);
            expect(o.landed).toEqual(['Attack Down II', 'Out. Damage Down II']);
            expect(o.disableControls).toBe(0);
        });
    }
);
