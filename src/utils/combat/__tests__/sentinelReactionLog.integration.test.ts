/**
 * #2 (reaction-only-on-turn) end-to-end log visibility, through the REAL sim path
 * (planPlacement -> simulateBattle -> buildCombatLog).
 *
 * Sentinel's refit-active passive (docs/ship-skills.csv, verbatim): "When an ally critically hits
 * an enemy, this Unit repairs the ally for 5% of this Unit's Max HP and deals 60% damage to that
 * enemy." Both ride on-ally-crit. Drain-time reactive damage/heal emit no ability/heal event
 * (chain guard), so they surface via the LOG-ONLY reactive-damage-performed / reactive-heal-performed
 * events, nested under the crit-ing ally's turn — never on Sentinel's own turn.
 *
 * Non-vacuity: without the parser/trigger fix the reactions never fire; without the log-only
 * emits they fire but stay invisible — both make the "surfaces in the log" assertions red.
 */
import { describe, it, expect } from 'vitest';
import { simulateBattle, BattlePlacement } from '../../calculators/battleSimulator';
import { flattenCombatLog } from '../log/__testutils__/flattenCombatLog';
import type { Ship } from '../../../types/ship';
import type { GearPiece } from '../../../types/gear';

const SENTINEL_R2 =
    "When an ally critically hits an enemy, this Unit <unit-damage>repairs the ally for 5%</unit-damage> of this Unit's Max HP and deals <unit-damage>60% damage</unit-damage> to that enemy.<br />This attack cannot critically hit.";

const makeShip = (id: string, name: string, over: Partial<Ship> = {}): Ship => ({
    id,
    name,
    rarity: 'legendary',
    faction: 'TERRAN_COMBINE',
    type: 'Attacker',
    baseStats: {
        hp: 0,
        attack: 0,
        defence: 0,
        hacking: 0,
        security: 0,
        crit: 0,
        critDamage: 0,
        speed: 100,
    },
    equipment: {},
    implants: {},
    refits: [],
    affinity: 'antimatter',
    activeSkillText: 'This Unit deals <unit-damage>100% damage</unit-damage>.',
    chargeSkillCharge: 0,
    activeTarget: 'front',
    activePattern: 'Pattern-Base',
    ...over,
});

const placement = (
    ship: Ship,
    position: BattlePlacement['position'],
    over: Partial<NonNullable<BattlePlacement['statOverrides']>>
): BattlePlacement => ({
    ship,
    position,
    statOverrides: {
        attack: 1000,
        crit: 0,
        critDamage: 100,
        defensePenetration: 0,
        hacking: 0,
        defence: 0,
        hp: 20_000,
        speed: 100,
        ...over,
    },
});

const noGear = (): GearPiece | undefined => undefined;

describe('Sentinel reactions surface in the combat log (real sim path)', () => {
    // Sentinel: buff-only active (no on-turn damage), R2 refit passive, acts LAST. A fast ally
    // crits the enemy → Sentinel reacts. Enemy is an indestructible punching bag.
    const build = () => {
        const sentinel = makeShip('sentinel', 'Sentinel', {
            activeSkillText: 'This Unit grants <unit-skill>Attack Up III</unit-skill> for 1 turn.',
            secondPassiveSkillText: SENTINEL_R2,
            refits: [{}, {}] as Ship['refits'],
        });
        const critAlly = makeShip('critter', 'Critter');
        const enemy = makeShip('dummy', 'Dummy');

        const result = simulateBattle(
            {
                playerTeam: [
                    placement(sentinel, 'M3', { attack: 1000, crit: 0, hp: 20_000, speed: 1 }),
                    placement(critAlly, 'M2', { attack: 1000, crit: 100, hp: 20_000, speed: 300 }),
                ],
                enemyTeam: [
                    placement(enemy, 'M4', { attack: 1, crit: 0, hp: 1_000_000_000, speed: 1000 }),
                ],
                rounds: 1,
            },
            noGear
        );
        const sentinelId = result.roster.find((r) => r.name === 'Sentinel')?.actorId;
        expect(sentinelId).toBeDefined();
        return { result, sentinelId: sentinelId! };
    };

    it("Sentinel's reactive damage appears in the log as an attack entry", () => {
        const { result, sentinelId } = build();
        const sentinelAttacks = flattenCombatLog(result).filter(
            (e) => e.kind === 'attack' && e.actorId === sentinelId
        );
        expect(sentinelAttacks.length).toBeGreaterThan(0);
        expect(sentinelAttacks.some((e) => e.targets.some((t) => (t.amount ?? 0) > 0))).toBe(true);
    });

    it("Sentinel's reactive repair appears in the log as a heal entry", () => {
        const { result, sentinelId } = build();
        const sentinelHeals = flattenCombatLog(result).filter(
            (e) => e.kind === 'heal' && e.actorId === sentinelId
        );
        expect(sentinelHeals.length).toBeGreaterThan(0);
    });

    it('Sentinel does NO damage or heal on its OWN turn (reactions nest under the ally, not its turn)', () => {
        const { result, sentinelId } = build();
        const sentinelTurns = result.combatLog
            .flatMap((r) => r.turns)
            .filter((t) => t.actorId === sentinelId);
        expect(sentinelTurns.length).toBeGreaterThan(0);
        const ownTurnEntries = sentinelTurns.flatMap((t) => t.entries);
        // No repair on its own turn — this is the fixed leak. (A buff-only turn still opens an
        // empty 0-damage attack ROW — a separate pre-existing cosmetic issue — so we assert no
        // attack lands actual DAMAGE rather than no attack entry at all.)
        expect(ownTurnEntries.some((e) => e.kind === 'heal')).toBe(false);
        expect(
            ownTurnEntries.some(
                (e) => e.kind === 'attack' && e.targets.some((t) => (t.amount ?? 0) > 0)
            )
        ).toBe(false);
    });
});
