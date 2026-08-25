import { describe, it, expect, beforeAll } from 'vitest';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';
import { buildShipAbilities } from '../buildShipAbilities';
import { buildEquipmentAbilities } from '../buildEquipmentAbilities';
import { GEAR_SETS } from '../../../constants/gearSets';
import { IMPLANTS } from '../../../constants/implants';
import type { Ship } from '../../../types/ship';
import type { GearPiece } from '../../../types/gear';
import type { AbilityTarget } from '../../../types/abilities';
import type { RarityName } from '../../../constants/rarities';

/**
 * #399 Task 2 review finding — inventory gate.
 *
 * `playerTurn.ts`'s charge-pool classification (`chargeGainFromSkill`, ~line 1048) switched from
 * a hand-written `ability.target === 'enemy' || ability.target === 'all-enemies'` check to the
 * shared `isEnemyTarget` classifier. That widens the enemy bucket by FIVE `AbilityTarget` values
 * at this one site: `'adjacent-enemies'`, `'target-and-adjacent-enemies'`, `'enemy-most-buffs'`,
 * `'enemy-highest-attack'` and `'enemy-highest-speed'` all used to fall into `'own'` there and now
 * count as `'enemy'`.
 *
 * This file pins that the widening is CORPUS-DEAD: no `type: 'charge'` ability the codebase can
 * currently produce carries any of the five targets. It follows `lowestHpAllySelector.test.ts`'s
 * inventory-gate pattern — sweep the real corpus through the real builders and assert on the
 * resulting set, rather than asserting against a hand-written list of ship/gear names.
 *
 * Two builders are data-driven and swept here:
 *   - `buildShipAbilities` — swept across every `docs/ship-skills.csv` row's every skill slot.
 *   - `buildEquipmentAbilities` — swept across every `GEAR_SETS` key (at its `minPieces`) and
 *     every `IMPLANTS` key at every rarity.
 *
 * `flatInputToAbilities.ts`'s one charge site is NOT swept here: it hardcodes `target: 'self'` in
 * the source (`input.selfChargeGain` always resolves to a `self`-targeted charge ability) with no
 * data path that can vary it, so a runtime sweep would only ever re-observe the literal in the
 * code — a static read is the correct instrument for that site, not a corpus test.
 *
 * The CSV is gitignored dev reference data; per `lowestHpAllySelector.test.ts`'s convention this
 * throws rather than skips when it is absent, so the inventory gate cannot silently vanish.
 */

const WIDENED_TARGETS: readonly AbilityTarget[] = [
    'adjacent-enemies',
    'target-and-adjacent-enemies',
    'enemy-most-buffs',
    'enemy-highest-attack',
    'enemy-highest-speed',
];

function requireCsv(): void {
    if (!csvAvailable()) {
        throw new Error(
            'docs/ship-skills.csv is missing from this worktree (gitignored reference data) — it is ' +
                "the parser's source of truth and this inventory gate cannot run without it."
        );
    }
}

type CsvSlot = 'active' | 'charged' | 'passive1' | 'passive2' | 'passive3';

// Mirrors lowestHpAllySelector.test.ts's shipForSlot: isolates one CSV text into its true slot so
// slot-sensitive builder logic (which passive is unlocked) sees the truth, rather than combining
// every slot into one ship (which would only ever resolve a single passive column).
const shipForSlot = (slot: CsvSlot, text: string): Ship => {
    const refits = (n: number) => Array.from({ length: n }, () => ({}));
    if (slot === 'active') return { refits: [], activeSkillText: text } as unknown as Ship;
    if (slot === 'charged') return { refits: [], chargeSkillText: text } as unknown as Ship;
    if (slot === 'passive1') return { refits: [], firstPassiveSkillText: text } as unknown as Ship;
    if (slot === 'passive2')
        return { refits: refits(2), secondPassiveSkillText: text } as unknown as Ship;
    return { refits: refits(4), thirdPassiveSkillText: text } as unknown as Ship;
};

const csvSlots = (rec: {
    active: string;
    charge: string;
    passives: [string, string, string];
}): [CsvSlot, string][] =>
    (
        [
            ['active', rec.active],
            ['charged', rec.charge],
            ['passive1', rec.passives[0]],
            ['passive2', rec.passives[1]],
            ['passive3', rec.passives[2]],
        ] as [CsvSlot, string][]
    ).filter(([, text]) => text.trim().length > 0);

interface ChargeRow {
    source: string;
    target: AbilityTarget;
}

/** Every `type: 'charge'` ability `buildShipAbilities` emits, across the whole CSV roster. */
function sweepShipCharges(): ChargeRow[] {
    const rows: ChargeRow[] = [];
    for (const rec of loadShipSkillRecords()) {
        for (const [slot, text] of csvSlots(rec)) {
            for (const built of buildShipAbilities(shipForSlot(slot, text)).slots) {
                for (const a of built.abilities) {
                    if (a.config.type === 'charge') {
                        rows.push({ source: `${rec.name}/${slot}`, target: a.target });
                    }
                }
            }
        }
    }
    return rows;
}

// ---------------------------------------------------------------------------
// buildEquipmentAbilities corpus (mirrors equipmentCoverage.test.ts's fixture helpers).
// ---------------------------------------------------------------------------

function makeShip(over: Partial<Ship>): Ship {
    return {
        id: 'coverage-ship',
        name: 'Coverage Ship',
        rarity: 'legendary',
        faction: 'AURELIAN_SOVEREIGNTY',
        type: 'ATTACKER',
        baseStats: {} as Ship['baseStats'],
        equipment: {},
        implants: {},
        refits: [],
        ...over,
    };
}

function makePiece(over: Partial<GearPiece>): GearPiece {
    return {
        id: 'piece',
        slot: 'weapon',
        level: 16,
        stars: 6,
        rarity: 'legendary',
        mainStat: null,
        subStats: [],
        setBonus: null,
        ...over,
    };
}

const RARITIES: RarityName[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
const EQUIPMENT_SLOTS = ['weapon', 'hull', 'sensor', 'engine', 'shield', 'computer'] as const;

function gearSetCharges(setKey: string): ChargeRow[] {
    const setDef = GEAR_SETS[setKey];
    const minPieces = setDef?.minPieces ?? 2;
    const equipment: Record<string, string> = {};
    const pieceMap: Record<string, GearPiece> = {};
    for (let i = 0; i < minPieces; i++) {
        const id = `${setKey}-piece-${i}`;
        const slot = EQUIPMENT_SLOTS[i % EQUIPMENT_SLOTS.length];
        equipment[slot] = id;
        pieceMap[id] = makePiece({ id, slot, setBonus: setKey });
    }
    const ship = makeShip({ equipment });
    return buildEquipmentAbilities(ship, (id) => pieceMap[id])
        .filter((a) => a.config.type === 'charge')
        .map((a) => ({ source: `gearSet/${setKey}`, target: a.target }));
}

function implantCharges(implantKey: string, rarity: RarityName): ChargeRow[] {
    const id = `${implantKey}-piece`;
    const pieceMap: Record<string, GearPiece> = {
        [id]: makePiece({ id, slot: 'implant_major', rarity, setBonus: implantKey }),
    };
    const ship = makeShip({ implants: { implant_major: id } });
    return buildEquipmentAbilities(ship, (gearId) => pieceMap[gearId])
        .filter((a) => a.config.type === 'charge')
        .map((a) => ({ source: `implant/${implantKey}/${rarity}`, target: a.target }));
}

function sweepEquipmentCharges(): ChargeRow[] {
    const rows: ChargeRow[] = [];
    for (const setKey of Object.keys(GEAR_SETS)) {
        rows.push(...gearSetCharges(setKey));
    }
    for (const implantKey of Object.keys(IMPLANTS)) {
        for (const rarity of RARITIES) {
            rows.push(...implantCharges(implantKey, rarity));
        }
    }
    return rows;
}

describe('#399 Task 2 review finding — charge-pool five-target widening is corpus-dead', () => {
    beforeAll(requireCsv);

    it('no ship-corpus charge ability carries any of the five widened targets', () => {
        const rows = sweepShipCharges();
        // Anti-vacuity floor: fail loudly if the CSV sweep silently shrinks instead of quietly
        // passing with most of the roster unread (same guard as lowestHpAllySelector.test.ts).
        // Charge abilities are a narrow slice of the corpus (~37 at the time of writing, versus
        // >1000 total abilities), so the floor sits well under that rather than at a token value.
        expect(rows.length).toBeGreaterThan(20);

        const offending = rows.filter((r) => (WIDENED_TARGETS as string[]).includes(r.target));
        expect(offending).toEqual([]);
    });

    it('every ship-corpus charge ability targets self, enemy or all-allies', () => {
        const rows = sweepShipCharges();
        const observedTargets = [...new Set(rows.map((r) => r.target))].sort();
        expect(observedTargets).toEqual(['all-allies', 'enemy', 'self']);
    });

    it('no gear-set/implant charge ability carries any of the five widened targets', () => {
        const rows = sweepEquipmentCharges();
        expect(rows.length).toBeGreaterThan(0);

        const offending = rows.filter((r) => (WIDENED_TARGETS as string[]).includes(r.target));
        expect(offending).toEqual([]);
    });

    it('every gear-set/implant charge ability targets self', () => {
        // CHRONO_REAVER (the only implant charge builder today) and any gear-set charge builder
        // both emit self-targeted charges — pin the exact set so a future addition that reaches
        // enemy/ally targeting is a deliberate, reviewed change to this test, not a silent pass.
        const rows = sweepEquipmentCharges();
        const observedTargets = [...new Set(rows.map((r) => r.target))].sort();
        expect(observedTargets).toEqual(['self']);
    });
});
