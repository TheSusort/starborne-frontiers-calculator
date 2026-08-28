/* eslint-disable no-console */
/**
 * Corpus blast-radius audit for #391.
 *
 * Theoretical EHP (the Defense calculator's static hangar-stats estimate) used to count every
 * auto-filled kit buff as always-on, even when the buff's own grant is conditionally GATED
 * (e.g. Redeemer's "gains Defense Up II" only below 60% HP). Task 8 made `gatedAutoFilledBuffs`
 * detect this and drop those buffs from the figure; this script measures how many SHIPPED ships
 * that fix actually reaches — the vacuity check for the whole epic. An empty result here would
 * mean the fix is unreachable on real data.
 *
 * For every row in docs/ship-skills.csv: build the ship's abilities, run
 * `buildSkillBuffAutoFill`, call `gatedAutoFilledBuffs`, and report every ship whose
 * Theoretical-EHP-relevant buff (one whose `parsedEffects` carries `defense`, `incomingDamage`
 * or `security`) is gated — with the buff name, the gate reason, and the before/after
 * Theoretical EHP at a fixed 40,000 HP / 5,000 Defense reference.
 *
 * Only the REFIT-ACTIVE passive slot is live in-game at any one time (getShipSkillRows), keyed
 * off `ship.refits.length` (R0 < 2 refits, R2 at 2-3, R4 at 4+). To surface a gate on EVERY
 * passive tier — not just whichever one a single fixed refit count would happen to activate —
 * each ship is built three times, once per refit-count bucket, and results are deduped by the
 * grant's own id (stable across the three builds for active/charged; distinct per passive tier).
 *
 * Usage: npm run audit:gated-buffs
 */
import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';
import { buildShipAbilities } from '../src/utils/abilities/buildShipAbilities';
import { buildSkillBuffAutoFill } from '../src/utils/calculators/skillBuffAutoFill';
import {
    gatedAutoFilledBuffs,
    GatedBuff,
    GatedBuffsPageState,
    isEhpRelevant,
} from '../src/utils/calculators/gatedBuffs';
import { computeBuffedStats } from '../src/utils/calculators/defenseCalculator';
import { Ship } from '../src/types/ship';
import { DefenseBuffTotals, SelectedGameBuff } from '../src/types/calculator';
import { parseCsvLine, readCsvRecords, csvAvailable, CSV_PATH } from './lib/shipSkillCsv';

// The brief's fixed reference point, so the printed before/after figures are reproducible.
const REFERENCE_HP = 40_000;
const REFERENCE_DEFENSE = 5_000;

// This audit measures one ship in isolation — no team, no enemy, exactly the state a user sees
// on a fresh visit to the Defense calculator (`teamShips`/`enemies` both start empty). That
// means `lowest-speed-ally` gates (Chakara) resolve MET here — an empty ally roster makes the
// audited ship trivially the sole, and therefore lowest-Speed, actor, matching the engine's own
// `lowestSpeedIds()` semantics — while `enemy-debuff` gates (Asphyxiator/Bayah) stay unanswered
// (no enemy configured, so "the enemy's debuff count" has no referent) and so still drop, exactly
// as before this ruling. `selfSpeed` is inert with an empty ally roster (any value is trivially
// the minimum), so it is a placeholder, not a real ship stat.
const DEFAULT_GATE_STATE: GatedBuffsPageState = {
    selfSpeed: 100,
    allySpeeds: [],
    hasEnemy: false,
    enemyDebuffNames: [],
};
const auditGatedAutoFilledBuffs = (
    buffs: SelectedGameBuff[],
    shipSkills: ReturnType<typeof buildShipAbilities>
): GatedBuff[] => gatedAutoFilledBuffs(buffs, shipSkills, DEFAULT_GATE_STATE);

// One build per refit-count bucket, matching getShipSkillRows' own thresholds (R0/R2/R4).
const REFIT_BUCKETS = [0, 2, 4];

interface ShipRow {
    name: string;
    active: string;
    chargeCharge: number;
    charged: string;
    p1: string;
    p2: string;
    p3: string;
}

function readShipRows(): ShipRow[] {
    const records = readCsvRecords(readFileSync(CSV_PATH, 'utf8'));
    const rows: ShipRow[] = [];
    for (let i = 1; i < records.length; i++) {
        const f = parseCsvLine(records[i]);
        if (f.length < 7) continue;
        const [name, active, chargeCharge, charged, p1, p2, p3] = f;
        if (!name) continue;
        rows.push({
            name,
            active,
            chargeCharge: Number(chargeCharge) || 0,
            charged,
            p1,
            p2,
            p3,
        });
    }
    return rows;
}

function buildShipVariant(row: ShipRow, refitCount: number): Ship {
    return {
        id: row.name,
        name: row.name,
        rarity: 'LEGENDARY',
        faction: 'ATLAS_SYNDICATE',
        type: 'ATTACKER',
        baseStats: {
            hp: 0,
            attack: 0,
            defence: 0,
            hacking: 0,
            security: 0,
            crit: 0,
            critDamage: 0,
            speed: 0,
        },
        equipment: {},
        implants: {},
        refits: Array.from({ length: refitCount }, (_, i) => ({ id: `r${i}`, stats: [] })),
        activeSkillText: row.active,
        chargeSkillText: row.charged,
        chargeSkillCharge: row.chargeCharge,
        firstPassiveSkillText: row.p1,
        secondPassiveSkillText: row.p2,
        thirdPassiveSkillText: row.p3,
    };
}

function sumBuffTotals(buffs: SelectedGameBuff[]): DefenseBuffTotals {
    return {
        defenseBuff: buffs.reduce((s, b) => s + (b.parsedEffects.defense ?? 0) * b.stacks, 0),
        incomingDamageBuff: buffs.reduce(
            (s, b) => s + (b.parsedEffects.incomingDamage ?? 0) * b.stacks,
            0
        ),
        securityBuff: buffs.reduce((s, b) => s + (b.parsedEffects.security ?? 0) * b.stacks, 0),
    };
}

export interface GatedBuffFinding {
    ship: string;
    buffName: string;
    reason: string;
    beforeEHP: number;
    afterEHP: number;
}

/**
 * Pure pass: every Theoretical-EHP-relevant gated-buff finding across the corpus, deduped by
 * (ship, grant id) so a passive grant visible under more than one refit bucket (it isn't — only
 * one bucket ever activates a given passive tier's text — but active/charged text IS re-seen in
 * every bucket) is reported once.
 *
 * `gatePredicate` defaults to "real gate" (`gatedAutoFilledBuffs`'s own definition) but can be
 * widened for the reachability self-check below — see `run()`.
 */
export function collectFindings(
    gatedOf: (
        buffs: SelectedGameBuff[],
        shipSkills: ReturnType<typeof buildShipAbilities>
    ) => GatedBuff[] = auditGatedAutoFilledBuffs
): { findings: GatedBuffFinding[]; shipCount: number } {
    const rows = readShipRows();
    const findings: GatedBuffFinding[] = [];
    const seenIds = new Set<string>();

    for (const row of rows) {
        for (const refitCount of REFIT_BUCKETS) {
            const ship = buildShipVariant(row, refitCount);
            const shipSkills = buildShipAbilities(ship);
            const { selfBuffs } = buildSkillBuffAutoFill(ship);
            const gated = gatedOf(selfBuffs, shipSkills);
            if (gated.length === 0) continue;

            const gatedIds = new Set(gated.map((g) => g.buffId));
            const beforeEHP = Math.round(
                computeBuffedStats(REFERENCE_HP, REFERENCE_DEFENSE, 0, sumBuffTotals(selfBuffs))
                    .effectiveHP
            );
            const afterEHP = Math.round(
                computeBuffedStats(
                    REFERENCE_HP,
                    REFERENCE_DEFENSE,
                    0,
                    sumBuffTotals(selfBuffs.filter((b) => !gatedIds.has(b.id)))
                ).effectiveHP
            );

            for (const g of gated) {
                // `SelectedGameBuff.id` is `${name}-${source}-${target}` — unique WITHIN a ship's
                // own grants, but not across ships, so the dedupe key must include the ship name.
                // Without it, a second ship whose kit happens to grant a same-named buff via the
                // same source/target shape would be silently swallowed as a "duplicate" of the
                // first ship's finding.
                const dedupeKey = `${row.name}::${g.buffId}`;
                if (seenIds.has(dedupeKey)) continue;
                const buff = selfBuffs.find((b) => b.id === g.buffId);
                if (!buff || !isEhpRelevant(buff)) continue;
                seenIds.add(dedupeKey);
                findings.push({
                    ship: row.name,
                    buffName: g.buffName,
                    reason: g.reason,
                    beforeEHP,
                    afterEHP,
                });
            }
        }
    }

    return { findings, shipCount: rows.length };
}

function run(): void {
    if (!csvAvailable()) {
        console.error(
            `${CSV_PATH} is missing from this worktree (gitignored reference data) — cannot audit.`
        );
        process.exit(1);
    }

    const { findings, shipCount } = collectFindings();

    console.log(`Audited ${shipCount} ships.\n`);

    if (findings.length === 0) {
        console.log('BLOCKED: no Theoretical-EHP-relevant gated buff found on any shipped ship.');
        console.log(
            'Running the reachability self-check: widening the gate predicate to "any condition ' +
                'at all, including always"...'
        );
        const widened = collectFindings((buffs, shipSkills) => {
            if (!shipSkills) return [];
            // Deliberately widened: count every auto-filled buff whose grant carries ANY
            // condition at all (including 'always'), proving the instrument CAN report a
            // non-empty result before trusting the real (unwidened) empty answer above.
            const result: GatedBuff[] = [];
            for (const buff of buffs) {
                if (!buff.autoFilled || !buff.skillSource) continue;
                result.push({ buffId: buff.id, buffName: buff.buffName, reason: 'any-condition' });
            }
            return result;
        });
        console.log(`  Widened predicate finding count: ${widened.findings.length}`);
        process.exit(1);
    }

    console.log(`${findings.length} finding(s):\n`);
    for (const f of findings) {
        console.log(`- ${f.ship} — ${f.buffName} — ${f.reason}`);
        console.log(
            `    Theoretical EHP @ ${REFERENCE_HP.toLocaleString()} HP / ${REFERENCE_DEFENSE.toLocaleString()} Defense: ` +
                `${f.beforeEHP.toLocaleString()} -> ${f.afterEHP.toLocaleString()}`
        );
    }

    console.log(`\nSummary: ${findings.length} gated finding(s) across ${shipCount} ships.`);
}

// Run the CLI only when invoked directly (npm run audit:gated-buffs), not when imported by a test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    run();
}
