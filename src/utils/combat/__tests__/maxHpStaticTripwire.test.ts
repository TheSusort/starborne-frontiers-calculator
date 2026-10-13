/**
 * Max HP is static for the whole fight (owner ruling D, #658).
 *
 * No buff, debuff, modifier or gear effect changes a ship's max HP mid-fight. The only things that
 * move it are Lionheart's pre-combat passive (`preCombatPassives.ts`) and squad leaders
 * (`preFight/squadLeaderPass.ts`), and both fold into base stats BEFORE any actor is built. The
 * engine therefore reads max HP from one place: the actor's post-prefight `stats.hp` (`maxHpOf` in
 * engine.ts), with no buff fold.
 *
 * This file is the census that makes that read correct. It asks every producer that COULD carry
 * an HP-stat change, through the producer's own code path, and requires zero:
 *   1. named statuses — every `BUFFS` description through `parseBuffEffects` (the source of every
 *      `parsedEffects.hp`, which `toSimBuffs` turns into a `stat: 'hp'` buff);
 *   2. ship kits — every corpus ship at refit 0, 2 and 4 through `buildShipAbilities`: no
 *      `modifier` on the `hp` channel, no buff/debuff (or additional buff) carrying `hp`;
 *   3. equipment — every gear set and every implant variant through `buildEquipmentAbilities`;
 *   4. the non-named `extras` terms of the damage fold — the enemy-applied shadow channels and the
 *      squad-leader `preFight` block carry no `hp` channel;
 *   5. a pre-combat stat grant cannot fire mid-fight, and a real-kit run leaves every actor's
 *      `stats.hp` untouched.
 * If any of these goes red, a mid-fight max-HP change exists and the static read is wrong: the
 * ruling has to be revisited before the producer ships.
 *
 * Needs the gitignored reference data (`docs/ship-skills.csv`, `docs/ship-data.json`) — it throws
 * rather than passing vacuously without it.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { BUFFS } from '../../../constants/buffs';
import { GEAR_SETS } from '../../../constants/gearSets';
import { IMPLANTS } from '../../../constants/implants';
import { LIVE_TRIGGERS } from '../../../types/abilities';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { GearPiece } from '../../../types/gear';
import type { Ship } from '../../../types/ship';
import { parseBuffEffects } from '../../calculators/buffParser';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { buildEquipmentAbilities } from '../../abilities/buildEquipmentAbilities';
import { corpusNames } from '../audit/kitFingerprintScenarios';
import { FOLD_SHADOW_CHANNELS } from '../buffTotals';
import { TURN_SHADOW_CHANNELS } from '../triggers';
import { emptyPreFightModifiers } from '../preFight/types';
import { runCombat } from '../engine';
import type { CombatActor } from '../state';
import { bareInput, attackingEnemy } from '../__testutils__/bareRosterFixture';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';

const RULING =
    'Owner ruling D (#658): no buff, debuff, modifier or gear effect changes max HP mid-fight, ' +
    'so the engine reads max HP statically (maxHpOf). A producer found here breaks that read';

function requireReferenceData(): void {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'docs/ship-skills.csv and/or docs/ship-data.json are missing from this worktree ' +
                '(gitignored reference data) — the max-HP census needs the real ship kits.'
        );
    }
}

/** Every way one ability can carry a mid-fight HP-stat change, as a label (empty when none). */
function hpProducersIn(ability: Ability): string[] {
    const cfg = ability.config;
    const found: string[] = [];
    if (cfg.type === 'modifier' && cfg.channel === 'hp') found.push('modifier channel hp');
    if ((cfg.type === 'buff' || cfg.type === 'debuff') && cfg.parsedEffects.hp !== undefined)
        found.push(`${cfg.type} ${cfg.buffName} parsedEffects.hp`);
    if (cfg.type === 'buff')
        for (const extra of cfg.additionalBuffs ?? [])
            if (extra.parsedEffects.hp !== undefined)
                found.push(`additional buff ${extra.buffName} parsedEffects.hp`);
    if (cfg.type === 'pre-combat-stat' && LIVE_TRIGGERS.has(ability.trigger))
        found.push(`pre-combat-stat on live trigger ${ability.trigger}`);
    if (cfg.type === 'pre-combat-stat' && ability.trigger !== 'pre-combat')
        found.push(`pre-combat-stat on trigger ${ability.trigger}`);
    return found.map((f) => `${ability.id}: ${f}`);
}

const allAbilities = (skills: ShipSkills): Ability[] => skills.slots.flatMap((s) => s.abilities);

describe('max HP static tripwire (ruling D, #658)', () => {
    it('no named status in BUFFS parses to an HP-stat change', () => {
        expect(BUFFS.length).toBeGreaterThan(100);
        const producers = BUFFS.filter(
            (b) => parseBuffEffects(b.name, b.description).hp !== undefined
        ).map((b) => `${b.name}: "${b.description}"`);
        expect(producers, `${RULING}: ${producers.join('; ')}`).toEqual([]);
    });

    describe('ship kits', () => {
        beforeAll(requireReferenceData);

        it('no corpus ship kit, at any refit level, carries an HP-stat change', () => {
            const names = corpusNames();
            expect(names.length).toBeGreaterThan(100);
            const producers: string[] = [];
            let abilityCount = 0;
            for (const name of names) {
                for (const refitLevel of [0, 2, 4] as const) {
                    const ship = buildTraceShip(name, { refitLevel });
                    expect(ship, `${name} did not resolve from the corpus`).not.toBeNull();
                    const abilities = allAbilities(buildShipAbilities(ship!));
                    abilityCount += abilities.length;
                    for (const ability of abilities)
                        for (const p of hpProducersIn(ability))
                            producers.push(`${name} R${refitLevel} ${p}`);
                }
            }
            // The census only means something if it walked real kits.
            expect(abilityCount).toBeGreaterThan(1000);
            expect(producers, `${RULING}: ${producers.join('; ')}`).toEqual([]);
        });
    });

    it('no gear set or implant variant carries an HP-stat change', () => {
        const pieces = new Map<string, GearPiece>();
        const piece = (id: string, setBonus: string, rarity: GearPiece['rarity']): string => {
            pieces.set(id, {
                id,
                slot: 'weapon',
                level: 16,
                stars: 6,
                rarity,
                mainStat: null,
                subStats: [],
                setBonus,
            });
            return id;
        };
        const ship = (equipment: Record<string, string>, implants: Record<string, string>): Ship =>
            ({
                id: 'tripwire',
                name: 'Tripwire',
                equipment,
                implants,
                refits: [],
            }) as unknown as Ship;
        const producers: string[] = [];
        let abilityCount = 0;
        const audit = (label: string, s: Ship) => {
            const abilities = buildEquipmentAbilities(s, (id) => pieces.get(id));
            abilityCount += abilities.length;
            for (const ability of abilities)
                for (const p of hpProducersIn(ability)) producers.push(`${label} ${p}`);
        };
        // One to three complete sets of every gear set (six slots of a 2-piece set is three).
        for (const setName of Object.keys(GEAR_SETS)) {
            for (const count of [1, 2, 3, 4, 5, 6]) {
                const equipment: Record<string, string> = {};
                for (let i = 0; i < count; i++)
                    equipment[`slot${i}`] = piece(`${setName}-${count}-${i}`, setName, 'legendary');
                audit(`set ${setName} x${count}`, ship(equipment, {}));
            }
        }
        // Every implant at every rarity it ships in.
        for (const [implantName, data] of Object.entries(IMPLANTS)) {
            for (const variant of data.variants) {
                const id = piece(`${implantName}-${variant.rarity}`, implantName, variant.rarity);
                audit(`implant ${implantName} ${variant.rarity}`, ship({}, { implant: id }));
            }
        }
        expect(abilityCount).toBeGreaterThan(50);
        expect(producers, `${RULING}: ${producers.join('; ')}`).toEqual([]);
    });

    it('the non-named extras of the damage fold have no HP channel', () => {
        // `extras` in playerTurn's damage fold is built from exactly these two sources: the
        // enemy-applied shadow delta (TURN_SHADOW_CHANNELS) and the squad-leader preFight block.
        // The foldActorBuffTotals shadow (FOLD_SHADOW_CHANNELS) is the status-mode counterpart.
        expect(TURN_SHADOW_CHANNELS as readonly string[], RULING).not.toContain('hp');
        expect(FOLD_SHADOW_CHANNELS as readonly string[], RULING).not.toContain('hp');
        expect(Object.keys(emptyPreFightModifiers()), RULING).not.toContain('hp');
    });

    it('a pre-combat stat grant never rides a live trigger', () => {
        expect(LIVE_TRIGGERS.has('pre-combat'), RULING).toBe(false);
    });

    describe('real-kit runs', () => {
        beforeAll(requireReferenceData);

        it("no corpus kit changes any actor's stats.hp during a fight, on either side", () => {
            const changed: string[] = [];
            let runs = 0;
            for (const name of corpusNames()) {
                const ship = buildTraceShip(name);
                if (!ship) continue;
                const kit = buildShipAbilities(ship);
                const chargeCount = ship.chargeSkillCharge ?? 0;
                const hasChargedSkill = kit.slots.some((s) => s.slot === 'charged');
                let actors: CombatActor[] = [];
                let before = new Map<string, number>();
                runCombat({
                    ...bareInput(),
                    shipSkills: kit,
                    chargeCount,
                    hasChargedSkill,
                    numRounds: 4,
                    enemyAttackers: attackingEnemy({
                        shipSkills: buildShipAbilities(ship),
                        chargeCount,
                    }),
                    // Fires once, at actor construction: the post-prefight figure.
                    __testTapActors: (a) => {
                        actors = a;
                        before = new Map(a.map((x) => [x.id, x.stats.hp]));
                    },
                });
                expect(before.size).toBeGreaterThan(1);
                runs++;
                // The tap hands out the live actor objects, so re-reading them after the run sees
                // any write the fight made.
                for (const a of actors)
                    if (a.stats.hp !== before.get(a.id))
                        changed.push(`${name}: ${a.id} ${before.get(a.id)} -> ${a.stats.hp}`);
            }
            expect(runs).toBeGreaterThan(100);
            expect(changed, `${RULING}: ${changed.join('; ')}`).toEqual([]);
        });
    });
});
