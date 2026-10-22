/* eslint-disable no-console */
import { loadShipSkillRecords, csvAvailable } from './shipSkillCsv';
import { loadShipDataByName, shipDataAvailable } from './shipDataSnapshot';
import { buildTraceShip } from './traceShipFactory';
import { tagShip } from '../../src/utils/combat/audit/classes';
import type { TaggedShip } from '../../src/utils/combat/audit/compose';

/** The tagged ship corpus `composeBattle` draws from — same pattern as compose.test.ts's
 *  buildTaggedCorpus: names collected from BOTH the CSV and the snapshot (de-duped
 *  case-insensitively), resolved via buildTraceShip, and names that resolve from neither source
 *  dropped. Exits the process when the gitignored reference data is missing. */
export function loadTaggedCorpus(): TaggedShip[] {
    if (!csvAvailable() || !shipDataAvailable()) {
        console.error(
            'docs/ship-skills.csv and/or docs/ship-data.json are missing from this worktree ' +
                '(gitignored reference data) — cannot build the ship corpus.'
        );
        process.exit(1);
    }
    const namesByUpper = new Map<string, string>();
    for (const r of loadShipSkillRecords()) namesByUpper.set(r.name.toUpperCase(), r.name);
    for (const [upper, data] of loadShipDataByName()) {
        if (!namesByUpper.has(upper)) namesByUpper.set(upper, data.name);
    }
    const tagged: TaggedShip[] = [];
    for (const name of namesByUpper.values()) {
        const ship = buildTraceShip(name);
        if (!ship) continue;
        tagged.push({ ship, classes: tagShip(ship) });
    }
    return tagged;
}
