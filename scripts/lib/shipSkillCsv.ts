import { readFileSync, existsSync } from 'fs';

export const CSV_PATH = 'docs/ship-skills.csv';

// Verbatim copy from auditSkills.ts — handles quoted fields, escaped quotes, embedded commas.
export function parseCsvLine(line: string): string[] {
    const fields: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inQuotes) {
            if (c === '"') {
                if (line[i + 1] === '"') {
                    cur += '"';
                    i++;
                } else inQuotes = false;
            } else cur += c;
        } else if (c === '"') inQuotes = true;
        else if (c === ',') {
            fields.push(cur);
            cur = '';
        } else cur += c;
    }
    fields.push(cur);
    return fields;
}

// Verbatim copy from auditSkills.ts — accumulates physical lines until quotes balance so
// multi-line quoted passives (Centurion, Chimei, Curator, Enforcer, Graphite, Lingshe) survive.
export function readCsvRecords(raw: string): string[] {
    const physicalLines = raw.split('\n');
    const records: string[] = [];
    let buffer: string[] = [];
    let quoteCount = 0;
    for (const line of physicalLines) {
        buffer.push(line);
        quoteCount += (line.match(/"/g) ?? []).length;
        // Even quote count = no unterminated quoted field spanning this line boundary — the
        // buffered lines form one complete record. Re-join with '\n' so multi-line skill text
        // is preserved (parseCsvLine treats embedded newlines as ordinary characters).
        if (quoteCount % 2 === 0) {
            const record = buffer.join('\n');
            buffer = [];
            quoteCount = 0;
            if (record.trim().length > 0) records.push(record);
        }
    }
    // Any leftover buffered lines (unbalanced quotes through EOF) are dropped — malformed CSV,
    // not a multi-line record.
    return records;
}

export function csvAvailable(csvPath: string = CSV_PATH): boolean {
    return existsSync(csvPath);
}

export interface ShipSkillRecord {
    name: string;
    active: string;
    charge: string;
    chargeCharge: number;
    passives: [string, string, string];
}

const clean = (s: string | undefined): string =>
    s && s !== 'null' && s.trim().length > 0 ? s : '';

export function loadShipSkillRecords(csvPath: string = CSV_PATH): ShipSkillRecord[] {
    // Header: name,active_skill_text,charge_skill_charge,charge_skill_text,
    //         first_passive_skill_text,second_passive_skill_text,third_passive_skill_text
    const records = readCsvRecords(readFileSync(csvPath, 'utf8'));
    const out: ShipSkillRecord[] = [];
    for (let i = 1; i < records.length; i++) {
        const f = parseCsvLine(records[i]);
        if (f.length < 7) continue;
        const [name, active, chargeCharge, charge, p1, p2, p3] = f;
        out.push({
            name: name.trim(),
            active: clean(active),
            charge: clean(charge),
            chargeCharge: Number(chargeCharge) || 0,
            passives: [clean(p1), clean(p2), clean(p3)],
        });
    }
    return out;
}
