/**
 * "on / from all targetable enemies" scopes a debuff or purge clause to the enemies its caster
 * could target (`Ability.targetableOnly`, `targetableEnemies` in positionalBinding.ts) — owner
 * ruling 2026-11-17: while the caster is Taunted, only the Taunter receives them.
 *
 * Amartya's real active and charged texts with "all enemies" rewritten to "all targetable enemies"
 * (the announced balance-patch wording). Her hit is single-target; three enemies at T1, M2, B2.
 * Both sides.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import type { Ability, Skill } from '../../../types/abilities';
import type { Ship } from '../../../types/ship';
import { mirrorBoard, ShipSpec, MirrorTeams } from './__fixtures__/mirrorBoard';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error('This suite requires docs/ship-skills.csv and docs/ship-data.json');
    }
});

const ENEMY_IDS = ['t1', 'm2', 'b2'];

const targetableAmartya = (): Skill[] => {
    const rec = loadShipSkillRecords().find((r) => r.name === 'Amartya');
    if (!rec) throw new Error('Amartya missing from docs/ship-skills.csv');
    const patch = (t: string | null | undefined) =>
        (t ?? '').replace(/all enemies/g, 'all targetable enemies');
    return buildShipAbilities({
        refits: [],
        activeSkillText: patch(rec.active),
        chargeSkillText: patch(rec.charge),
        chargeSkillCharge: rec.chargeCharge,
    } as unknown as Ship).slots;
};

const selfGrant = (buffName: string, id: string): Ability => ({
    id,
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName,
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        duration: 2,
    },
});

/** Enemies act before Amartya. `grants` maps an enemy id to the self-buffs it casts. Every one
 *  also casts Attack Up II so the purge has something to take. */
const enemies = (grants: Record<string, string[]>): ShipSpec[] =>
    (['T1', 'M2', 'B2'] as const).map((position, i) => {
        const id = ENEMY_IDS[i];
        const names = ['Attack Up II', ...(grants[id] ?? [])];
        return {
            id,
            position,
            speed: 50,
            hp: 1e9,
            skills: {
                slots: [
                    {
                        slot: 'active' as const,
                        abilities: names.map((n) => selfGrant(n, `${id}-${n}`)),
                    },
                ],
            },
        };
    });

const amartya = (charged: boolean): ShipSpec => {
    const slots = targetableAmartya();
    return {
        id: 'amartya',
        position: 'M4',
        speed: 10,
        hacking: 1000,
        critDamage: 100,
        hp: 1e9,
        ...(charged
            ? {
                  startCharged: true,
                  chargeCount: 99,
                  hasChargedSkill: true,
                  skills: {
                      slots: [
                          { slot: 'active' as const, abilities: [] },
                          ...slots.filter((s) => s.slot === 'charged'),
                      ],
                  },
              }
            : { skills: { slots: slots.filter((s) => s.slot === 'active') } }),
    };
};

describe('the parser reads "all targetable enemies" as a narrowed board-wide recipient', () => {
    it('flags her debuffs and purge boardWide + targetableOnly', () => {
        const flags = targetableAmartya()
            .flatMap((s) => s.abilities)
            .filter((a) => a.type === 'debuff' || a.type === 'purge')
            .map((a) => [a.type, a.target, a.boardWide, a.targetableOnly]);
        expect(flags).toEqual([
            ['debuff', 'all-enemies', true, true],
            ['debuff', 'all-enemies', true, true],
            ['purge', 'all-enemies', true, true],
        ]);
    });

    it('reads the recipient across repeated whitespace, as the purge parser does', () => {
        const slots = buildShipAbilities({
            refits: [],
            activeSkillText: 'Purges 1 buff from all  targetable   enemies.',
        } as unknown as Ship).slots;
        const purge = slots.flatMap((s) => s.abilities).find((a) => a.type === 'purge');
        expect([purge?.boardWide, purge?.targetableOnly]).toEqual([true, true]);
    });

    it('no current corpus ship carries targetableOnly', () => {
        const carriers = loadShipSkillRecords().filter((rec) => {
            const ship = buildTraceShip(rec.name);
            return ship
                ? buildShipAbilities(ship).slots.some((s) =>
                      s.abilities.some((a) => a.targetableOnly)
                  )
                : false;
        });
        expect(carriers.map((r) => r.name)).toEqual([]);
    });
});

describe.each(['player', 'enemy'] as const)('targetable Amartya on the %s side', (side) => {
    const debuffedBy = (teams: MirrorTeams): string[] => {
        const { input, idOf } = mirrorBoard(teams, side);
        const caster = idOf('amartya');
        const hit = new Set<string>();
        const bus = createEventBus();
        bus.on('debuff-applied', (e: Extract<CombatEvent, { type: 'debuff-applied' }>) => {
            if (e.sourceId === caster && e.buffName === 'Defense Down II') hit.add(e.targetId);
        });
        runCombat({ ...input, bus });
        return [...hit].sort();
    };

    const purgedBy = (teams: MirrorTeams): string[] => {
        const { input, idOf } = mirrorBoard(teams, side);
        const caster = idOf('amartya');
        const purged = new Set<string>();
        const bus = createEventBus();
        bus.on('purge-performed', (e: Extract<CombatEvent, { type: 'purge-performed' }>) => {
            if (e.casterId === caster && e.count > 0) purged.add(e.targetId);
        });
        runCombat({ ...input, bus });
        return [...purged].sort();
    };

    const idsOf = (teams: MirrorTeams, ids: string[]) => {
        const { idOf } = mirrorBoard(teams, side);
        return ids.map(idOf).sort();
    };

    it('Taunted → her debuffs land on the Taunter alone', () => {
        const teams: MirrorTeams = {
            caster: [amartya(false)],
            other: enemies({ b2: ['Taunt'] }),
            numRounds: 1,
        };
        expect(debuffedBy(teams)).toEqual(idsOf(teams, ['b2']));
    });

    it('no Taunt → her debuffs skip a stealthed enemy', () => {
        const teams: MirrorTeams = {
            caster: [amartya(false)],
            other: enemies({ t1: ['Stealth'] }),
            numRounds: 1,
        };
        expect(debuffedBy(teams)).toEqual(idsOf(teams, ['m2', 'b2']));
    });

    it('Taunted → her charged purge strips the Taunter alone', () => {
        const teams: MirrorTeams = {
            caster: [amartya(true)],
            other: enemies({ t1: ['Taunt'] }),
            numRounds: 1,
        };
        expect(purgedBy(teams)).toEqual(idsOf(teams, ['t1']));
    });

    it('control: with nobody Taunting or stealthed, every enemy is reached', () => {
        const teams: MirrorTeams = {
            caster: [amartya(false)],
            other: enemies({}),
            numRounds: 1,
        };
        expect(debuffedBy(teams)).toEqual(idsOf(teams, ENEMY_IDS));
    });
});
