import { readFileSync } from 'fs';
import { describe, it, expect } from 'vitest';
import {
    chargePeriod,
    deriveBasis,
    TRIGGER_PROSE,
    KNOWN_CADENCE_TRIGGERS,
} from '../basisDerivation';
import { detectOffFormulaStats } from '../offFormulaStats';
import { buildShipAbilities } from '../../../abilities/buildShipAbilities';
import { csvAvailable, loadShipSkillRecords } from '../../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../../scripts/lib/shipDataSnapshot';
import type { Ship } from '../../../../types/ship';

interface Datum {
    name: string;
    role: string;
    hp: number;
    attack: number;
    defense: number;
    hacking: number;
    security: number;
    speed: number;
    critRate: number;
    critDamage: number;
}

// 4 refits so the highest-unlocked passive resolves (skillRows.ts gates R4 at 4, R2 at 2),
// matching offFormulaStats.test.ts's own corpus fixture exactly — players tune maxed ships, and
// detecting against the R0 passive reads the wrong clause.
const asShip = (rec: ReturnType<typeof loadShipSkillRecords>[number], d: Datum): Ship =>
    ({
        id: rec.name.toLowerCase(),
        name: rec.name,
        type: d.role,
        baseStats: {
            attack: d.attack,
            crit: d.critRate,
            critDamage: d.critDamage,
            hacking: d.hacking,
            security: d.security,
            defence: d.defense,
            hp: d.hp,
            speed: d.speed,
        },
        equipment: {},
        implants: {},
        refits: [0, 1, 2, 3].map((i) => ({ id: `r${i}`, stats: [] })),
        activeSkillText: rec.active,
        chargeSkillText: rec.charge,
        chargeSkillCharge: rec.chargeCharge,
        firstPassiveSkillText: rec.passives[0],
        secondPassiveSkillText: rec.passives[1],
        thirdPassiveSkillText: rec.passives[2],
        activeTarget: 'front',
        activePattern: 'Pattern-Base',
        chargedTarget: 'front',
        chargedPattern: 'Pattern-Base',
    }) as unknown as Ship;

interface CorpusShip {
    name: string;
    ship: Ship;
    role: string;
}

const corpus = (): CorpusShip[] => {
    const data: Datum[] = JSON.parse(readFileSync('docs/ship-data.json', 'utf8'));
    const byName = new Map(data.map((d) => [d.name.toLowerCase(), d]));
    return loadShipSkillRecords()
        .map((rec) => {
            const d = byName.get(rec.name.toLowerCase());
            return d ? { name: rec.name, ship: asShip(rec, d), role: d.role } : null;
        })
        .filter((x): x is CorpusShip => x !== null);
};

/** Looks a real corpus ship up by name. Throws rather than returning undefined — a typo'd name
 *  silently scoring every assertion against `undefined` would fail confusingly far from the
 *  actual mistake. */
const shipNamed = (name: string): Ship => {
    const found = corpus().find((c) => c.name === name);
    if (!found) throw new Error(`mutation guard: no corpus ship named ${name}`);
    return found.ship;
};

const flaggedCorpus = (): CorpusShip[] =>
    corpus().filter((c) => detectOffFormulaStats(c.ship, c.role as never).length > 0);

/** Whether an `additional-damage` clause repeats per hit has never come up in the corpus — no
 *  flagged ship's slot carries both a multi-hit `damage` ability and an `additional-damage`
 *  ability together, so the derivation never has to answer it. A future data refresh that
 *  introduces one must fail this test rather than silently halve (or double) that ship's term. */
const multiHitFlaggedShips = (): string[] => {
    const offenders: string[] = [];
    for (const { name, ship } of flaggedCorpus()) {
        for (const slot of buildShipAbilities(ship).slots ?? []) {
            const abilities = slot.abilities ?? [];
            const hasMultiHitDamage = abilities.some((a) => {
                const config = a.config as { type?: string; hits?: number };
                return config.type === 'damage' && (config.hits ?? 1) > 1;
            });
            const hasAdditionalDamage = abilities.some(
                (a) => (a.config as { type?: string }).type === 'additional-damage'
            );
            if (hasMultiHitDamage && hasAdditionalDamage) {
                offenders.push(name);
                break;
            }
        }
    }
    return offenders;
};

const flaggedShipCount = (): number => flaggedCorpus().length;

const shipWithNoChargedSkill: Ship = {
    id: 'no-charge',
    name: 'No Charge',
    type: 'ATTACKER',
    baseStats: {
        attack: 5000,
        crit: 50,
        critDamage: 150,
        hacking: 100,
        security: 100,
        defence: 3000,
        hp: 40000,
        speed: 100,
    },
    equipment: {},
    implants: {},
    refits: [],
    activeSkillText: 'This Unit deals <unit-damage>120% damage</unit-damage>.',
    activeTarget: 'front',
    activePattern: 'Pattern-Base',
} as unknown as Ship;

// Own-targeted (`target: 'self'`) charge ability on the CHARGED slot itself — no corpus ship
// carries this shape. Sefuba's charged-slot charge ability is `target: 'enemy'`, so OWN_TARGETED
// already filters it out before the slot list gets a say; this fixture isolates the slot rule
// from the target rule so a widened slot list actually changes the answer.
const shipWithOwnChargedSlotCharge: Ship = {
    id: 'own-charged-slot-charge',
    name: 'Own Charged Slot Charge',
    type: 'ATTACKER',
    baseStats: {
        attack: 5000,
        crit: 50,
        critDamage: 150,
        hacking: 100,
        security: 100,
        defence: 3000,
        hp: 40000,
        speed: 100,
    },
    equipment: {},
    implants: {},
    refits: [],
    activeSkillText: 'This Unit deals <unit-damage>200% damage</unit-damage>.',
    chargeSkillText:
        'This Unit deals <unit-damage>300% damage</unit-damage> and gains 1 charge to its Charged Skill.',
    chargeSkillCharge: 3,
    activeTarget: 'front',
    activePattern: 'Pattern-Base',
    chargedTarget: 'front',
    chargedPattern: 'Pattern-Base',
} as unknown as Ship;

const closeTo = (n: number, precision = 3) => expect.closeTo(n, precision);

// Pure — no real corpus data needed, so it runs on every checkout regardless of whether the
// gitignored reference files are present.
describe('chargePeriod — no charged skill', () => {
    it('is 0 for a ship with no charged skill, and that ship weights active at 1', () => {
        const basis = deriveBasis(shipWithNoChargedSkill, 'damage');
        expect(basis.period).toBe(0);
        // wActive = 1 at period 0 (see deriveBasis), so the active slot's raw 120% multiplier
        // reaches the term undiluted rather than blended against a charged slot.
        expect(basis.terms).toEqual([{ stat: 'attack', weight: closeTo(1.2) }]);
    });
});

describe('chargePeriod — charged-slot charge ability is ignored regardless of target', () => {
    it('matches the period computed with g=0, not the g=1 a widened slot list would produce', () => {
        // n=3, g=0 -> period 4 (same arithmetic as the corpus's Lodolite case). A slot list
        // widened to include 'charged' would count the own-targeted gain above and produce g=1,
        // hence period 3 — this assertion distinguishes the two.
        expect(chargePeriod(shipWithOwnChargedSlotCharge)).toBe(4);
    });
});

describe.skipIf(!csvAvailable() || !shipDataAvailable())(
    'basisDerivation over the real corpus',
    () => {
        describe('chargePeriod', () => {
            // N and g measured 2026-09-20. g sums own-targeted charge abilities in the ACTIVE
            // and PASSIVE slots only: charges accrue on active rounds (runPlayerTurn's own-charge
            // block, gated on `action === 'active'`), so Sefuba's charged-slot `enemy+2` must
            // contribute nothing.
            it.each([
                ['Chakara', 2], // N=2 g=1
                ['Obsidian', 2], // N=3 g=2
                ['Cobalt', 3], // N=3 g=1 (passive aura)
                ['Nuqtu', 3], // N=4 g=2
                ['Lodolite', 4], // N=3 g=0
                ['Prophet', 9], // N=8 g=0
                ['Sefuba', 3], // N=2, charged-slot enemy charge ability contributes nothing
            ])('%s has period %i', (name, expected) => {
                expect(chargePeriod(shipNamed(name))).toBe(expected);
            });
        });

        describe('deriveBasis — damage', () => {
            it('blends a two-term basis, weighted (p-1) active to 1 charged', () => {
                // Cobalt: active mult 200 + hp 25%, charged mult 230 + hp 30%, p=3
                expect(deriveBasis(shipNamed('Cobalt'), 'damage').terms).toEqual([
                    { stat: 'attack', weight: closeTo(2.1) },
                    { stat: 'hp', weight: closeTo(0.267) },
                ]);
            });

            it('emits NO attack term for a ship whose damage multiplier is 0', () => {
                const terms = deriveBasis(shipNamed('Prophet'), 'damage').terms;
                expect(terms).toEqual([{ stat: 'security', weight: closeTo(57.778) }]);
                expect(terms.some((t) => t.stat === 'attack')).toBe(false);
            });

            it('resolves a shield chain as the PRODUCT of both percentages', () => {
                // FrontLine: damage from shield x0.750, shield from hp 25% -> hp x0.188.
                // Both factors obey the slot rule, and his only hp-shield source is a pre-combat
                // PASSIVE, so with passives excluded the hp term is absent and the clause is
                // reported as excluded instead.
                const basis = deriveBasis(shipNamed('FrontLine'), 'damage');
                expect(basis.terms.some((t) => t.stat === 'hp')).toBe(false);
                expect(basis.excluded).toContainEqual(
                    expect.objectContaining({
                        stat: 'hp',
                        produces: 'shield',
                        trigger: 'pre-combat',
                    })
                );
            });

            it('reports no lever when the shield has no stat basis anywhere', () => {
                // Quixilver's shield comes from damage dealt and damage taken.
                const basis = deriveBasis(shipNamed('Quixilver'), 'damage');
                expect(basis.terms.filter((t) => t.stat !== 'attack')).toEqual([]);
            });
        });

        describe('deriveBasis — repair', () => {
            it('substitutes the basis entirely when no HP clause exists', () => {
                // Howler repairs off attack only.
                expect(deriveBasis(shipNamed('Howler'), 'repair').terms).toEqual([
                    { stat: 'attack', weight: closeTo(1.067) },
                ]);
            });

            it('keeps both terms and their real ratio', () => {
                // Makoli: hp 5%/7%, defence 100%/120%, p=3 -> defence outweighs hp ~19:1.
                // Weights are rounded to the 0.001 the editor can express, which moves his small
                // hp term 0.0567 -> 0.057 and the ratio with it. The point of the assertion is
                // the order of magnitude that inverts his role formula, not the third decimal.
                const terms = deriveBasis(shipNamed('Makoli'), 'repair').terms;
                const hp = terms.find((t) => t.stat === 'hp')!.weight;
                const def = terms.find((t) => t.stat === 'defence')!.weight;
                expect(def / hp).toBeCloseTo(18.72, 1);
            });
        });

        describe('passive exclusion', () => {
            it.each([
                'APEX',
                'Crocus',
                'Crucialis',
                'FrontLine',
                'Hemlock',
                'IonScorp',
                'LUXX',
                'Rikra',
                'Sefuba',
                'Xcellence',
            ])('%s derives no off-stat term and reports its carrier as excluded', (name) => {
                const basis = deriveBasis(shipNamed(name), 'damage');
                expect(basis.terms.filter((t) => t.stat !== 'attack')).toEqual([]);
                expect(basis.excluded.length).toBeGreaterThan(0);
            });
        });

        describe('tripwires', () => {
            it('no flagged ship carries hits > 1 on a slot that also has additional-damage', () => {
                // Whether an additional-damage clause repeats per hit has never arisen and is a
                // GAME question, not an inference. This fails on the data refresh that
                // introduces one.
                expect(multiHitFlaggedShips()).toEqual([]);
            });

            it('flags exactly the corpus count, so a data refresh surfaces here', () => {
                expect(flaggedShipCount()).toBe(47);
            });

            it('every trigger excludedCarriers surfaces across the corpus has TRIGGER_PROSE', () => {
                // Reads deriveBasis's own `excluded` output (excludedCarriers's public path)
                // rather than re-deriving a parallel filter, over every corpus ship (not only the
                // flagged ones — excluded carriers show up outside a role-flagged ship too). Fails
                // the moment a data refresh introduces a trigger this module's TRIGGER_PROSE
                // doesn't cover, rather than silently degrading to a raw key in user-facing copy.
                const unmapped = new Set<string>();
                for (const { ship } of corpus()) {
                    for (const carrier of deriveBasis(ship, 'damage').excluded) {
                        if (!(carrier.trigger in TRIGGER_PROSE)) unmapped.add(carrier.trigger);
                    }
                }
                expect([...unmapped]).toEqual([]);
            });

            it('every KNOWN_CADENCE_TRIGGERS entry is a key of TRIGGER_PROSE', () => {
                // The two tables classify the same trigger strings for different purposes —
                // one prose, one cadence — so a trigger that drifts out of `TRIGGER_PROSE`
                // (renamed, removed on a data refresh) must fail here rather than let
                // `excludedReason` silently fall back to a wrong reason for an unmapped trigger.
                for (const trigger of KNOWN_CADENCE_TRIGGERS) {
                    expect(trigger in TRIGGER_PROSE).toBe(true);
                }
            });
        });
    }
);

describe.skipIf(!csvAvailable() || !shipDataAvailable())(
    'derived weights are expressible in the editor',
    () => {
        // The weight field steps by 0.001 and the summary prints toFixed(3). A raw quotient such
        // as Prophet's 520/9 reaches the form as 57.77777777777778, which native validation
        // rejects: the player is shown a value they cannot save without retyping it.
        const STEP = 0.001;
        const PRODUCES = ['damage', 'repair', 'shield'] as const;

        it('derives only step-aligned, non-zero weights across the flagged corpus', () => {
            const flagged = flaggedCorpus();
            expect(flagged.length).toBeGreaterThan(0);
            let seen = 0;
            for (const { ship } of flagged) {
                for (const produces of PRODUCES) {
                    for (const term of deriveBasis(ship, produces).terms) {
                        seen++;
                        const steps = term.weight / STEP;
                        expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-6);
                        // A zero term in a core row zeroes that row for every candidate.
                        expect(term.weight).toBeGreaterThan(0);
                    }
                }
            }
            // Without this the two assertions above pass over an empty walk.
            expect(seen).toBeGreaterThan(20);
        });

        it('rounds Prophet to the value the notice already prints', () => {
            expect(deriveBasis(shipNamed('Prophet'), 'damage').terms).toEqual([
                { stat: 'security', weight: 57.778 },
            ]);
        });
    }
);
