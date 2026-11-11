/**
 * A static self-stat passive is counted exactly once, by the ship's stats (#784, #785):
 *  - Grif's refit-active passive: "This Unit increases its defense by 20%."
 *  - Hermes's refit-active passive: "This Unit's defense is increased by 20% and ..."
 *
 * The +20% is the unit's level-2 refit ascension stat, which the game export and the catalogue
 * both carry, so planner and reference-ship stats already include it. The kit mints nothing for
 * the clause and the engine adds nothing on top.
 */
import { readFileSync, existsSync } from 'node:fs';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import {
    boardInput,
    hitKit,
    NO_KIT,
    realKit,
    type BoardUnit,
    type Placement,
} from '../__testutils__/realKitBoard';
import type { ShipSkills } from '../../../types/abilities';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { referenceShip, type AscensionStat } from '../../ship/referenceShip';
import { shipFinalStats } from '../../ship/combatStats';
import { getShipSkillRows } from '../../ship/skillRows';

const CATALOGUE = 'docs/catalogue-units.json';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable() || !existsSync(CATALOGUE))
        throw new Error(
            'docs/ship-skills.csv, docs/ship-data.json and docs/catalogue-units.json are required'
        );
});
beforeEach(() => setupKeyedRng(3));

const CARRIERS = ['Grif', 'Hermes'];
const DEFENCE = 2_321;

const passiveOnly = (kit: ShipSkills): ShipSkills => ({
    slots: kit.slots.filter((s) => s.slot === 'passive'),
});

const defenceModifiers = (kit: ShipSkills) =>
    kit.slots.flatMap((s) =>
        s.abilities.filter((a) => a.config.type === 'modifier' && a.config.channel === 'defense')
    );

/** What the carrier takes from one 100% hit by a 6,000-attack hitter that never crits. */
const takenFromOneHit = (placement: Placement, kit: ShipSkills, defence: number): number => {
    const carrier: BoardUnit = { id: 'carrier', kit, position: 'M4', speed: 1, defence, hp: 1e9 };
    const hitter: BoardUnit = {
        id: 'hitter',
        kit: hitKit(100),
        position: 'M4',
        speed: 300,
        attack: 6_000,
        hacking: 1e6,
    };
    const { input, id } = boardInput(placement, carrier, [], [hitter], 1);
    const bus = createEventBus();
    let taken = 0;
    bus.on('attacked', (e: Extract<CombatEvent, { type: 'attacked' }>) => {
        if (e.targetId === id(carrier)) taken += e.takenDamage ?? e.damage ?? 0;
    });
    runCombat({ ...input, bus });
    return taken;
};

describe('static self-stat passive: the kit mints nothing for the clause', () => {
    it.each(CARRIERS)('%s refit passive carries no defense modifier', (ship) => {
        const rows = getShipSkillRows(buildTraceShip(ship, { refitLevel: 4 })!);
        expect(rows.find((r) => r.label === 'Passive R2')?.text).toMatch(/defense/i);
        expect(defenceModifiers(realKit(ship))).toEqual([]);
    });

    it("keeps the rest of each passive: Grif's cleanse proc and Hermes's crit-repair cleanse", () => {
        const grif = passiveOnly(realKit('Grif')).slots.flatMap((s) => s.abilities);
        expect(grif.some((a) => a.trigger === 'on-enemy-cleansed' && a.type === 'damage')).toBe(
            true
        );
        const hermes = passiveOnly(realKit('Hermes')).slots.flatMap((s) => s.abilities);
        expect(hermes.some((a) => a.type === 'cleanse')).toBe(true);
    });
});

describe.each<Placement>(['player', 'enemy'])(
    'static self-stat passive on the %s side',
    (placement) => {
        it.each(CARRIERS)('%s takes what a dummy at his printed defence takes', (ship) => {
            const printed = takenFromOneHit(placement, NO_KIT, DEFENCE);
            const raised = takenFromOneHit(placement, NO_KIT, DEFENCE * 1.2);
            const carrier = takenFromOneHit(placement, passiveOnly(realKit(ship)), DEFENCE);
            // The control arms differ, so the equality below is not vacuous.
            expect(raised).toBeLessThan(printed);
            expect(carrier).toBeCloseTo(printed, 6);
        });
    }
);

describe('reference ships carry the passive stat exactly once (#785)', () => {
    const catalogueRows = (name: string): AscensionStat[] => {
        const units = JSON.parse(readFileSync(CATALOGUE, 'utf8')).units as {
            name: string;
            ascensionStats: AscensionStat[];
        }[];
        return units.find((u) => u.name === name)!.ascensionStats;
    };
    const deps = { getGearPiece: () => undefined, getEngineeringStatsForShipType: () => undefined };
    const isPassiveRow = (r: AscensionStat) =>
        r.level === 2 && r.attribute === 'Defense' && r.type === 'Percentage';

    it.each(CARRIERS)('%s refitted: the stat block holds the +20%, the kit adds none', (ship) => {
        const template = buildTraceShip(ship, { refitLevel: 0 })!;
        const rows = catalogueRows(ship);
        expect(rows.filter(isPassiveRow).map((r) => r.value)).toEqual([0.2]);

        const refitted = referenceShip(template, 'refitted', rows);
        const withoutPassiveRow = referenceShip(
            template,
            'refitted',
            rows.filter((r) => !isPassiveRow(r))
        );
        const gained =
            shipFinalStats(refitted, deps).defence -
            shipFinalStats(withoutPassiveRow, deps).defence;
        expect(gained).toBeCloseTo(template.baseStats.defence * 0.2, 6);

        expect(
            getShipSkillRows(refitted).some((r) =>
                /defense is increased by|increases its defense by/i.test(r.text)
            )
        ).toBe(true);
        expect(defenceModifiers(buildShipAbilities(refitted))).toEqual([]);
    });

    it.each(CARRIERS)('%s r0: neither the stats nor the kit carry it', (ship) => {
        const template = buildTraceShip(ship, { refitLevel: 0 })!;
        const r0 = referenceShip(template, 'r0', catalogueRows(ship));
        expect(getShipSkillRows(r0).map((r) => r.label)).toContain('Passive R0');
        expect(
            getShipSkillRows(r0).some((r) =>
                /defense is increased by|increases its defense by/i.test(r.text)
            )
        ).toBe(false);
        expect(shipFinalStats(r0, deps).defence).toBeCloseTo(template.baseStats.defence, 6);
        expect(defenceModifiers(buildShipAbilities(r0))).toEqual([]);
    });
});
