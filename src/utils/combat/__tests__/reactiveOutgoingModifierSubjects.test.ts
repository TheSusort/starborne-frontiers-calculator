/**
 * Corpus census for `reactiveOutgoingModifiersOf`: a ship whose reactive damage proc could read
 * one of its own passive `outgoingDamage` modifiers, but whose modifier is gated on a subject a
 * reactive hit does not answer (`REACTIVE_OUTGOING_SUBJECTS`), so the proc leaves it out. A new
 * ship landing here needs its subject supplied live in `reactivePassiveOutgoingPct` (engine.ts)
 * or an owner ruling that the proc ignores it.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { buildShipAbilitiesWithEquipment } from '../../abilities/buildShipAbilitiesWithEquipment';
import { REACTIVE_OUTGOING_SUBJECTS, reactiveOutgoingModifiersOf } from '../effectiveStats';

beforeAll(() => {
    if (!csvAvailable()) throw new Error('docs/ship-skills.csv is required');
});

const census = () => {
    const folded = new Set<string>();
    const leftOut = new Set<string>();
    for (const rec of loadShipSkillRecords()) {
        for (const refitLevel of [0, 2, 4] as const) {
            const ship = buildTraceShip(rec.name, { refitLevel });
            if (!ship) continue;
            const skills = buildShipAbilitiesWithEquipment(ship, () => undefined);
            const hasReactiveDamage = skills.slots.some((s) =>
                s.abilities.some((a) => a.config.type === 'damage' && a.trigger !== 'on-cast')
            );
            if (!hasReactiveDamage) continue;
            const ownOutgoing = (
                skills.slots.find((s) => s.slot === 'passive')?.abilities ?? []
            ).filter(
                (a) =>
                    a.type === 'modifier' &&
                    a.target === 'self' &&
                    a.source !== 'equipment' &&
                    a.config.type === 'modifier' &&
                    a.config.channel === 'outgoingDamage'
            );
            const kept = reactiveOutgoingModifiersOf(skills);
            if (kept.length > 0) folded.add(rec.name);
            if (ownOutgoing.length > kept.length) leftOut.add(rec.name);
        }
    }
    return { folded: [...folded].sort(), leftOut: [...leftOut].sort() };
};

describe('reactive proc passive damage modifiers over the corpus', () => {
    const { folded, leftOut } = census();

    it('folds Judge’s destroyed-enemy bonus into his start-of-round hit', () => {
        expect(folded).toEqual(['Judge']);
    });

    // Incinerator: "30% more direct damage to enemies afflicted with Inferno" gates on the
    // victim's debuffs; his end-of-round hit has no ruling yet.
    it('leaves out exactly the modifiers gated on an unanswered subject', () => {
        expect(leftOut).toEqual(['Incinerator']);
        expect([...REACTIVE_OUTGOING_SUBJECTS]).toEqual(['enemy-destroyed']);
    });
});
