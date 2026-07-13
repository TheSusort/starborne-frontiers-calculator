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
import { flattenCombatLog } from '../log/__testutils__/flattenCombatLog';

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

/**
 * SP-M M1 Task 4: Grif's on-enemy-cleansed reactive (triggers.ts's `cfg.type === 'damage'`
 * branch, `targetId = intent.eventCtx?.counterTargetId ?? ctx.enemy.id`) must land on the REAL
 * cleansing enemy in positional mode, not the vestigial dummy `enemy` — the on-enemy-cleansed
 * listener (triggers.ts ~846) did not stamp `counterTargetId`, so `targetId` fell back to
 * `ctx.enemy.id`, which the `victim.id !== enemy.id` backstop excludes → 0 real HP, credit-only.
 *
 * Grif (player-side, the focus) needs an opposing cast that actually cleanses a debuff. A second
 * player-side ship inflicts a removable debuff onto the lone enemy (same idiom as this file's
 * Vindicator `debuffInflictor`, just aimed the other way); the enemy's own active then cleanses
 * that debuff FROM ITSELF (parseCleanse: "from itself" -> target:'self', explicitTarget:true —
 * skips buildShipAbilities' bare-support-cast ally flip), firing a real `cleanse-performed` with
 * casterId = the enemy's own actor id.
 */

// Verbatim from docs/ship-skills.csv (Grif, first_passive_skill_text — the R0/innate slot,
// applies with zero refits). Do NOT alter this text.
const GRIF_P1 =
    'When an enemy <unit-aid>cleanses a Debuff</unit-aid>, this Unit deals <unit-damage>75% Damage</unit-damage> that cannot critically hit.';

const grif = (id: string): Ship =>
    ship(id, {
        type: 'Attacker',
        // 0%-damage active isolates the HP delta to the reactive proc — Grif's own attack never
        // itself changes the enemy's HP, in EITHER run (mirrors the Paracelsus 0%-damage idiom).
        activeSkillText: 'This Unit deals <unit-damage>0% damage</unit-damage>.',
        firstPassiveSkillText: GRIF_P1,
    });

// A second player-side ship whose active inflicts a removable debuff onto the lone enemy — the
// enemy needs something to cleanse. Same text as this file's Vindicator `debuffInflictor`
// fixture, just carried by a player ship targeting the enemy instead of an enemy targeting a
// player (the verb-based 'enemy' target resolution is side-agnostic).
const debuffPlanter = (id: string): Ship =>
    ship(id, {
        activeSkillText: 'This Unit inflicts <unit-skill>Defense Down II</unit-skill> for 2 turns.',
    });

// The enemy: cleanses a debuff FROM ITSELF (real corpus idiom, e.g. Nuqtu's "from itself").
const selfCleanser = (id: string): Ship =>
    ship(id, { activeSkillText: 'This Unit cleanses 1 debuff from itself.' });

describe("SP-M M1 Task 4: Grif's on-enemy-cleansed reactive lands on the real cleansing enemy (positional)", () => {
    const run = (enemy: Ship) =>
        simulateBattle({
            playerTeam: [
                place(grif('g'), 'M4', 1, 1_000_000),
                place(debuffPlanter('inf'), 'M3', 5_000, 1_000_000),
            ],
            enemyTeam: [place(enemy, 'M4', 1, 1_000_000)],
            rounds: 2,
        });

    it("a cleansing enemy loses HP to Grif's reactive damage; delta reconciles dealt<->taken vs a no-cleanse control", () => {
        const reaction = run(selfCleanser('e1'));
        const control = run(plainEnemy('e1'));

        // Distinguishes "reactive fired but landed on the dummy (0 real HP)" from "no reaction
        // fired at all": a kind:'attack' log entry keyed on Grif's OWN actor id (ATTACKER) with a
        // positive amount, distinct from Grif's own 0%-damage active. Present in BOTH the pre-fix
        // and post-fix state — the fix only changes WHERE the damage lands, not whether it fires.
        const grifReactiveHits = flattenCombatLog(reaction).filter(
            (e) => e.kind === 'attack' && e.actorId === ATTACKER && (e.targets[0]?.amount ?? 0) > 0
        );
        expect(grifReactiveHits.length).toBeGreaterThan(0);

        const dealtDelta = sumDealt(reaction, ATTACKER) - sumDealt(control, ATTACKER);
        const takenDelta = sumTaken(reaction, ENEMY) - sumTaken(control, ENEMY);
        expect(dealtDelta).toBeGreaterThan(0);
        expect(takenDelta).toBeGreaterThan(0);
        expect(dealtDelta).toBeCloseTo(takenDelta, 5);
        expect(minHpPct(reaction, ENEMY)).toBeLessThan(minHpPct(control, ENEMY));
    });
});

/**
 * SP-M M1 Task 5: Rhodium's end-of-round co-located purge+damage sentence ("At the end of the
 * round, this Unit purges 2 buffs from the enemy with the most buffs and deals 80% damage that
 * cannot critically hit.") must route the DAMAGE clause to the SAME enemy-most-buffs selector the
 * purge clause already resolves (ctx.enemyWithMostBuffs), not the co-located `target:'enemy'`
 * default that falls back to the vestigial dummy `ctx.enemy` in positional mode. With two real
 * enemies on the opposing roster and only ONE of them carrying a buff, the most-buffed enemy must
 * take the real HP hit — and the OTHER enemy (still alive, never the selector's pick) must NOT.
 */

// Verbatim from docs/ship-skills.csv (Rhodium, second_passive_skill_text — the R2/refit-active
// slot getShipSkillRows resolves for a 2-refit ship). Do NOT alter this text.
const RHODIUM_P2 =
    'At the end of the round, this Unit <unit-aid>purges 2</unit-aid> buffs from the enemy with ' +
    'the most buffs and deals <unit-damage>80% damage</unit-damage> that cannot critically hit.';

const rhodium = (id: string): Ship =>
    ship(id, {
        type: 'Attacker',
        // 0%-damage active isolates the HP delta to the reactive proc — Rhodium's own attack
        // never itself changes either enemy's HP, in EITHER run (mirrors the Paracelsus/Grif
        // 0%-damage idiom above).
        activeSkillText: 'This Unit deals <unit-damage>0% damage</unit-damage>.',
        secondPassiveSkillText: RHODIUM_P2,
        // 2 refits → getShipSkillRows selects secondPassiveSkillText (skillRows.ts) as the R2
        // active passive, carrying the co-located purge + 80%-no-crit damage clause.
        refits: [{}, {}] as unknown as Ship['refits'],
    });

// A self-buff-granting active (real corpus idiom — Boost gear set fixtures use the same
// "gains <unit-skill>Attack Up III</unit-skill> for N turns" phrasing) — the ONLY thing that
// distinguishes this enemy from `plainEnemy` (which grants no buff at all), so
// `mostBuffsAmong` picks it deterministically over its buff-less teammate.
const buffedEnemy = (id: string): Ship =>
    ship(id, {
        activeSkillText: 'This Unit gains <unit-skill>Attack Up III</unit-skill> for 2 turns.',
    });

const ENEMY2 = 'e:e2:1';

describe("SP-M M1 Task 5: Rhodium's end-of-round damage lands on the most-buffed enemy, not the other (positional)", () => {
    const run = (e1: Ship, e2: Ship) =>
        simulateBattle({
            playerTeam: [place(rhodium('r'), 'M4', 10_000, 1e12)],
            enemyTeam: [place(e1, 'M4', 1, 1e12), place(e2, 'M3', 1, 1e12)],
            rounds: 2,
        });

    it('the buffed enemy loses HP to the reactive damage; the buff-less enemy does not; delta reconciles dealt<->taken', () => {
        // reaction: e1 self-buffs (most buffs) vs e2 plain (no buffs anywhere else either) —
        // mostBuffsAmong picks e1 deterministically.
        const reaction = run(buffedEnemy('e1'), plainEnemy('e2'));
        // control: BOTH enemies buff-less — mostBuffsAmong's own "no buffs anywhere" case
        // returns undefined, so the whole proc (purge + damage) no-ops for the whole round.
        const control = run(plainEnemy('e1'), plainEnemy('e2'));

        // Confirms the reaction actually FIRED (not "no proc") — a kind:'attack' log entry keyed
        // on Rhodium's OWN actor id (ATTACKER) with a positive amount, distinct from Rhodium's own
        // 0%-damage active. Present only in the reaction run.
        const rhodiumReactiveHits = flattenCombatLog(reaction).filter(
            (e) => e.kind === 'attack' && e.actorId === ATTACKER && (e.targets[0]?.amount ?? 0) > 0
        );
        expect(rhodiumReactiveHits.length).toBeGreaterThan(0);

        const dealtDelta = sumDealt(reaction, ATTACKER) - sumDealt(control, ATTACKER);
        const takenDeltaBuffed = sumTaken(reaction, ENEMY) - sumTaken(control, ENEMY);
        const takenDeltaOther = sumTaken(reaction, ENEMY2) - sumTaken(control, ENEMY2);

        expect(dealtDelta).toBeGreaterThan(0);
        expect(takenDeltaBuffed).toBeGreaterThan(0);
        expect(dealtDelta).toBeCloseTo(takenDeltaBuffed, 5);
        expect(minHpPct(reaction, ENEMY)).toBeLessThan(minHpPct(control, ENEMY));

        // The OTHER enemy (never the selector's pick) must be untouched by the reactive proc.
        expect(takenDeltaOther).toBeCloseTo(0, 5);
        expect(minHpPct(reaction, ENEMY2)).toBeCloseTo(minHpPct(control, ENEMY2), 5);
    });
});

/**
 * SP-M M1 Task 5 review fix: TWO same-side Rhodiums drain their end-of-round purge+damage pair
 * off the SAME batch/ctx (drainQueue's single ctx instance for the whole round-end drain). Each
 * Rhodium's `enemyWithMostBuffs` resolution must be keyed by ITS OWN ownerId, re-resolving LIVE
 * per owner — not memoized once for the whole batch regardless of which owner asks.
 *
 * Fixture: eA starts with 2 buffs (Attack Up III + Defense Up III), eB with 1 (Attack Up III) —
 * eA is strictly more-buffed, so the FIRST Rhodium to resolve picks eA and its purge strips both
 * of eA's buffs. By the time the SECOND Rhodium resolves, eB (still 1 buff) is now the
 * most-buffed enemy on the roster (eA has 0).
 *
 * Pre-fix (batch-wide, ownerId-blind `once()`): whichever resolution happens FIRST is cached and
 * reused for BOTH Rhodiums regardless of ownerId — eB never receives any reactive damage at all,
 * and the cached enemy (eA) is hit TWICE (once per Rhodium). Post-fix (ownerId-keyed memo): each
 * Rhodium re-resolves independently, seeing the current (post-first-purge) buff state — eA takes
 * exactly one Rhodium's damage, eB takes the other's.
 */
const R1_ID = ATTACKER; // player[0] → reserved 'attacker' focus id (battleSimulator.ts FOCUS_ID)
const R2_ID = 'p:r2:1'; // player[1] → globally-unique id (battleSimulator.ts naming convention)
const ENEMY_A = 'e:eA:0';
const ENEMY_B = 'e:eB:1';

// Two DISTINCT buffs (real corpus "gains X for N turns" idiom, twice) — strictly more-buffed
// than eB's single buff below, so mostBuffsAmong picks eA deterministically on the FIRST
// (pre-any-purge) resolution.
const twoBuffsEnemy = (id: string): Ship =>
    ship(id, {
        activeSkillText:
            'This Unit gains <unit-skill>Attack Up III</unit-skill> for 2 turns. This Unit gains <unit-skill>Defense Up III</unit-skill> for 2 turns.',
    });

describe('SP-M M1 Task 5 review fix: two same-side Rhodiums re-resolve enemy-most-buffs per owner (positional)', () => {
    const run = (eA: Ship, eB: Ship) =>
        simulateBattle({
            playerTeam: [
                place(rhodium('r1'), 'M4', 10_000, 1e12),
                place(rhodium('r2'), 'M3', 10_000, 1e12),
            ],
            enemyTeam: [place(eA, 'M4', 1, 1e12), place(eB, 'M3', 1, 1e12)],
            rounds: 2,
        });

    it("after the first Rhodium's purge strips eA's buffs, the second Rhodium's pair re-resolves to eB instead of re-hitting eA", () => {
        // reaction: eA starts most-buffed (2), eB less (1) — once eA is purged to 0, eB becomes
        // most-buffed for whichever Rhodium resolves second.
        const reaction = run(twoBuffsEnemy('eA'), buffedEnemy('eB'));
        // control: both buff-less — mostBuffsAmong's "no buffs anywhere" case, the whole proc
        // no-ops for BOTH Rhodiums (same idiom as the single-Rhodium Task 5 control above).
        const control = run(plainEnemy('eA'), plainEnemy('eB'));

        const takenDeltaA = sumTaken(reaction, ENEMY_A) - sumTaken(control, ENEMY_A);
        const takenDeltaB = sumTaken(reaction, ENEMY_B) - sumTaken(control, ENEMY_B);

        // The load-bearing assertion: BOTH enemies must take reactive damage. Pre-fix, one of
        // these is exactly 0 (the never-selected enemy) while the other silently absorbs both
        // Rhodiums' damage — this is what distinguishes the ownerId-keyed fix from the bug.
        expect(takenDeltaA).toBeGreaterThan(0);
        expect(takenDeltaB).toBeGreaterThan(0);

        const dealtDeltaR1 = sumDealt(reaction, R1_ID) - sumDealt(control, R1_ID);
        const dealtDeltaR2 = sumDealt(reaction, R2_ID) - sumDealt(control, R2_ID);
        // Total dealt (both Rhodiums) reconciles with total taken (both enemies) — no damage is
        // manufactured or dropped, only correctly re-routed per owner.
        expect(dealtDeltaR1 + dealtDeltaR2).toBeCloseTo(takenDeltaA + takenDeltaB, 5);
        // Each Rhodium's own reactive dealt is non-zero (both actually fired their proc).
        expect(dealtDeltaR1).toBeGreaterThan(0);
        expect(dealtDeltaR2).toBeGreaterThan(0);
    });
});

/**
 * SP-M M1 Task 6: Chakara's start-of-round continuation sentence ("This Unit starts each round
 * with Attack Up II and Defense Up II for 1 turn if it has the lowest speed among all Allies.
 * Then, deals 60% damage to the highest Speed Enemy.") must route the damage clause to the LIVE
 * highest-Speed opposing actor (ctx.enemyWithHighestSpeed), not the co-located `target:'enemy'`
 * default that falls back to the vestigial dummy `ctx.enemy` in positional mode. With two real
 * enemies of different Speed, only the FASTER one must take the real HP hit — the slower enemy
 * (never the selector's pick) must not.
 */

// Verbatim from docs/ship-skills.csv (Chakara, third_passive_skill_text — the R4/refit-active
// slot getShipSkillRows resolves for a 4-refit ship). Do NOT alter this text.
const CHAKARA_P4 =
    'This Unit starts each round with <unit-skill>Attack Up II</unit-skill> and ' +
    '<unit-skill>Defense Up II</unit-skill> for 1 turn if it has the lowest speed among all ' +
    'Allies. Then, deals <unit-damage>60% damage</unit-damage> to the highest Speed Enemy.';

// `withPassive` isolates the HP delta to the reactive proc firing at all — the reaction run
// carries Chakara's real R4 passive text (4 refits, per getShipSkillRows), the control run omits
// it entirely (no refits, no passive text) so the whole proc no-ops for both enemies, mirroring
// the Rhodium Task 5 "no proc anywhere" control idiom above.
const chakara = (id: string, withPassive: boolean): Ship =>
    ship(id, {
        type: 'Attacker',
        // 0%-damage active isolates the HP delta to the reactive proc — Chakara's own attack
        // never itself changes either enemy's HP, in EITHER run (mirrors the Paracelsus/Grif/
        // Rhodium 0%-damage idiom above).
        activeSkillText: 'This Unit deals <unit-damage>0% damage</unit-damage>.',
        ...(withPassive
            ? {
                  thirdPassiveSkillText: CHAKARA_P4,
                  refits: [{}, {}, {}, {}] as unknown as Ship['refits'],
              }
            : {}),
    });

describe("SP-M M1 Task 6: Chakara's start-of-round damage lands on the highest-Speed enemy, not the other (positional)", () => {
    // e1 (ENEMY) is fixed at Speed 100, e2 (ENEMY2) at Speed 300 — e2 is the faster enemy in
    // BOTH the reaction and control run, so the only thing that differs between the two runs is
    // whether Chakara's passive (and therefore the proc) exists at all.
    const run = (withPassive: boolean) =>
        simulateBattle({
            playerTeam: [place(chakara('c', withPassive), 'M4', 10_000, 1e12)],
            enemyTeam: [
                place(plainEnemy('e1'), 'M4', 1, 1e12, { speed: 100 }),
                place(plainEnemy('e2'), 'M3', 1, 1e12, { speed: 300 }),
            ],
            rounds: 2,
        });

    it('the higher-Speed enemy loses HP to the reactive damage; the slower enemy does not; delta reconciles dealt<->taken', () => {
        const reaction = run(true);
        const control = run(false);

        // Confirms the reaction actually FIRED (not "no proc") — a kind:'attack' log entry keyed
        // on Chakara's OWN actor id (ATTACKER) with a positive amount, distinct from Chakara's own
        // 0%-damage active. Present only in the reaction run.
        const chakaraReactiveHits = flattenCombatLog(reaction).filter(
            (e) => e.kind === 'attack' && e.actorId === ATTACKER && (e.targets[0]?.amount ?? 0) > 0
        );
        expect(chakaraReactiveHits.length).toBeGreaterThan(0);

        const dealtDelta = sumDealt(reaction, ATTACKER) - sumDealt(control, ATTACKER);
        const takenDeltaFaster = sumTaken(reaction, ENEMY2) - sumTaken(control, ENEMY2);
        const takenDeltaSlower = sumTaken(reaction, ENEMY) - sumTaken(control, ENEMY);

        expect(dealtDelta).toBeGreaterThan(0);
        expect(takenDeltaFaster).toBeGreaterThan(0);
        expect(dealtDelta).toBeCloseTo(takenDeltaFaster, 5);
        expect(minHpPct(reaction, ENEMY2)).toBeLessThan(minHpPct(control, ENEMY2));

        // The slower enemy (never the selector's pick) must be untouched by the reactive proc.
        expect(takenDeltaSlower).toBeCloseTo(0, 5);
        expect(minHpPct(reaction, ENEMY)).toBeCloseTo(minHpPct(control, ENEMY), 5);
    });
});

/**
 * SP-M M1 Task 7: Judge's start-of-round passive ("At the start of the round, this Unit deals 60%
 * damage to all enemies with less than 50% HP.") is a per-victim-CONDITIONAL AoE — it must hit
 * EVERY living enemy below 50% HP (not one, not the vestigial dummy) with real HP loss, and skip
 * the enemies above 50%. Pre-fix (target:'enemy', single-victim → dummy fallback) no real enemy
 * loses HP to Judge. Post-fix (target:'all-enemies', per-victim hp-threshold re-check) exactly the
 * two <50%-HP enemies lose HP and the >50% one does not, and Judge's dealt reconciles with the sum
 * of the two victims' Judge-attributed damageTaken.
 *
 * Fixture note — a Pattern-All "pre-damager" ally (player[1]) chips ALL enemies ONCE in round 1
 * (to 33% for the two small-HP enemies, ~100% for the huge-HP one), then is KILLED that same round
 * by the front enemy's 100%-damage active (it is placed at the front M4; Judge sits at the back B4,
 * out of the enemies' reach). Because the pre-damager fires first (speed 1000) and dies before
 * round 2, there is NO second chip — so the two small enemies stay alive at 33% into round 2, where
 * Judge's start-of-round hit lands on them without any overkill/capping confusing the reconciliation.
 */
const JUDGE_PASSIVE =
    'At the start of the round, this Unit deals <unit-damage>60% damage</unit-damage> to all ' +
    'enemies with less than 50% HP.';

// `withPassive` isolates the HP delta to the reactive proc firing at all (mirrors the Chakara
// idiom above): the reaction run carries Judge's start-of-round passive (firstPassiveSkillText —
// the R0/innate slot, applies with zero refits, same slot Grif/Paracelsus use), the control run
// omits it entirely so the proc no-ops for every enemy.
const judge = (id: string, withPassive: boolean): Ship =>
    ship(id, {
        type: 'Attacker',
        // 0%-damage active isolates the HP delta to the reactive proc — Judge's own attack never
        // itself changes any enemy's HP, in EITHER run (mirrors the Paracelsus/Grif/Rhodium idiom).
        activeSkillText: 'This Unit deals <unit-damage>0% damage</unit-damage>.',
        ...(withPassive ? { firstPassiveSkillText: JUDGE_PASSIVE } : {}),
    });
// Pattern-All ally that chips ALL enemies once (real AoE idiom — simGoldenFixtures' Comet uses the
// same activePattern:'Pattern-All' + "to all enemies" text). Fragile HP (100) + front placement so
// the front enemy's 100%-damage active kills it in round 1 after it has already chipped.
const preDamagerAll = (id: string): Ship =>
    ship(id, {
        activeSkillText: 'This Unit deals <unit-damage>100% damage</unit-damage> to all enemies.',
        activePattern: 'Pattern-All',
        activeTarget: 'front',
    });
// Front enemy that KILLS the pre-damager in round 1 (100%-damage active vs the pre-damager's 100
// HP). Also one of the two <50%-HP Judge victims (its own attack does not affect its own HP).
const preDamagerKiller = (id: string): Ship =>
    ship(id, { activeSkillText: 'This Unit deals <unit-damage>100% damage</unit-damage>.' });

const JUDGE = ATTACKER; // Judge is player[0] → the reserved 'attacker' focus id
const E_LOW1 = 'e:lo1:0';
const E_LOW2 = 'e:lo2:1';
const E_HIGH = 'e:hi:2';

describe("SP-M M1 Task 7: Judge's start-of-round damage hits ALL <50%-HP enemies, not the >50% one (positional)", () => {
    const run = (withPassive: boolean) =>
        simulateBattle({
            playerTeam: [
                // Judge at the BACK, low attack (its reactive 60% must not KILL a 33%-HP victim,
                // so the victim survives in both runs → clean reconciliation), huge HP (survives).
                place(judge('j', withPassive), 'B4', 500, 1e12, { speed: 50 }),
                // Pre-damager at the FRONT (enemies target it), fragile, fastest (chips first).
                place(preDamagerAll('pre'), 'M4', 1000, 100, { speed: 1000 }),
            ],
            enemyTeam: [
                // Two small-HP enemies (1500) → one round-1 chip of 1000 leaves them at 33% (<50%).
                // lo1 additionally carries the 100%-damage active that kills the pre-damager.
                place(preDamagerKiller('lo1'), 'M4', 100_000, 1500, { speed: 100 }),
                place(plainEnemy('lo2'), 'M3', 1, 1500, { speed: 100 }),
                // Huge-HP enemy → the same 1000 chip leaves it ~100% (>50%): Judge must SKIP it.
                place(plainEnemy('hi'), 'B2', 1, 1e9, { speed: 100 }),
            ],
            rounds: 2,
        });

    it('the two <50%-HP enemies lose HP to Judge; the >50% one does not; dealt reconciles with the two victims summed', () => {
        const reaction = run(true);
        const control = run(false);

        // Confirms the reaction actually FIRED — a kind:'attack' log entry keyed on Judge's OWN
        // actor id with a positive amount, distinct from Judge's 0%-damage active. Present only in
        // the reaction run (pre-fix this fires against the vestigial dummy, landing 0 real HP —
        // which the per-enemy takenDelta assertions below are what actually catch).
        const judgeReactiveHits = flattenCombatLog(reaction).filter(
            (e) => e.kind === 'attack' && e.actorId === JUDGE && (e.targets[0]?.amount ?? 0) > 0
        );
        expect(judgeReactiveHits.length).toBeGreaterThan(0);

        const takenDeltaLow1 = sumTaken(reaction, E_LOW1) - sumTaken(control, E_LOW1);
        const takenDeltaLow2 = sumTaken(reaction, E_LOW2) - sumTaken(control, E_LOW2);
        const takenDeltaHigh = sumTaken(reaction, E_HIGH) - sumTaken(control, E_HIGH);
        const dealtDelta = sumDealt(reaction, JUDGE) - sumDealt(control, JUDGE);

        // Both <50%-HP enemies take Judge's reactive damage.
        expect(takenDeltaLow1).toBeGreaterThan(0);
        expect(takenDeltaLow2).toBeGreaterThan(0);
        expect(minHpPct(reaction, E_LOW1)).toBeLessThan(minHpPct(control, E_LOW1));
        expect(minHpPct(reaction, E_LOW2)).toBeLessThan(minHpPct(control, E_LOW2));

        // The >50%-HP enemy is NEVER a victim — untouched by the reactive proc.
        expect(takenDeltaHigh).toBeCloseTo(0, 5);
        expect(minHpPct(reaction, E_HIGH)).toBeCloseTo(minHpPct(control, E_HIGH), 5);

        // Reconciliation: Judge's total reactive damageDealt == Σ of the two victims' Judge-
        // attributed damageTaken (no damage manufactured or dropped across the AoE).
        expect(dealtDelta).toBeGreaterThan(0);
        expect(dealtDelta).toBeCloseTo(takenDeltaLow1 + takenDeltaLow2, 5);
    });
});

/**
 * SP-M M1 Task 7: Incinerator's end-of-round passive ("At the end of the round, this unit deals
 * 100% damage to all enemies with Inferno.") is a per-victim-CONDITIONAL AoE gated on the enemy-
 * debuff name 'Inferno'. Incinerator's active inflicts Inferno III on the FRONT enemy only (single-
 * target Pattern-Base); the back enemy never receives it. Only the Inferno-afflicted enemy may take
 * the end-of-round hit. Pre-fix (target:'enemy' → dummy) no real enemy loses HP to the passive;
 * post-fix (target:'all-enemies', per-victim enemy-debuff re-check) exactly the afflicted enemy does.
 */
// Real corpus active (single-target 185% + inflicts Inferno III) — verbatim-shaped from
// docs/ship-skills.csv (Incinerator active_skill_text). The Inferno infliction lands (Incinerator
// hacking 500 vs the victim's security 0), so the front enemy carries Inferno from round 1 on.
const INCINERATOR_PASSIVE =
    'At the end of the round, this unit deals <unit-damage>100% damage</unit-damage> to all ' +
    'enemies with <unit-skill>Inferno</unit-skill>.';
const incinerator = (id: string, withPassive: boolean): Ship =>
    ship(id, {
        type: 'Attacker',
        activeSkillText:
            'This Unit deals <unit-damage>185% damage</unit-damage> and inflicts ' +
            '<unit-skill>Inferno III</unit-skill> for 3 turns.',
        ...(withPassive ? { firstPassiveSkillText: INCINERATOR_PASSIVE } : {}),
    });

const E_INFERNO = 'e:inf:0';
const E_CLEAN = 'e:cln:1';

describe("SP-M M1 Task 7: Incinerator's end-of-round damage hits ONLY the Inferno-afflicted enemy (positional)", () => {
    const run = (withPassive: boolean) =>
        simulateBattle({
            playerTeam: [
                // Incinerator's own active (185% + Inferno) fires in BOTH runs → cancels in the
                // delta; hacking 500 guarantees the Inferno inflict lands on the front enemy.
                place(incinerator('i', withPassive), 'M4', 1000, 1e12, { hacking: 500 }),
            ],
            enemyTeam: [
                // Front enemy: hit by Incinerator's single-target active → carries Inferno. Huge HP
                // so it survives every end-of-round hit (no capping → clean reconciliation).
                place(plainEnemy('inf'), 'M4', 1, 1e12, { security: 0 }),
                // Back enemy: out of the single-target footprint → never afflicted with Inferno →
                // never a victim of the end-of-round passive.
                place(plainEnemy('cln'), 'B2', 1, 1e12, { security: 0 }),
            ],
            rounds: 2,
        });

    it('the Inferno-afflicted enemy takes the end-of-round hit; the clean enemy does not; dealt reconciles', () => {
        const reaction = run(true);
        const control = run(false);

        const incReactiveHits = flattenCombatLog(reaction).filter(
            (e) => e.kind === 'attack' && e.actorId === ATTACKER && (e.targets[0]?.amount ?? 0) > 0
        );
        expect(incReactiveHits.length).toBeGreaterThan(0);

        const takenDeltaInferno = sumTaken(reaction, E_INFERNO) - sumTaken(control, E_INFERNO);
        const takenDeltaClean = sumTaken(reaction, E_CLEAN) - sumTaken(control, E_CLEAN);
        const dealtDelta = sumDealt(reaction, ATTACKER) - sumDealt(control, ATTACKER);

        // Only the Inferno-afflicted enemy takes the end-of-round hit.
        expect(takenDeltaInferno).toBeGreaterThan(0);
        expect(minHpPct(reaction, E_INFERNO)).toBeLessThan(minHpPct(control, E_INFERNO));

        // The clean (no-Inferno) enemy is never a victim.
        expect(takenDeltaClean).toBeCloseTo(0, 5);
        expect(minHpPct(reaction, E_CLEAN)).toBeCloseTo(minHpPct(control, E_CLEAN), 5);

        // Reconciliation: the passive's dealt lands entirely on the one afflicted victim.
        expect(dealtDelta).toBeGreaterThan(0);
        expect(dealtDelta).toBeCloseTo(takenDeltaInferno, 5);
    });
});

/**
 * SP-M M1 Task 8: team-symmetry sweep. All 8 reactive-damage mechanics above were exercised with
 * the reactive ship on the PLAYER side and a victim on `enemyTeam` (`e:<id>:<idx>` actor ids). The
 * engine is team-agnostic post-bySide unification — `playerDrainCtx`/`enemyDrainCtx` bind mirror
 * rosters (engine.ts's `bySide('player')`/`bySide('enemy')`), and Task 6/7's new resolvers
 * (`enemyWithHighestSpeed`, `livingOpposingActorIds`) are bound on BOTH sides. These mirror
 * fixtures flip the placement — the SAME reactive ship now sits on `enemyTeam`, and the trigger/
 * victim ship(s) sit on `playerTeam` — and assert a PLAYER victim's HP drops, proving the engine
 * does not silently favor one side. Actor-id convention (battleSimulator.ts): enemy ships are
 * always `e:<shipId>:<idx>`; player[0] is the reserved `attacker` id, player[N>0] is
 * `p:<shipId>:<idx>`.
 */

describe('SP-M M1 Task 8: FrontLine reactive damage reduces the charging PLAYER HP when FrontLine is on the enemy side (positional)', () => {
    const FL_ENEMY = 'e:fl:0';
    const run = (playerShip: Ship) =>
        simulateBattle({
            playerTeam: [place(playerShip, 'M4', 1, 1e12)],
            enemyTeam: [place(frontline('fl'), 'M4', 10_000, 1e12)],
            rounds: 2,
        });

    it('the charging player loses HP to FrontLine reactive damage; delta reconciles dealt<->taken', () => {
        const reaction = run(chargedEnemy('p1'));
        const control = run(plainEnemy('p1'));
        const dealtDelta = sumDealt(reaction, FL_ENEMY) - sumDealt(control, FL_ENEMY);
        const takenDelta = sumTaken(reaction, ATTACKER) - sumTaken(control, ATTACKER);
        expect(dealtDelta).toBeGreaterThan(0);
        expect(takenDelta).toBeGreaterThan(0);
        expect(dealtDelta).toBeCloseTo(takenDelta, 5);
        expect(minHpPct(reaction, ATTACKER)).toBeLessThan(minHpPct(control, ATTACKER));
    });
});

describe('SP-M M1 Task 8: Vindicator on-resist reactive HP retaliation reduces the inflicting PLAYER HP when Vindicator is on the enemy side (positional)', () => {
    const VIND_ENEMY = 'e:v:0';
    const run = (playerHacking: number) =>
        simulateBattle({
            playerTeam: [
                place(debuffInflictor('p1'), 'M4', 1, 1_000_000, { hacking: playerHacking }),
            ],
            enemyTeam: [place(vindicator('v'), 'M4', 1, 100_000, { security: 300 })],
            rounds: 2,
        });

    it('a resisted debuff retaliates against the inflicting player; delta reconciles dealt<->taken vs a landed control', () => {
        const resisted = run(0);
        const landed = run(500);
        const dealtDelta = sumDealt(resisted, VIND_ENEMY) - sumDealt(landed, VIND_ENEMY);
        const takenDelta = sumTaken(resisted, ATTACKER) - sumTaken(landed, ATTACKER);
        expect(dealtDelta).toBeGreaterThan(0);
        expect(takenDelta).toBeGreaterThan(0);
        expect(dealtDelta).toBeCloseTo(takenDelta, 5);
        expect(minHpPct(resisted, ATTACKER)).toBeLessThan(minHpPct(landed, ATTACKER));
    });
});

describe('SP-M M1 Task 8: Paracelsus on-destroyed reactive HP retaliation reduces the killer PLAYER HP when Paracelsus is on the enemy side (positional)', () => {
    const PARA_ENEMY = 'e:p:0';
    const run = (paracelsusHp: number) =>
        simulateBattle({
            playerTeam: [place(killerEnemy('p1'), 'M4', 100_000, 1_000_000)],
            enemyTeam: [place(paracelsus('p'), 'M4', 1, paracelsusHp)],
            rounds: 2,
        });

    it('a killed Paracelsus retaliates for HP damage against its PLAYER killer; delta reconciles dealt<->taken vs a surviving control', () => {
        const killable = run(10_000);
        const surviving = run(1e12);
        const dealtDelta = sumDealt(killable, PARA_ENEMY) - sumDealt(surviving, PARA_ENEMY);
        const takenDelta = sumTaken(killable, ATTACKER) - sumTaken(surviving, ATTACKER);
        expect(dealtDelta).toBeGreaterThan(0);
        expect(takenDelta).toBeGreaterThan(0);
        expect(dealtDelta).toBeCloseTo(takenDelta, 5);
        expect(minHpPct(killable, ATTACKER)).toBeLessThan(minHpPct(surviving, ATTACKER));
    });
});

describe("SP-M M1 Task 8: Grif's on-enemy-cleansed reactive lands on the real cleansing PLAYER when Grif is on the enemy side (positional)", () => {
    const GRIF_ENEMY = 'e:g:0';
    const run = (playerShip: Ship) =>
        simulateBattle({
            playerTeam: [place(playerShip, 'M4', 1, 1_000_000)],
            enemyTeam: [
                place(grif('g'), 'M4', 1, 1_000_000),
                place(debuffPlanter('inf'), 'M3', 5_000, 1_000_000),
            ],
            rounds: 2,
        });

    it("a cleansing player loses HP to Grif's reactive damage; delta reconciles dealt<->taken vs a no-cleanse control", () => {
        const reaction = run(selfCleanser('p1'));
        const control = run(plainEnemy('p1'));

        const grifReactiveHits = flattenCombatLog(reaction).filter(
            (e) =>
                e.kind === 'attack' && e.actorId === GRIF_ENEMY && (e.targets[0]?.amount ?? 0) > 0
        );
        expect(grifReactiveHits.length).toBeGreaterThan(0);

        const dealtDelta = sumDealt(reaction, GRIF_ENEMY) - sumDealt(control, GRIF_ENEMY);
        const takenDelta = sumTaken(reaction, ATTACKER) - sumTaken(control, ATTACKER);
        expect(dealtDelta).toBeGreaterThan(0);
        expect(takenDelta).toBeGreaterThan(0);
        expect(dealtDelta).toBeCloseTo(takenDelta, 5);
        expect(minHpPct(reaction, ATTACKER)).toBeLessThan(minHpPct(control, ATTACKER));
    });
});

describe("SP-M M1 Task 8: Rhodium's end-of-round damage lands on the most-buffed PLAYER, not the other, when Rhodium is on the enemy side (positional)", () => {
    const RHOD_ENEMY = 'e:r:0';
    const PLAYER2 = 'p:p2:1';
    const run = (p1: Ship, p2: Ship) =>
        simulateBattle({
            playerTeam: [place(p1, 'M4', 1, 1e12), place(p2, 'M3', 1, 1e12)],
            enemyTeam: [place(rhodium('r'), 'M4', 10_000, 1e12)],
            rounds: 2,
        });

    it('the buffed player loses HP to the reactive damage; the buff-less player does not; delta reconciles dealt<->taken', () => {
        const reaction = run(buffedEnemy('p1'), plainEnemy('p2'));
        const control = run(plainEnemy('p1'), plainEnemy('p2'));

        const rhodiumReactiveHits = flattenCombatLog(reaction).filter(
            (e) =>
                e.kind === 'attack' && e.actorId === RHOD_ENEMY && (e.targets[0]?.amount ?? 0) > 0
        );
        expect(rhodiumReactiveHits.length).toBeGreaterThan(0);

        const dealtDelta = sumDealt(reaction, RHOD_ENEMY) - sumDealt(control, RHOD_ENEMY);
        const takenDeltaBuffed = sumTaken(reaction, ATTACKER) - sumTaken(control, ATTACKER);
        const takenDeltaOther = sumTaken(reaction, PLAYER2) - sumTaken(control, PLAYER2);

        expect(dealtDelta).toBeGreaterThan(0);
        expect(takenDeltaBuffed).toBeGreaterThan(0);
        expect(dealtDelta).toBeCloseTo(takenDeltaBuffed, 5);
        expect(minHpPct(reaction, ATTACKER)).toBeLessThan(minHpPct(control, ATTACKER));

        expect(takenDeltaOther).toBeCloseTo(0, 5);
        expect(minHpPct(reaction, PLAYER2)).toBeCloseTo(minHpPct(control, PLAYER2), 5);
    });
});

describe("SP-M M1 Task 8: Chakara's start-of-round damage lands on the highest-Speed PLAYER, not the other, when Chakara is on the enemy side (positional)", () => {
    const CHAK_ENEMY = 'e:c:0';
    const P_SLOW = ATTACKER;
    const P_FAST = 'p:p2:1';
    const run = (withPassive: boolean) =>
        simulateBattle({
            playerTeam: [
                place(plainEnemy('p1'), 'M4', 1, 1e12, { speed: 100 }),
                place(plainEnemy('p2'), 'M3', 1, 1e12, { speed: 300 }),
            ],
            enemyTeam: [place(chakara('c', withPassive), 'M4', 10_000, 1e12)],
            rounds: 2,
        });

    it('the higher-Speed player loses HP to the reactive damage; the slower player does not; delta reconciles dealt<->taken', () => {
        const reaction = run(true);
        const control = run(false);

        const chakaraReactiveHits = flattenCombatLog(reaction).filter(
            (e) =>
                e.kind === 'attack' && e.actorId === CHAK_ENEMY && (e.targets[0]?.amount ?? 0) > 0
        );
        expect(chakaraReactiveHits.length).toBeGreaterThan(0);

        const dealtDelta = sumDealt(reaction, CHAK_ENEMY) - sumDealt(control, CHAK_ENEMY);
        const takenDeltaFaster = sumTaken(reaction, P_FAST) - sumTaken(control, P_FAST);
        const takenDeltaSlower = sumTaken(reaction, P_SLOW) - sumTaken(control, P_SLOW);

        expect(dealtDelta).toBeGreaterThan(0);
        expect(takenDeltaFaster).toBeGreaterThan(0);
        expect(dealtDelta).toBeCloseTo(takenDeltaFaster, 5);
        expect(minHpPct(reaction, P_FAST)).toBeLessThan(minHpPct(control, P_FAST));

        expect(takenDeltaSlower).toBeCloseTo(0, 5);
        expect(minHpPct(reaction, P_SLOW)).toBeCloseTo(minHpPct(control, P_SLOW), 5);
    });
});

describe("SP-M M1 Task 8: Judge's start-of-round damage hits ALL <50%-HP PLAYERS, not the >50% one, when Judge is on the enemy side (positional)", () => {
    const JUDGE_ENEMY = 'e:j:0';
    const P_LOW1 = ATTACKER;
    const P_LOW2 = 'p:lo2:1';
    const P_HIGH = 'p:hi:2';
    const run = (withPassive: boolean) =>
        simulateBattle({
            playerTeam: [
                // Two small-HP players (1500) → one round-1 chip of 1000 leaves them at 33%
                // (<50%). lo1 additionally carries the 100%-damage active that kills the
                // pre-damager (mirrors the player-side fixture's enemy roster, flipped).
                place(preDamagerKiller('lo1'), 'M4', 100_000, 1500, { speed: 100 }),
                place(plainEnemy('lo2'), 'M3', 1, 1500, { speed: 100 }),
                // Huge-HP player → the same 1000 chip leaves it ~100% (>50%): Judge must SKIP it.
                place(plainEnemy('hi'), 'B2', 1, 1e9, { speed: 100 }),
            ],
            enemyTeam: [
                // Judge at the BACK, low attack, huge HP (mirrors the player-side fixture).
                place(judge('j', withPassive), 'B4', 500, 1e12, { speed: 50 }),
                // Pre-damager at the FRONT (players target it), fragile, fastest (chips first).
                place(preDamagerAll('pre'), 'M4', 1000, 100, { speed: 1000 }),
            ],
            rounds: 2,
        });

    it('the two <50%-HP players lose HP to Judge; the >50% one does not; dealt reconciles with the two victims summed', () => {
        const reaction = run(true);
        const control = run(false);

        const judgeReactiveHits = flattenCombatLog(reaction).filter(
            (e) =>
                e.kind === 'attack' && e.actorId === JUDGE_ENEMY && (e.targets[0]?.amount ?? 0) > 0
        );
        expect(judgeReactiveHits.length).toBeGreaterThan(0);

        const takenDeltaLow1 = sumTaken(reaction, P_LOW1) - sumTaken(control, P_LOW1);
        const takenDeltaLow2 = sumTaken(reaction, P_LOW2) - sumTaken(control, P_LOW2);
        const takenDeltaHigh = sumTaken(reaction, P_HIGH) - sumTaken(control, P_HIGH);
        const dealtDelta = sumDealt(reaction, JUDGE_ENEMY) - sumDealt(control, JUDGE_ENEMY);

        expect(takenDeltaLow1).toBeGreaterThan(0);
        expect(takenDeltaLow2).toBeGreaterThan(0);
        expect(minHpPct(reaction, P_LOW1)).toBeLessThan(minHpPct(control, P_LOW1));
        expect(minHpPct(reaction, P_LOW2)).toBeLessThan(minHpPct(control, P_LOW2));

        expect(takenDeltaHigh).toBeCloseTo(0, 5);
        expect(minHpPct(reaction, P_HIGH)).toBeCloseTo(minHpPct(control, P_HIGH), 5);

        expect(dealtDelta).toBeGreaterThan(0);
        expect(dealtDelta).toBeCloseTo(takenDeltaLow1 + takenDeltaLow2, 5);
    });
});

describe("SP-M M1 Task 8: Incinerator's end-of-round damage hits ONLY the Inferno-afflicted PLAYER, when Incinerator is on the enemy side (positional)", () => {
    const INC_ENEMY = 'e:i:0';
    const P_INFERNO = ATTACKER;
    const P_CLEAN = 'p:cln:1';
    const run = (withPassive: boolean) =>
        simulateBattle({
            playerTeam: [
                // Front player: hit by Incinerator's single-target active → carries Inferno.
                // Huge HP so it survives every end-of-round hit (no capping → clean reconciliation).
                place(plainEnemy('inf'), 'M4', 1, 1e12, { security: 0 }),
                // Back player: out of the single-target footprint → never afflicted with Inferno.
                place(plainEnemy('cln'), 'B2', 1, 1e12, { security: 0 }),
            ],
            enemyTeam: [
                // Incinerator's own active (185% + Inferno) fires in BOTH runs → cancels in the
                // delta; hacking 500 guarantees the Inferno inflict lands on the front player.
                place(incinerator('i', withPassive), 'M4', 1000, 1e12, { hacking: 500 }),
            ],
            rounds: 2,
        });

    it('the Inferno-afflicted player takes the end-of-round hit; the clean player does not; dealt reconciles', () => {
        const reaction = run(true);
        const control = run(false);

        const incReactiveHits = flattenCombatLog(reaction).filter(
            (e) => e.kind === 'attack' && e.actorId === INC_ENEMY && (e.targets[0]?.amount ?? 0) > 0
        );
        expect(incReactiveHits.length).toBeGreaterThan(0);

        const takenDeltaInferno = sumTaken(reaction, P_INFERNO) - sumTaken(control, P_INFERNO);
        const takenDeltaClean = sumTaken(reaction, P_CLEAN) - sumTaken(control, P_CLEAN);
        const dealtDelta = sumDealt(reaction, INC_ENEMY) - sumDealt(control, INC_ENEMY);

        expect(takenDeltaInferno).toBeGreaterThan(0);
        expect(minHpPct(reaction, P_INFERNO)).toBeLessThan(minHpPct(control, P_INFERNO));

        expect(takenDeltaClean).toBeCloseTo(0, 5);
        expect(minHpPct(reaction, P_CLEAN)).toBeCloseTo(minHpPct(control, P_CLEAN), 5);

        expect(dealtDelta).toBeGreaterThan(0);
        expect(dealtDelta).toBeCloseTo(takenDeltaInferno, 5);
    });
});

/**
 * SP-M M1 Task 9b: correctness-bug regression. `dummyEnemyIsVestigial` (engine.ts ~2135) requires
 * EVERY player actor's parsed target to be enemy-side — false the instant the player team
 * includes an ally-targeting ship (e.g. a healer), even in a fully positional `simulateBattle`.
 * The three reactive resolvers (`enemyWithMostBuffs`, `enemyWithHighestSpeed`,
 * `livingOpposingActorIds`) previously gated on that flag instead of `input.positionalTeamBattle`,
 * so a healer on the roster silently misrouted Judge/Incinerator/Chakara/Rhodium's reactive damage
 * onto the vestigial dummy `enemy` instead of the real enemy roster — defeating M1 for the (very
 * common) healer-inclusive team composition. These fixtures add a plain ally-targeting healer
 * (`This Unit repairs 5% of its Max HP.`, `activeTarget: 'allies'` — the same ally-heal idiom this
 * file's `frontline` fixture already uses) alongside a reactive-damage ship and assert the real
 * enemy(ies) still lose HP. Pre-fix (`dummyEnemyIsVestigial`-gated): RED — the healer flips the
 * gate false, the resolver falls back to the dummy, and the matching enemy(ies) take 0 real HP.
 * Post-fix (`input.positionalTeamBattle`-gated): GREEN — real enemy HP drops exactly as it does
 * without the healer.
 */

// Plain ally-targeting healer — the ONLY thing needed to flip dummyEnemyIsVestigial's second
// conjunct false (a player actor whose parsed target is NOT enemy-side), while remaining otherwise
// inert (no shield/passive text) so it does not itself perturb any enemy's HP.
const healer = (id: string): Ship =>
    ship(id, {
        type: 'Defender',
        activeTarget: 'allies',
        activeSkillText: 'This Unit repairs 5% of its Max HP.',
    });

describe("SP-M M1 Task 9b: Judge's start-of-round AoE still hits the real <50%-HP enemies with a healer on the player team (positional)", () => {
    const run = (withPassive: boolean) =>
        simulateBattle({
            playerTeam: [
                // Same Judge + pre-damager roster as Task 7's AoE fixture above, PLUS a third
                // ally-targeting healer — the only compositional difference from the already-green
                // Task 7 test, isolating the delta to the healer's presence.
                place(judge('j', withPassive), 'B4', 500, 1e12, { speed: 50 }),
                place(preDamagerAll('pre'), 'M4', 1000, 100, { speed: 1000 }),
                place(healer('heal'), 'M2', 1, 1e12, { speed: 10 }),
            ],
            enemyTeam: [
                place(preDamagerKiller('lo1'), 'M4', 100_000, 1500, { speed: 100 }),
                place(plainEnemy('lo2'), 'M3', 1, 1500, { speed: 100 }),
                place(plainEnemy('hi'), 'B2', 1, 1e9, { speed: 100 }),
            ],
            rounds: 2,
        });

    it('the two <50%-HP enemies lose HP to Judge; the >50% one does not; dealt reconciles with the two victims summed', () => {
        const reaction = run(true);
        const control = run(false);

        const judgeReactiveHits = flattenCombatLog(reaction).filter(
            (e) => e.kind === 'attack' && e.actorId === JUDGE && (e.targets[0]?.amount ?? 0) > 0
        );
        expect(judgeReactiveHits.length).toBeGreaterThan(0);

        const takenDeltaLow1 = sumTaken(reaction, E_LOW1) - sumTaken(control, E_LOW1);
        const takenDeltaLow2 = sumTaken(reaction, E_LOW2) - sumTaken(control, E_LOW2);
        const takenDeltaHigh = sumTaken(reaction, E_HIGH) - sumTaken(control, E_HIGH);
        const dealtDelta = sumDealt(reaction, JUDGE) - sumDealt(control, JUDGE);

        // The load-bearing assertions: both <50%-HP enemies take REAL HP damage. Pre-fix (gated on
        // dummyEnemyIsVestigial), the healer flips the gate false and Judge's AoE resolves to the
        // vestigial dummy instead — both these deltas are 0 and this fails.
        expect(takenDeltaLow1).toBeGreaterThan(0);
        expect(takenDeltaLow2).toBeGreaterThan(0);
        expect(minHpPct(reaction, E_LOW1)).toBeLessThan(minHpPct(control, E_LOW1));
        expect(minHpPct(reaction, E_LOW2)).toBeLessThan(minHpPct(control, E_LOW2));

        expect(takenDeltaHigh).toBeCloseTo(0, 5);
        expect(minHpPct(reaction, E_HIGH)).toBeCloseTo(minHpPct(control, E_HIGH), 5);

        expect(dealtDelta).toBeGreaterThan(0);
        expect(dealtDelta).toBeCloseTo(takenDeltaLow1 + takenDeltaLow2, 5);
    });
});

describe("SP-M M1 Task 9b: Chakara's single-target reactive still hits the real highest-Speed enemy with a healer on the player team (positional)", () => {
    const run = (withPassive: boolean) =>
        simulateBattle({
            playerTeam: [
                // Same Chakara + two-enemy-speed roster as Task 6's fixture above, PLUS a second
                // ally-targeting healer — the only compositional difference from the already-green
                // Task 6 test, isolating the delta to the healer's presence.
                place(chakara('c', withPassive), 'M4', 10_000, 1e12),
                place(healer('heal'), 'M2', 1, 1e12, { speed: 10 }),
            ],
            enemyTeam: [
                place(plainEnemy('e1'), 'M4', 1, 1e12, { speed: 100 }),
                place(plainEnemy('e2'), 'M3', 1, 1e12, { speed: 300 }),
            ],
            rounds: 2,
        });

    it('the higher-Speed enemy loses HP to the reactive damage; the slower enemy does not; delta reconciles dealt<->taken', () => {
        const reaction = run(true);
        const control = run(false);

        const chakaraReactiveHits = flattenCombatLog(reaction).filter(
            (e) => e.kind === 'attack' && e.actorId === ATTACKER && (e.targets[0]?.amount ?? 0) > 0
        );
        expect(chakaraReactiveHits.length).toBeGreaterThan(0);

        const dealtDelta = sumDealt(reaction, ATTACKER) - sumDealt(control, ATTACKER);
        const takenDeltaFaster = sumTaken(reaction, ENEMY2) - sumTaken(control, ENEMY2);
        const takenDeltaSlower = sumTaken(reaction, ENEMY) - sumTaken(control, ENEMY);

        // The load-bearing assertion: the real enemy still loses HP. Pre-fix, the healer flips
        // dummyEnemyIsVestigial false and the reactive resolves to the vestigial dummy instead —
        // this delta is 0 and the assertion fails.
        expect(dealtDelta).toBeGreaterThan(0);
        expect(takenDeltaFaster).toBeGreaterThan(0);
        expect(dealtDelta).toBeCloseTo(takenDeltaFaster, 5);
        expect(minHpPct(reaction, ENEMY2)).toBeLessThan(minHpPct(control, ENEMY2));

        expect(takenDeltaSlower).toBeCloseTo(0, 5);
        expect(minHpPct(reaction, ENEMY)).toBeCloseTo(minHpPct(control, ENEMY), 5);
    });
});
