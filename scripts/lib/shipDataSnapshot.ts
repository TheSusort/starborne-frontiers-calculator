import { readFileSync, existsSync } from 'fs';
import type { ShipData } from '../../src/types/ship';

export const SNAPSHOT_PATH = 'docs/ship-data.json';

export function shipDataAvailable(path: string = SNAPSHOT_PATH): boolean {
    return existsSync(path);
}

// Graceful-absent, mirroring csvAvailable/loadShipSkillRecords (scripts/lib/shipSkillCsv.ts):
// a clean checkout has no gitignored docs/ship-data.json, so callers must get `[]` rather
// than a thrown ENOENT.
export function loadShipDataRecords(path: string = SNAPSHOT_PATH): ShipData[] {
    if (!existsSync(path)) return [];
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as ShipData[];
}

// Keyed on the UPPERCASED name — the harness resolves ships case-insensitively (CSV name
// casing is inconsistent; ShipData.name is canonical mixed-case). Mirrors the map shape
// traceShipFactory.ts previously built from the SHIPS constant.
export function loadShipDataByName(path: string = SNAPSHOT_PATH): Map<string, ShipData> {
    return new Map(loadShipDataRecords(path).map((d) => [d.name.toUpperCase(), d]));
}
