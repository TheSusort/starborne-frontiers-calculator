import { readFileSync } from 'fs';
import { describe, it, expect } from 'vitest';
import { detectOffFormulaStats, gatingStatFor } from '../offFormulaStats';
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

// 4 refits so the highest-unlocked passive resolves (skillRows.ts gates R4 at 4, R2 at 2).
// Players tune maxed ships; detecting against the R0 passive reads the wrong clause.
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

const corpus = () => {
    const data: Datum[] = JSON.parse(readFileSync('docs/ship-data.json', 'utf8'));
    const byName = new Map(data.map((d) => [d.name.toLowerCase(), d]));
    return loadShipSkillRecords()
        .map((rec) => {
            const d = byName.get(rec.name.toLowerCase());
            return d ? { name: rec.name, ship: asShip(rec, d), role: d.role } : null;
        })
        .filter((x): x is { name: string; ship: Ship; role: string } => x !== null);
};

// Gitignored reference data (docs/ship-skills.csv, docs/ship-data.json) exists on dev machines
// but not every checkout — skip rather than fail where it's absent, matching the rest of the
// real-corpus suites (e.g. coveredVictimReInflict.corpus.test.ts).
describe.skipIf(!csvAvailable() || !shipDataAvailable())(
    'detectOffFormulaStats over the real corpus',
    () => {
        const flagged = new Map(
            corpus()
                .map((c) => [c.name, detectOffFormulaStats(c.ship, c.role as never)] as const)
                .filter(([, f]) => f.length > 0)
        );

        // NON-VACUITY FIRST. A detector that walks the wrong path returns [] for every ship and a
        // bare "Chakara is flagged" assertion would fail loudly, but a bare "Aegis is not flagged"
        // assertion would PASS. Pin the population so an empty result cannot read as success.
        it('flags a substantial minority of the corpus, not none and not all', () => {
            expect(flagged.size).toBeGreaterThan(20);
            expect(flagged.size).toBeLessThan(80);
        });

        it.each([
            ['Chakara', 'defence', 'severe'],
            ['Nuqtu', 'defence', 'severe'],
            ['Prophet', 'security', 'severe'],
            ['Howler', 'attack', 'severe'],
            ['Graphite', 'attack', 'severe'],
        ])(
            'flags %s on %s as %s — the formula optimises something else',
            (name, stat, severity) => {
                const findings = flagged.get(name) ?? [];
                expect(findings.some((f) => f.stat === stat && f.severity === severity)).toBe(true);
                // Severity is a function of (stat, role) alone — never of which carrier produced the
                // finding — so the same stat must never surface under two different severities here.
                expect(findings.some((f) => f.stat === stat && f.severity !== severity)).toBe(
                    false
                );
            }
        );

        // The aggregate rule. DEFENDER's seed is core('effectiveHp'), which CONTAINS defence — a gate
        // asking "is the stat in the formula" returns false here and misses these ships entirely.
        it.each([['Panon'], ['Madax']])(
            '%s is flagged as a substitution trap, not skipped because effectiveHp contains defence',
            (name) => {
                const findings = flagged.get(name) ?? [];
                expect(
                    findings.some((f) => f.stat === 'defence' && f.severity === 'substitution')
                ).toBe(true);
                // The aggregate rule specifically, not an accidental 'severe' default: the seed does
                // contain effectiveHp (hence defence), so it must never present as absent-entirely.
                expect(findings.some((f) => f.stat === 'defence' && f.severity === 'severe')).toBe(
                    false
                );
            }
        );

        // The third carrier. Both ride `damage` configs with hpBasisPct/shieldBasisPct on the
        // REACTIVE path, invisible to an 'additional-damage' query.
        it('finds Vindicator, whose damage channel is damage.hpBasisPct', () => {
            const findings = flagged.get('Vindicator') ?? [];
            expect(
                findings.some((f) => f.stat === 'hp' && f.trigger === 'on-debuff-resisted')
            ).toBe(true);
        });

        it('finds Xcellence for his DAMAGE channel, not merely his shield-from-HP passive', () => {
            const findings = flagged.get('Xcellence') ?? [];
            expect(
                findings.some(
                    (f) =>
                        f.produces === 'damage' &&
                        f.stat === 'shield' &&
                        f.trigger === 'on-enemy-debuff-resisted'
                )
            ).toBe(true);
        });

        // A supporter healing from HP is ALIGNED: SUPPORTER's seed carries core('hp') as its own row.
        // This proves the seed-derived rule actually suppresses, rather than flagging everything.
        it('does not flag a supporter whose repair scales off HP, which its formula rewards directly', () => {
            const meatshield = corpus().find((c) => c.name === 'Meatshield');
            const asSupporter = detectOffFormulaStats(meatshield!.ship, 'SUPPORTER');
            expect(asSupporter.some((f) => f.stat === 'hp' && f.produces === 'repair')).toBe(false);
        });

        // Positive control for the test above: the same ship, same HP-basis repair, under a role
        // whose seed does NOT carry 'hp' anywhere (ATTACKER: directDamage only). If the negative
        // assertion above passed only because the detector always returns [] regardless of role,
        // this control fails it — proving the suppression is role-conditioned, not a standing no-op.
        it('flags that same HP-basis repair once the configured role no longer rewards HP', () => {
            const meatshield = corpus().find((c) => c.name === 'Meatshield');
            const asAttacker = detectOffFormulaStats(meatshield!.ship, 'ATTACKER');
            expect(asAttacker.some((f) => f.stat === 'hp' && f.produces === 'repair')).toBe(true);
        });

        it('returns nothing in Custom mode, where there is no role objective to diverge from', () => {
            const chakara = corpus().find((c) => c.name === 'Chakara');
            expect(detectOffFormulaStats(chakara!.ship, null)).toEqual([]);
        });
    }
);

describe('gatingStatFor', () => {
    it.each([
        ['on-debuff-resisted', 'hacking'],
        ['on-own-debuff-resisted', 'security'],
        ['on-enemy-debuff-resisted', 'security'],
        ['on-cast', 'defence'],
    ])('%s gates on the enemy varying %s', (trigger, expected) => {
        expect(gatingStatFor(trigger)).toBe(expected);
    });
});
