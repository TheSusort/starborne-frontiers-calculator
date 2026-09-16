import { describe, it, expect } from 'vitest';
import { applySuggestionsToShip } from '../candidateShip';
import { resolveFight } from '../fightSources';
import { runCandidate, type CandidateRun } from '../runCandidates';
import { metricSeries } from '../metricTable';
import type { Ship } from '../../../../types/ship';
import type { GearPiece } from '../../../../types/gear';
import type { GearSuggestion } from '../../../../types/autogear';

// Verbatim from docs/ship-skills.csv. The R2 passive carries the on-resist channel, so the ship
// needs two refits for `getShipSkillRows` to select it over the R0 passive.
const XCELLENCE_ACTIVE =
    'This Unit Deals <unit-damage>150% damage</unit-damage> and Inflicts <unit-skill>Speed Down II</unit-skill> for 2 turns and Stasis for 2 turn.';
const XCELLENCE_CHARGE =
    'This Unit deals <unit-damage>280% damage</unit-damage> and inflicts <unit-skill>Disable</unit-skill> for 1 turn.';
const XCELLENCE_R2 =
    "This Unit has 20% Shield Penetration.<br /><br />At the start of each turn this Unit gains <unit-damage>Shield equal to 20%</unit-damage> of its Max HP.<br /><br />When an enemy resists a debuff infliction, this Unit deals damage equal to <unit-damage>115%</unit-damage> of this Unit's current shield..";

const xcellence = (): Ship =>
    ({
        id: 'xcellence',
        name: 'Xcellence',
        type: 'DEBUFFER',
        baseStats: {
            attack: 5_000,
            crit: 50,
            critDamage: 150,
            hacking: 140,
            security: 100,
            defence: 3_000,
            hp: 42_000,
            speed: 110,
        },
        equipment: {},
        implants: {},
        // Two refits: `getShipSkillRows` reads only the COUNT to pick the active passive, but
        // `calculateTotalStats` walks every refit's `stats` array, so an empty-object refit
        // (no `stats` key) throws once gear resolution runs.
        refits: [
            { id: 'refit-1', stats: [] },
            { id: 'refit-2', stats: [] },
        ],
        activeSkillText: XCELLENCE_ACTIVE,
        chargeSkillText: XCELLENCE_CHARGE,
        chargeSkillCharge: 3,
        secondPassiveSkillText: XCELLENCE_R2,
        activeTarget: 'front',
        activePattern: 'Pattern-Base',
        chargedTarget: 'front',
        chargedPattern: 'Pattern-Base',
    }) as unknown as Ship;

// Three real pieces, each a legal main-stat/slot pairing (software rolls hacking, hull and
// thrusters both roll hp — `constants/gearTypes.ts`'s GEAR_SLOTS), so the fixture reads as a
// loadout a real player could have. The whole build difference must travel through these,
// resolved by `getGearPiece`, never through `statOverrides` — that is what makes this a test of
// the adapter.
const HACKING_PIECE: GearPiece = {
    id: 'hacking-piece',
    slot: 'software',
    mainStat: { name: 'hacking', value: 400, type: 'flat' },
    subStats: [],
    stars: 6,
    level: 16,
    rarity: 'legendary',
    setBonus: 'CRITICAL',
};

// LEECH's `GEAR_SETS` entry carries no `stats` array — the set has nothing to add to a stat
// block, so its 15%-of-damage-dealt self-heal reaches the fight only through
// `ship.equipment` -> `buildEquipmentAbilities`. A build that sums resolved gear into
// `baseStats` and clears `equipment` cannot carry this ability at all: `focusHealingDone` for
// this ship collapses to 0 regardless of how faithfully the stat sum is computed. Split across
// two slots (hull + thrusters) so the total HP main-stat contribution matches a single 40,000
// piece while completing LEECH's 2-piece requirement.
const HP_PIECE: GearPiece = {
    id: 'hp-piece',
    slot: 'hull',
    mainStat: { name: 'hp', value: 20_000, type: 'flat' },
    subStats: [],
    stars: 6,
    level: 16,
    rarity: 'legendary',
    setBonus: 'LEECH',
};

const HP_PIECE_2: GearPiece = {
    id: 'hp-piece-2',
    slot: 'thrusters',
    mainStat: { name: 'hp', value: 20_000, type: 'flat' },
    subStats: [],
    stars: 6,
    level: 16,
    rarity: 'legendary',
    setBonus: 'LEECH',
};

const pieces: Record<string, GearPiece> = {
    'hacking-piece': HACKING_PIECE,
    'hp-piece': HP_PIECE,
    'hp-piece-2': HP_PIECE_2,
};

const deps = {
    getGearPiece: (id: string) => pieces[id],
    getEngineeringStatsForShipType: () => undefined,
};

const suggestion = (slotName: string, gearId: string): GearSuggestion[] => [
    { slotName, gearId, score: 1 },
];

/** `runCandidate` resolves `null` only on abort (see its doc); no signal is passed here, so a
 *  `null` result means the adapter chain broke, not that the run was cancelled. */
const expectRun = (run: CandidateRun | null): CandidateRun => {
    expect(run).not.toBeNull();
    return run as CandidateRun;
};

const meanFocusDamage = (run: CandidateRun): number => {
    const series = metricSeries(run, 'focusDamageDealt');
    return series.reduce((a, b) => a + b, 0) / series.length;
};

const meanFocusHealing = (run: CandidateRun): number => {
    const series = metricSeries(run, 'focusHealingDone');
    return series.reduce((a, b) => a + b, 0) / series.length;
};

// Measured across 10 base seeds (12 runs each), the HP build won every one of 120 paired runs,
// ratio 2.54x-3.06x (narrowest at seed 2600) — this committed seed is a representative sample,
// not a lucky one.
const SEED = 1234;

describe('Xcellence cliff, end to end through gear', () => {
    it('a high-hacking build and a high-HP build separate on focus damage', async () => {
        const controller = applySuggestionsToShip(
            xcellence(),
            suggestion('software', 'hacking-piece')
        );
        const bruiser = applySuggestionsToShip(xcellence(), [
            ...suggestion('hull', 'hp-piece'),
            ...suggestion('thrusters', 'hp-piece-2'),
        ]);

        const [controllerRun, bruiserRun] = await Promise.all(
            [controller, bruiser].map((ship) =>
                runCandidate({
                    id: ship.id,
                    fight: resolveFight({ kind: 'practice' }, ship, () => null),
                    deps,
                    seed: SEED,
                    runCount: 12,
                })
            )
        );

        const hackingDamage = meanFocusDamage(expectRun(controllerRun));
        const hpDamage = meanFocusDamage(expectRun(bruiserRun));

        // Non-vacuity first: a fixture where nobody deals damage would pass a bare
        // "not equal" assertion.
        expect(hackingDamage).toBeGreaterThan(0);
        expect(hpDamage).toBeGreaterThan(0);

        // The finding: the HP build out-damages the hacking build. High hacking makes
        // Xcellence's debuffs land, which suppresses the on-resist channel entirely; low
        // hacking manufactures resists, and the R2 passive converts the shield pool the ship
        // stacks every turn into damage on each one.
        expect(hpDamage).toBeGreaterThan(hackingDamage);

        // The HP build's two LEECH pieces complete the set, so it must self-heal for 15% of its
        // damage dealt; the hacking build carries no ability-granting set and performs no heals
        // of its own. This is unrelated to any stat sum, so it fails independently if gear
        // abilities are ever dropped from the adapter's output.
        const hackingHealing = meanFocusHealing(expectRun(controllerRun));
        const hpHealing = meanFocusHealing(expectRun(bruiserRun));

        expect(hackingHealing).toBe(0);
        expect(hpHealing).toBeGreaterThan(0);
    });
});
