/**
 * SP-M M1: reactive-damage procs REDUCE the resolved victim's real HP in a positioned two-team
 * battle (simulateBattle → input.positionalTeamBattle), surface on the victim's damageTaken, and
 * are attributed to the owner via damageDealt (perTargetDealt). DPS/healing credit-only behaviour
 * is unchanged (guards: enemyChargedCast / reactiveDamageMitigation, which lack positionalTeamBattle).
 */
import { describe, it, expect } from 'vitest';
import { simulateBattle, BattlePlacement } from '../../calculators/battleSimulator';
import type { Ship } from '../../../types/ship';
import type { Position } from '../../../types/encounters';

const FRONTLINE_R2_TEXT =
    'This ship has 20% Shield Penetration.<br />While Shielded, it gains 2500 additional Defense.<br />This Unit gains <unit-damage>Shield equal to 25%</unit-damage> of its Max HP at the start of combat.<br /><br />When an enemy uses their Charged skill, it deals <unit-damage>80%</unit-damage> and gains a Shield equal to <unit-damage>30%</unit-damage> of the damage dealt, once per round.';

export const ship = (id: string, over: Partial<Ship>): Ship =>
    ({
        id,
        name: id,
        rarity: 'legendary',
        faction: 'TERRAN_COMBINE',
        type: 'Attacker',
        baseStats: {} as Ship['baseStats'],
        equipment: {},
        implants: {},
        refits: [],
        affinity: 'antimatter',
        activePattern: 'Pattern-Base',
        activeTarget: 'front',
        chargeSkillCharge: 0,
        ...over,
    }) as Ship;

export const place = (
    s: Ship,
    position: Position,
    attack: number,
    hp: number
): BattlePlacement => ({
    ship: s,
    position,
    statOverrides: {
        attack,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        hacking: 200,
        defence: 0,
        hp,
    },
});

export const sumDealt = (r: ReturnType<typeof simulateBattle>, id: string): number =>
    r.rounds.reduce((s, rd) => s + (rd.ships.find((x) => x.actorId === id)?.damageDealt ?? 0), 0);
export const sumTaken = (r: ReturnType<typeof simulateBattle>, id: string): number =>
    r.rounds.reduce((s, rd) => s + (rd.ships.find((x) => x.actorId === id)?.damageTaken ?? 0), 0);
export const minHpPct = (r: ReturnType<typeof simulateBattle>, id: string): number =>
    Math.min(...r.rounds.map((rd) => rd.ships.find((x) => x.actorId === id)?.hpPct ?? 100));

const frontline = (id: string): Ship =>
    ship(id, {
        type: 'Defender',
        activeTarget: 'allies',
        activeSkillText: 'This Unit repairs 1% of its Max HP.',
        secondPassiveSkillText: FRONTLINE_R2_TEXT,
        refits: [{}, {}] as unknown as Ship['refits'],
    });
const chargedEnemy = (id: string): Ship =>
    ship(id, {
        activeSkillText:
            'This Unit deals <unit-damage>1% damage</unit-damage>. This Unit starts combat fully charged.',
        chargeSkillText: 'This Unit deals <unit-damage>50% damage</unit-damage>.',
        chargeSkillCharge: 1,
    });
const plainEnemy = (id: string): Ship =>
    ship(id, { activeSkillText: 'This Unit deals <unit-damage>1% damage</unit-damage>.' });

const ATTACKER = 'attacker';
const ENEMY = 'e:e1:0';

describe('SP-M M1: FrontLine reactive damage reduces the charging enemy HP (positional)', () => {
    const run = (enemy: Ship) =>
        simulateBattle({
            playerTeam: [place(frontline('fl'), 'M4', 10_000, 1e12)],
            enemyTeam: [place(enemy, 'M4', 1, 1e12)],
            rounds: 2,
        });

    it('the charging enemy loses HP to FrontLine reactive damage; delta reconciles dealt↔taken', () => {
        const reaction = run(chargedEnemy('e1'));
        const control = run(plainEnemy('e1'));
        const dealtDelta = sumDealt(reaction, ATTACKER) - sumDealt(control, ATTACKER);
        const takenDelta = sumTaken(reaction, ENEMY) - sumTaken(control, ENEMY);
        expect(dealtDelta).toBeGreaterThan(0);
        expect(takenDelta).toBeGreaterThan(0);
        expect(dealtDelta).toBeCloseTo(takenDelta, 5);
        expect(minHpPct(reaction, ENEMY)).toBeLessThan(minHpPct(control, ENEMY));
    });
});
