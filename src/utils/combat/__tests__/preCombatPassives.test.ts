/**
 * Sub-project F, PR F5: `applyPreCombatShipPassives` — unit tests over hand-built plans
 * whose abilities come from the REAL parser path (`buildShipAbilities` on synthetic ships
 * with exact docs/ship-skills.csv passive texts), so the shapes under test are the
 * production `pre-combat-stat` abilities, not hand-written copies.
 *
 * Board geometry (hex adjacency, src/utils/targeting/board.ts):
 *   M2 ↔ T1, T2, M1, M3, B1, B2 — cells like M4/T4/B4 are NOT adjacent to M2.
 */
import { describe, it, expect } from 'vitest';
import { applyPreCombatShipPassives, type PreCombatPlanLike } from '../preCombatPassives';
import type { PreFightStatBlock } from '../preFight/types';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import type { Ship } from '../../../types/ship';
import type { ShipTypeName } from '../../../constants/shipTypes';
import type { Position } from '../../../types/encounters';
import type { ShipSkills } from '../../../types/abilities';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';

// ─── Real corpus passive texts (docs/ship-skills.csv verbatim) ─────────────────────────
const LIONHEART_TEXT =
    'At the start of combat, this Unit grants all adjacent allies 10% of its HP.';
const CENTURION_TEXT = 'At the start of combat, this Unit gains 500 attack per adjacent ally.';
const ENFORCER_TEXT =
    'At the start of combat this Unit gains +15% crit rate and +10% hacking if adjacent to a supporter.';
const DEFIANT_TEXT = 'When adjacent to a Supporter, this Unit gains 20% HP.';

const makeShip = (over: Partial<Ship>): Ship => ({
    id: 'unit',
    name: 'Unit',
    rarity: 'legendary',
    faction: 'TERRAN_COMBINE',
    type: 'ATTACKER',
    baseStats: {} as Ship['baseStats'],
    equipment: {},
    implants: {},
    refits: [],
    ...over,
});

/** Real production shipSkills for a ship whose R0 passive is `passiveText`. */
const skillsFromPassive = (passiveText: string): ShipSkills =>
    buildShipAbilities(makeShip({ firstPassiveSkillText: passiveText }));

const baseStats = (over: Partial<PreFightStatBlock> = {}): PreFightStatBlock => ({
    attack: 1000,
    crit: 10,
    critDamage: 50,
    defensePenetration: 0,
    shieldPenetration: 0,
    hacking: 200,
    security: 100,
    defence: 500,
    hp: 10_000,
    speed: 100,
    ...over,
});

const makePlan = (
    id: string,
    position: Position,
    opts: {
        passiveText?: string;
        role?: ShipTypeName;
        stats?: Partial<PreFightStatBlock>;
        shipSkills?: ShipSkills;
    } = {}
): PreCombatPlanLike => ({
    id,
    position,
    stats: baseStats(opts.stats),
    shipSkills:
        opts.shipSkills ?? (opts.passiveText ? skillsFromPassive(opts.passiveText) : { slots: [] }),
    role: opts.role,
});

describe('applyPreCombatShipPassives — donor-scaling (Lionheart)', () => {
    it('grants 10% of the DONOR hp to adjacent allies only; the donor is unchanged', () => {
        const lionheart = makePlan('lion', 'M2', {
            passiveText: LIONHEART_TEXT,
            stats: { hp: 20_000 },
        });
        const adjacent = makePlan('adj', 'M3');
        const far = makePlan('far', 'M4'); // M4 is not adjacent to M2

        const applied = applyPreCombatShipPassives([lionheart, adjacent, far]);

        expect(adjacent.stats.hp).toBe(10_000 + 0.1 * 20_000); // 12_000
        expect(far.stats.hp).toBe(10_000);
        expect(lionheart.stats.hp).toBe(20_000);
        expect(applied).toEqual([
            { ownerId: 'lion', recipientId: 'adj', stat: 'hp', amount: 2000 },
        ]);
    });
});

describe('applyPreCombatShipPassives — count-scaling (Centurion)', () => {
    const centurionAttackWith = (allyPositions: Position[]): number => {
        const centurion = makePlan('cent', 'M2', { passiveText: CENTURION_TEXT });
        const allies = allyPositions.map((pos, i) => makePlan(`a${i}`, pos));
        applyPreCombatShipPassives([centurion, ...allies]);
        return centurion.stats.attack;
    };

    it('0 adjacent → +0, 1 adjacent → +500, 3 adjacent → +1500 attack', () => {
        expect(centurionAttackWith([])).toBe(1000);
        expect(centurionAttackWith(['M4'])).toBe(1000); // present but NOT adjacent
        expect(centurionAttackWith(['M3'])).toBe(1500);
        expect(centurionAttackWith(['T1', 'T2', 'M1'])).toBe(2500);
    });

    it('a zero-amount per-adjacent grant (no neighbours) records no descriptor', () => {
        const centurion = makePlan('cent', 'M2', { passiveText: CENTURION_TEXT });
        const far = makePlan('far', 'M4');
        expect(applyPreCombatShipPassives([centurion, far])).toEqual([]);
    });
});

describe('applyPreCombatShipPassives — role-conditional (Enforcer)', () => {
    it('adjacent to a SUPPORTER-category role (prefix match) → +15 crit flat, hacking ×1.10', () => {
        const enforcer = makePlan('enf', 'M2', { passiveText: ENFORCER_TEXT });
        // Category-prefix matching: SUPPORTER_BUFFER falls under 'SUPPORTER'.
        const supporter = makePlan('sup', 'M3', { role: 'SUPPORTER_BUFFER' });

        const applied = applyPreCombatShipPassives([enforcer, supporter]);

        expect(enforcer.stats.crit).toBe(10 + 15); // flat crit points
        expect(enforcer.stats.hacking).toBe(220); // percent-of-own: 200 + (200 × 10) / 100
        expect(applied).toEqual([
            { ownerId: 'enf', recipientId: 'enf', stat: 'crit', amount: 15 },
            { ownerId: 'enf', recipientId: 'enf', stat: 'hacking', amount: 20 },
        ]);
    });

    it('adjacent to a non-supporter → no-op', () => {
        const enforcer = makePlan('enf', 'M2', { passiveText: ENFORCER_TEXT });
        const attacker = makePlan('atk', 'M3', { role: 'ATTACKER' });
        expect(applyPreCombatShipPassives([enforcer, attacker])).toEqual([]);
        expect(enforcer.stats).toEqual(baseStats());
    });

    it('adjacent ally with role undefined never matches (conservative)', () => {
        const enforcer = makePlan('enf', 'M2', { passiveText: ENFORCER_TEXT });
        const roleless = makePlan('nub', 'M3'); // role undefined
        expect(applyPreCombatShipPassives([enforcer, roleless])).toEqual([]);
        expect(enforcer.stats).toEqual(baseStats());
    });

    it('a supporter that is NOT adjacent does not satisfy the gate', () => {
        const enforcer = makePlan('enf', 'M2', { passiveText: ENFORCER_TEXT });
        const farSupporter = makePlan('sup', 'M4', { role: 'SUPPORTER' });
        expect(applyPreCombatShipPassives([enforcer, farSupporter])).toEqual([]);
    });
});

/** Real production shipSkills for a ship carrying a CSV record's texts verbatim (mirrors
 *  wave8Madax.test.ts's helper — full refit so the refit-resolved passive row is honored). */
function shipFromCsv(name: string): Ship {
    const rec = loadShipSkillRecords().find((r) => r.name.toUpperCase() === name.toUpperCase());
    if (!rec) throw new Error(`docs/ship-skills.csv: no record for "${name}"`);
    return makeShip({
        refits: [{}, {}, {}, {}] as unknown as Ship['refits'],
        activeSkillText: rec.active,
        chargeSkillText: rec.charge,
        chargeSkillCharge: rec.chargeCharge,
        firstPassiveSkillText: rec.passives[0],
        secondPassiveSkillText: rec.passives[1],
        thirdPassiveSkillText: rec.passives[2],
    });
}

describe.skipIf(!csvAvailable())(
    'applyPreCombatShipPassives — adjacent-allies grant gated by requiresAdjacentRole (Madax)',
    () => {
        // Madax's refit-active passive: "...When adjacent to a Supporter, this Unit receives
        // 30% more Repairs and increases that Supporter's Defense by 20% of this Unit's
        // Defense." The existence gate (line ~90-96) only asks WHETHER a qualifying adjacent
        // ally exists; the recipient set for `target: 'adjacent-allies'` must additionally be
        // FILTERED to just that role — a non-Supporter neighbour must not also receive it.
        const madaxSkills = (): ShipSkills => buildShipAbilities(shipFromCsv('Madax'));

        it('grants Defense ONLY to the adjacent Supporter, not to a non-Supporter also adjacent', () => {
            const madax = makePlan('mad', 'M2', {
                shipSkills: madaxSkills(),
                stats: { defence: 1000 },
            });
            const supporter = makePlan('sup', 'M3', { role: 'SUPPORTER' });
            const attacker = makePlan('atk', 'T1', { role: 'ATTACKER' }); // also adjacent to M2

            const applied = applyPreCombatShipPassives([madax, supporter, attacker]);

            expect(supporter.stats.defence).toBe(500 + 0.2 * 1000); // 700
            expect(attacker.stats.defence).toBe(500); // untouched — not a Supporter
            expect(applied.some((g) => g.recipientId === 'atk' && g.stat === 'defence')).toBe(
                false
            );
            expect(
                applied.some(
                    (g) => g.recipientId === 'sup' && g.stat === 'defence' && g.amount === 200
                )
            ).toBe(true);
        });
    }
);

describe('applyPreCombatShipPassives — simultaneity (frozen snapshot)', () => {
    it("Defiant's +20% own hp is computed from the PRE-grant snapshot, excluding Lionheart's gift; both apply", () => {
        // Lionheart(M2) ↔ Defiant(M3) adjacent; Supporter(M4) ↔ Defiant(M3) adjacent,
        // but M4 is NOT adjacent to M2 (no Lionheart grant to the supporter).
        const lionheart = makePlan('lion', 'M2', {
            passiveText: LIONHEART_TEXT,
            stats: { hp: 20_000 },
        });
        const defiant = makePlan('def', 'M3', { passiveText: DEFIANT_TEXT });
        const supporter = makePlan('sup', 'M4', { role: 'SUPPORTER' });

        const applied = applyPreCombatShipPassives([lionheart, defiant, supporter]);

        // Defiant: 10_000 + 20% of SNAPSHOT 10_000 (+2_000, NOT of 12_000) + Lionheart 2_000.
        expect(defiant.stats.hp).toBe(14_000);
        // Lionheart's own hp is untouched (grant computed from HIS snapshot, donor keeps it).
        expect(lionheart.stats.hp).toBe(20_000);
        // Supporter is adjacent to Defiant but not to Lionheart → untouched.
        expect(supporter.stats.hp).toBe(10_000);
        expect(applied).toEqual(
            expect.arrayContaining([
                { ownerId: 'lion', recipientId: 'def', stat: 'hp', amount: 2000 },
                { ownerId: 'def', recipientId: 'def', stat: 'hp', amount: 2000 },
            ])
        );
        expect(applied).toHaveLength(2);
    });
});

describe('applyPreCombatShipPassives — slot gating and no-op safety', () => {
    it('pre-combat-stat abilities on NON-passive slots are ignored', () => {
        // The parser emits the type on any slot whose text matches (defensive); only the
        // passive slot is a real pre-fight passive. Ship with the Lionheart sentence as
        // its ACTIVE skill text → the built active-slot ability must not fire.
        const activeOnly = buildShipAbilities(makeShip({ activeSkillText: LIONHEART_TEXT }));
        expect(
            activeOnly.slots.some(
                (s) => s.slot === 'active' && s.abilities.some((a) => a.type === 'pre-combat-stat')
            )
        ).toBe(true); // precondition: the ability exists on the active slot
        const owner = makePlan('own', 'M2', { shipSkills: activeOnly, stats: { hp: 20_000 } });
        const neighbour = makePlan('adj', 'M3');

        expect(applyPreCombatShipPassives([owner, neighbour])).toEqual([]);
        expect(neighbour.stats).toEqual(baseStats());
    });

    it('a squad with no pre-combat passives leaves every stat block deep-equal untouched', () => {
        const plans = [
            makePlan('a', 'M2', { role: 'DEFENDER' }),
            makePlan('b', 'M3', { role: 'SUPPORTER' }),
            makePlan('c', 'T1', { role: 'ATTACKER' }),
        ];
        const before = plans.map((p) => ({ ...p.stats }));
        expect(applyPreCombatShipPassives(plans)).toEqual([]);
        expect(plans.map((p) => p.stats)).toEqual(before);
    });

    it('returned descriptors exactly match the applied deltas', () => {
        const lionheart = makePlan('lion', 'M2', {
            passiveText: LIONHEART_TEXT,
            stats: { hp: 30_000 },
        });
        const a = makePlan('a', 'M3');
        const b = makePlan('b', 'T2');
        const before = new Map([a, b].map((p) => [p.id, { ...p.stats }]));

        const applied = applyPreCombatShipPassives([lionheart, a, b]);

        for (const grant of applied) {
            const plan = grant.recipientId === 'a' ? a : b;
            const pre = before.get(grant.recipientId);
            if (!pre) throw new Error('unexpected recipient');
            expect(plan.stats[grant.stat]).toBe(pre[grant.stat] + grant.amount);
        }
        expect(applied).toHaveLength(2); // both neighbours received exactly one grant
    });
});
