/**
 * STANDING GUARD: every `Ability.recipientFilter` carrier rides a seam that honours it.
 *
 * The filter is intersected in exactly two places: `footprintFilteredRecipients` (triggers.ts,
 * the REACTIVE path — Chimei's R2) and playerTurn's per-slot timed loop (the CAST path's timed
 * grants — Hermes's charged Cheat Death). The other seams `factionFilter` runs at (the aura /
 * accumulating registration fan-out, the passive-slot combat-start seed) and the cast heal /
 * shield pass do NOT read it, and the cast-path seam has no role reader, so a `notRole` axis
 * there would exclude every recipient.
 *
 * "Every carrier is on a wired seam" is a MEASUREMENT, and a measurement decays. The detectors
 * behind the field (`detectGrantRecipientFilter` / `detectRecipientFilter`, and the Cheat-Death
 * HP gate in buildShipAbilities' `targetGate`) run over every slot, so a future skill-text edit
 * can attach the field to an ability that takes an unwired route, where it would be silently
 * ignored and the grant would reach every ally the clause meant to exclude.
 *
 * So this asserts the precondition rather than trusting it. If it fails, the choice is to wire the
 * missing seam or to narrow the detector — not to relax this test.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { buildShipAbilities } from '../buildShipAbilities';
import { LIVE_TRIGGERS, type Ability, type SkillSlot } from '../../../types/abilities';
import { CHEAT_DEATH_BUFFS } from '../../combat/cheatDeathBuffs';
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

/** Every ability in the corpus that carries a `recipientFilter`, with its ship and slot. */
function carriers(): { ship: string; slot: SkillSlot; ability: Ability }[] {
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
        return abilities.slots.flatMap((s) =>
            s.abilities
                .filter((a) => a.recipientFilter !== undefined)
                .map((ability) => ({ ship: rec.name, slot: s.slot, ability }))
        );
    });
}

const isLive = (a: Ability) => LIVE_TRIGGERS.has(a.trigger);

/** A firing-slot buff that the engine registers as a TIMED by-slot status — the only cast-path
 *  route that reads `recipientFilter` (engine.ts `registerActorAbilityStatuses`: not
 *  accumulating, and either a Cheat-Death-family grant or a finite duration). */
const isTimedCastGrant = (slot: SkillSlot, a: Ability): boolean => {
    if (slot !== 'active' && slot !== 'charged') return false;
    const cfg = a.config;
    if (cfg.type !== 'buff') return false;
    if (cfg.stackTrigger && cfg.isStackable) return false;
    return CHEAT_DEATH_BUFFS.has(cfg.buffName) || typeof cfg.duration === 'number';
};

const label = (c: { ship: string; slot: SkillSlot; ability: Ability }) =>
    `${c.ship}:${c.slot}:${c.ability.config.type}|${c.ability.trigger}`;

describe('recipientFilter carriers ride a wired seam', () => {
    beforeAll(requireReferenceData);

    // Non-vacuity, one per seam: an empty census of either kind would satisfy the assertion below
    // without observing anything.
    it('the corpus has carriers on both seams to check', () => {
        expect(carriers().filter((c) => isLive(c.ability)).length).toBeGreaterThan(0);
        expect(carriers().filter((c) => !isLive(c.ability)).length).toBeGreaterThan(0);
    });

    it('every cast-path carrier is a timed firing-slot grant with no role axis', () => {
        const unwired = carriers().filter(
            (c) =>
                !isLive(c.ability) &&
                (!isTimedCastGrant(c.slot, c.ability) ||
                    c.ability.recipientFilter?.notRole !== undefined)
        );
        expect(unwired.map(label)).toEqual([]);
    });
});
