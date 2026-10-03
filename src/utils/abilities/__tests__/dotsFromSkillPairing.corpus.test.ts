/**
 * `dotsFromSkill` maps a skill's `dot` abilities in order, one entry each. The cast path relies on
 * it: playerTurn's covered-victim DoT loop pairs the i-th `dotsConfig` entry with the i-th `dot`
 * ability of the firing slot to read that DoT's target. If a change to `dotsFromSkill` (or to what
 * the parser emits) breaks the 1:1 order, a DoT would fan out under ANOTHER clause's target — this
 * suite fails first.
 *
 * Every ship × slot in docs/ship-skills.csv (refit 4, real parsed kits).
 */
import { describe, it, expect } from 'vitest';
import { buildShipAbilities } from '../buildShipAbilities';
import { dotsFromSkill } from '../applyAbilities';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import type { Ship } from '../../../types/ship';

describe.skipIf(!csvAvailable() || !shipDataAvailable())(
    'dotsFromSkill maps the skill’s dot abilities in order, one entry each (corpus)',
    () => {
        it('every ship × slot: entry i is dot ability i (same dotType, tier, stacks, duration)', () => {
            const mismatches: string[] = [];
            let paired = 0;
            for (const rec of loadShipSkillRecords()) {
                const ship = buildTraceShip(rec.name, { refitLevel: 4 }) as Ship | undefined;
                if (!ship) continue;
                for (const skill of buildShipAbilities(ship).slots) {
                    const dotAbilities = skill.abilities.flatMap((ab) =>
                        ab.type === 'dot' && ab.config.type === 'dot' ? [ab.config] : []
                    );
                    const entries = dotsFromSkill(skill).map((d) => ({
                        dotType: d.type,
                        tier: d.tier,
                        stacks: d.stacks,
                        duration: d.duration,
                    }));
                    const expected = dotAbilities.map((c) => ({
                        dotType: c.dotType,
                        tier: c.tier,
                        stacks: c.stacks,
                        duration: c.duration,
                    }));
                    if (JSON.stringify(entries) !== JSON.stringify(expected))
                        mismatches.push(`${rec.name}/${skill.slot}`);
                    paired += expected.length;
                }
            }
            expect(mismatches).toEqual([]);
            // Non-vacuity: the corpus carries dozens of DoT clauses (every firing-slot DoT ship).
            expect(paired).toBeGreaterThan(40);
        });
    }
);
