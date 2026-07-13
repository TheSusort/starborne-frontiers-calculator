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
    hp: number,
    // SP-M Task 3: optional extra statOverrides (e.g. `security`, or a `hacking` override for
    // the Vindicator on-resist fixture) merged over the defaults below. Backward-compatible —
    // every pre-existing 4-arg call site is byte-identical (extra defaults to {}).
    extra: Partial<BattlePlacement['statOverrides']> = {}
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
        ...extra,
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

/**
 * SP-M Task 3: the hpBasisPct reactive-damage path (Vindicator on-resist, Paracelsus
 * on-destroyed) shares the SAME applyReactiveDamage executor tail Task 2 gated on
 * `input.positionalTeamBattle` — no production change is expected here. These fixtures verify
 * that shared branch actually covers the hpBasisPct callers (real HP drop + damageDealt credit),
 * not just the flat-multiplier callers (FrontLine, above).
 */

// Verbatim from docs/ship-skills.csv (Vindicator, second_passive_skill_text — the R2/refit-active
// slot getShipSkillRows resolves for a 2-refit ship). Do NOT alter this text.
const VINDICATOR_P2 =
    "This Unit has 20% Shield Penetration. At the start of combat, this Unit gains <unit-skill>Magnetized Shielding</unit-skill>.<br /><br />When this Unit resists a debuff infliction from an enemy, it deals <unit-damage>damage equal to 30%</unit-damage> of this Unit's max HP to that enemy.";

// Verbatim from docs/ship-skills.csv (Paracelsus, first_passive_skill_text — the R0/innate slot,
// applies with zero refits). Do NOT alter this text.
const PARACELSUS_P1 =
    'Upon being killed by direct Damage, this Unit deals <unit-damage>Damage equal to 50%</unit-damage> of its max HP.';

const vindicator = (id: string): Ship =>
    ship(id, {
        type: 'Attacker',
        activeSkillText:
            'This Unit deals <unit-damage>100% damage</unit-damage> and applies <unit-skill>Provoke</unit-skill> for 1 turn to all enemies adjacent to the target.',
        secondPassiveSkillText: VINDICATOR_P2,
        // 2 refits → getShipSkillRows selects secondPassiveSkillText (skillRows.ts) as the
        // R2 active passive, carrying the on-resist retaliation clause.
        refits: [{}, {}] as unknown as Ship['refits'],
    });
// Real corpus-phrased "inflicts <unit-skill>X</unit-skill> for N turns" active (resistible —
// 'inflict' verbs are hacking-vs-security gated per skillTextParser's landing-verb split) with
// no damage clause, so it never itself changes the enemy's HP — isolating the delta to the
// retaliation. Mirrors ravagerResistReaction.integration.test.ts's inflictor fixture.
const debuffInflictor = (id: string): Ship =>
    ship(id, {
        activeSkillText: 'This Unit inflicts <unit-skill>Defense Down II</unit-skill> for 2 turns.',
    });

describe('SP-M M1: Vindicator on-resist reactive HP retaliation reduces the inflicting enemy HP (positional)', () => {
    // Vindicator's security is fixed at 300; only the enemy's hacking varies between the two
    // runs (isolates the delta to the resist/land outcome, same idiom as the FrontLine block
    // above varying only chargedEnemy vs plainEnemy). liveDebuffLandingChance (effectiveStats.ts):
    // clamp(hacking - security, 0, 100) / 100 — hacking:0 vs security:300 clamps to 0% (always
    // resisted, deterministic, no RNG draw); hacking:500 clamps to 100% (always lands).
    const run = (enemyHacking: number) =>
        simulateBattle({
            playerTeam: [place(vindicator('v'), 'M4', 1, 100_000, { security: 300 })],
            enemyTeam: [
                place(debuffInflictor('e1'), 'M4', 1, 1_000_000, { hacking: enemyHacking }),
            ],
            rounds: 2,
        });

    it('a resisted debuff retaliates against the inflicting enemy; delta reconciles dealt↔taken vs a landed control', () => {
        const resisted = run(0);
        const landed = run(500);
        const dealtDelta = sumDealt(resisted, ATTACKER) - sumDealt(landed, ATTACKER);
        const takenDelta = sumTaken(resisted, ENEMY) - sumTaken(landed, ENEMY);
        expect(dealtDelta).toBeGreaterThan(0);
        expect(takenDelta).toBeGreaterThan(0);
        expect(dealtDelta).toBeCloseTo(takenDelta, 5);
        expect(minHpPct(resisted, ENEMY)).toBeLessThan(minHpPct(landed, ENEMY));
    });
});

// 0%-damage active isolates the delta to the death-retaliation: Paracelsus never itself changes
// the enemy's HP through its own attack, in EITHER run (killable or unkillable).
const paracelsus = (id: string): Ship =>
    ship(id, {
        type: 'Attacker',
        activeSkillText: 'This Unit deals <unit-damage>0% damage</unit-damage>.',
        firstPassiveSkillText: PARACELSUS_P1,
    });
const killerEnemy = (id: string): Ship =>
    ship(id, { activeSkillText: 'This Unit deals <unit-damage>500% damage</unit-damage>.' });

describe('SP-M M1: Paracelsus on-destroyed reactive HP retaliation reduces the killer HP (positional)', () => {
    // Only Paracelsus's own HP varies between the two runs: killable (dies round 1 to the
    // killer's 500%-damage hit, on-destroyed retaliation fires against the killer) vs
    // effectively unkillable (survives both rounds, never destroyed, no proc).
    const run = (paracelsusHp: number) =>
        simulateBattle({
            playerTeam: [place(paracelsus('p'), 'M4', 1, paracelsusHp)],
            enemyTeam: [place(killerEnemy('e1'), 'M4', 100_000, 1_000_000)],
            rounds: 2,
        });

    it('a killed Paracelsus retaliates for HP damage against its killer; delta reconciles dealt↔taken vs a surviving control', () => {
        const killable = run(10_000);
        const surviving = run(1e12);
        const dealtDelta = sumDealt(killable, ATTACKER) - sumDealt(surviving, ATTACKER);
        const takenDelta = sumTaken(killable, ENEMY) - sumTaken(surviving, ENEMY);
        expect(dealtDelta).toBeGreaterThan(0);
        expect(takenDelta).toBeGreaterThan(0);
        expect(dealtDelta).toBeCloseTo(takenDelta, 5);
        expect(minHpPct(killable, ENEMY)).toBeLessThan(minHpPct(surviving, ENEMY));
    });
});
