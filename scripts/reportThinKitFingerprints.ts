/**
 * Reports which corpus ships fingerprint THIN — few distinct behaviour tokens across every
 * scenario the ship runs (three, or four for support-anchored ships). Diagnostic only, run by
 * hand:
 *
 *   npx tsx scripts/reportThinKitFingerprints.ts
 *
 * A thin ship is a candidate for the deferred fourth (status-seeded) scenario: its kit may be
 * gated on enemy buffs/debuffs, which v1 does not seed. Deliberately NOT a test — it gates
 * nothing, and the spec defers the fourth-scenario decision until these numbers exist.
 */
/* eslint-disable no-console */
import { fingerprintShip, corpusNames } from '../src/utils/combat/audit/kitFingerprintScenarios';
import { buildTraceShip } from './lib/traceShipFactory';

const THIN_THRESHOLD = 3;

const thin: string[] = [];
for (const name of corpusNames()) {
    const ship = buildTraceShip(name);
    if (!ship) continue;
    const fp = fingerprintShip(ship);
    const distinct = new Set(Object.values(fp).flat());
    if (distinct.size <= THIN_THRESHOLD) thin.push(`${name}(${[...distinct].join(',')})`);
}
console.log(`thin ships (${thin.length} of ${corpusNames().length}):`);
for (const line of thin) console.log(`  ${line}`);
