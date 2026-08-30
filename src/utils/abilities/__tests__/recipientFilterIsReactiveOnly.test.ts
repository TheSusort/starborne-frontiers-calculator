/**
 * STANDING GUARD: `Ability.recipientFilter` is honoured on the REACTIVE path only.
 *
 * It is intersected in exactly one place — `footprintFilteredRecipients` (triggers.ts). The four
 * seams `factionFilter` runs at do NOT read it. That is fine today because both corpus clauses
 * carrying the field (Chimei's R2) are live-triggered, so the field is never on an ability that
 * takes another route.
 *
 * "Fine today" is a MEASUREMENT, and a measurement decays. The two detectors behind the field
 * (`detectGrantRecipientFilter` / `detectRecipientFilter`) run over active and charged rows too,
 * so a future skill-text edit — a new ship, or a reworded existing one — can attach the field to
 * an `on-cast` ability, where it would be silently ignored and the grant would reach every ally
 * the clause meant to exclude. Nothing else in the suite would notice: the ability parses, the
 * grant lands, and only the recipient SET is wrong.
 *
 * So this asserts the precondition rather than trusting it. If it fails, the choice is to wire the
 * cast-path seams or to narrow the detector — not to relax this test.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { buildShipAbilities } from '../buildShipAbilities';
import { LIVE_TRIGGERS, type AbilityTrigger } from '../../../types/abilities';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';
import { Ship } from '../../../types/ship';

function requireReferenceData(): void {
    if (!csvAvailable()) {
        throw new Error(
            'docs/ship-skills.csv is missing from this worktree (gitignored reference data) — ' +
                'this census walks every ship in it.'
        );
    }
}

/** Every ability in the corpus that carries a `recipientFilter`, with its ship and trigger. */
function carriers(): { ship: string; trigger: AbilityTrigger; buffOrType: string }[] {
    return loadShipSkillRecords().flatMap((rec) => {
        const abilities = buildShipAbilities({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ...({} as any),
            refits: [{}, {}, {}, {}],
            activeSkillText: rec.active,
            chargeSkillText: rec.charge,
            chargeSkillCharge: rec.chargeCharge,
            firstPassiveSkillText: rec.passives[0],
            secondPassiveSkillText: rec.passives[1],
            thirdPassiveSkillText: rec.passives[2],
        } as Ship);
        return abilities.slots
            .flatMap((s) => s.abilities)
            .filter((a) => a.recipientFilter !== undefined)
            .map((a) => ({
                ship: rec.name,
                trigger: a.trigger,
                buffOrType: a.config.type === 'buff' ? a.config.buffName : a.config.type,
            }));
    });
}

describe('recipientFilter carriers ride live triggers', () => {
    beforeAll(requireReferenceData);

    // Non-vacuity: an empty census would satisfy the assertion below without observing anything.
    it('the corpus actually has carriers to check', () => {
        expect(carriers().length).toBeGreaterThan(0);
    });

    it('every carrier rides a LIVE trigger — none is on the cast path', () => {
        const castPath = carriers().filter((c) => !LIVE_TRIGGERS.has(c.trigger));
        expect(castPath).toEqual([]);
    });
});
