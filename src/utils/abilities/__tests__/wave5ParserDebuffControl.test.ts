import { describe, it, expect } from 'vitest';
import { buildShipAbilities } from '../buildShipAbilities';
import { Ship } from '../../../types/ship';
import { Ability, Skill } from '../../../types/abilities';
import {
    csvAvailable,
    loadShipSkillRecords,
    ShipSkillRecord,
} from '../../../../scripts/lib/shipSkillCsv';

/**
 * Task A2 (ship-kit correctness audit, Wave 5) — the parser must recognise enemy-adjacency
 * phrasing ("all enemies adjacent to X") and route debuff + control abilities to the new
 * `adjacent-enemies` / `target-and-adjacent-enemies` AbilityTarget scopes, WITHOUT wrongly
 * widening a sibling single-target debuff that shares the same sentence (Asphyxiator's Defense
 * Down III + Inferno III, joined by "then"). Each test runs the ship's VERBATIM
 * docs/ship-skills.csv slot text through the production `buildShipAbilities` build so the bug
 * is only visible at the full multi-sentence level. Skips gracefully when the gitignored
 * reference CSV is absent (clean checkout / CI).
 */

function ship(over: Partial<Ship>): Ship {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ...({} as any), refits: [{}, {}, {}, {}], ...over } as Ship;
}

function slot(skills: Skill[], name: string): Skill | undefined {
    return skills.find((s) => s.slot === name);
}

function abilitiesOfType(abilities: Ability[], type: string): Ability[] {
    return abilities.filter((a) => a.type === type);
}

function recordFor(name: string): ShipSkillRecord {
    const rec = loadShipSkillRecords().find((r) => r.name.toUpperCase() === name.toUpperCase());
    if (!rec) throw new Error(`docs/ship-skills.csv: no record found for "${name}"`);
    return rec;
}

describe.skipIf(!csvAvailable())(
    'Task A2 — parser enemy-adjacency scope for debuffs + control (verbatim docs/ship-skills.csv)',
    () => {
        it('Asphyxiator active: Defense Down III stays enemy (must NOT widen via the same-sentence Inferno adjacency clause)', () => {
            const rec = recordFor('Asphyxiator');
            const { slots } = buildShipAbilities(ship({ activeSkillText: rec.active }));
            const active = slot(slots, 'active')!;
            expect(active).toBeDefined();

            const dd = abilitiesOfType(active.abilities, 'debuff').find(
                (a) => a.config.type === 'debuff' && a.config.buffName === 'Defense Down III'
            );
            expect(dd).toBeDefined();
            expect(dd?.target).toBe('enemy');
        });

        it('Asphyxiator charged: Inc. DoT Damage Up III stays enemy', () => {
            const rec = recordFor('Asphyxiator');
            const { slots } = buildShipAbilities(
                ship({ chargeSkillText: rec.charge, chargeSkillCharge: rec.chargeCharge })
            );
            const charged = slot(slots, 'charged')!;
            expect(charged).toBeDefined();

            const dotUp = abilitiesOfType(charged.abilities, 'debuff').find(
                (a) => a.config.type === 'debuff' && a.config.buffName === 'Inc. DoT Damage Up III'
            );
            expect(dotUp).toBeDefined();
            expect(dotUp?.target).toBe('enemy');
        });

        it('Asphyxiator charged: Stasis debuff scopes to target-and-adjacent-enemies and keeps its >=3 enemy-debuff condition', () => {
            const rec = recordFor('Asphyxiator');
            const { slots } = buildShipAbilities(
                ship({ chargeSkillText: rec.charge, chargeSkillCharge: rec.chargeCharge })
            );
            const charged = slot(slots, 'charged')!;
            expect(charged).toBeDefined();

            const stasis = abilitiesOfType(charged.abilities, 'debuff').find(
                (a) => a.config.type === 'debuff' && a.config.buffName === 'Stasis'
            );
            expect(stasis).toBeDefined();
            expect(stasis?.target).toBe('target-and-adjacent-enemies');

            const gate = stasis?.conditions?.find(
                (c) => c.subject === 'enemy-debuff' && c.countThreshold === 3
            );
            expect(gate).toBeDefined();
            expect(gate?.countComparator).toBe('gte');
        });

        it('Asphyxiator charged: Stasis control ability scopes to target-and-adjacent-enemies', () => {
            const rec = recordFor('Asphyxiator');
            const { slots } = buildShipAbilities(
                ship({ chargeSkillText: rec.charge, chargeSkillCharge: rec.chargeCharge })
            );
            const charged = slot(slots, 'charged')!;
            expect(charged).toBeDefined();

            const stasisControl = abilitiesOfType(charged.abilities, 'control').find(
                (a) => a.config.type === 'control' && a.config.effect === 'stasis'
            );
            expect(stasisControl).toBeDefined();
            expect(stasisControl?.target).toBe('target-and-adjacent-enemies');
        });

        it('Vindicator active: Provoke debuff scopes to adjacent-enemies', () => {
            const rec = recordFor('Vindicator');
            const { slots } = buildShipAbilities(ship({ activeSkillText: rec.active }));
            const active = slot(slots, 'active')!;
            expect(active).toBeDefined();

            const provoke = abilitiesOfType(active.abilities, 'debuff').find(
                (a) => a.config.type === 'debuff' && a.config.buffName === 'Provoke'
            );
            expect(provoke).toBeDefined();
            expect(provoke?.target).toBe('adjacent-enemies');
        });

        it('Vindicator active: Provoke control ability scopes to adjacent-enemies', () => {
            const rec = recordFor('Vindicator');
            const { slots } = buildShipAbilities(ship({ activeSkillText: rec.active }));
            const active = slot(slots, 'active')!;
            expect(active).toBeDefined();

            const provokeControl = abilitiesOfType(active.abilities, 'control').find(
                (a) => a.config.type === 'control' && a.config.effect === 'provoke'
            );
            expect(provokeControl).toBeDefined();
            expect(provokeControl?.target).toBe('adjacent-enemies');
        });

        it('Vindicator charged: Corrosion II stays enemy (must NOT widen via the sibling Out. Damage Down I adjacency clause)', () => {
            // Corrosion II is a DoT (DOT_TIER_MAP), built by dotAbility() as type:'dot' with a
            // hard-coded target:'enemy' — untouched by this task's parser change (DoT adjacency
            // is a later task). Asserted here as a smoke check that the sibling Out. Damage Down I
            // adjacency clause in the same charge text doesn't leak into it.
            const rec = recordFor('Vindicator');
            const { slots } = buildShipAbilities(
                ship({ chargeSkillText: rec.charge, chargeSkillCharge: rec.chargeCharge })
            );
            const charged = slot(slots, 'charged')!;
            expect(charged).toBeDefined();

            const corrosion = abilitiesOfType(charged.abilities, 'dot').find(
                (a) =>
                    a.config.type === 'dot' &&
                    a.config.dotType === 'corrosion' &&
                    a.config.tier === 6
            );
            expect(corrosion).toBeDefined();
            expect(corrosion?.target).toBe('enemy');
        });

        it('Vindicator charged: Out. Damage Down I scopes to adjacent-enemies', () => {
            const rec = recordFor('Vindicator');
            const { slots } = buildShipAbilities(
                ship({ chargeSkillText: rec.charge, chargeSkillCharge: rec.chargeCharge })
            );
            const charged = slot(slots, 'charged')!;
            expect(charged).toBeDefined();

            const damageDown = abilitiesOfType(charged.abilities, 'debuff').find(
                (a) => a.config.type === 'debuff' && a.config.buffName === 'Out. Damage Down I'
            );
            expect(damageDown).toBeDefined();
            expect(damageDown?.target).toBe('adjacent-enemies');
        });
    }
);
