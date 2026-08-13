/**
 * SP-1 deferred gap: reactive-damage procs must reduce the REAL positioned enemy's HP and reach
 * `perTargetDealt` in DPS mode, exactly as they already do in a positioned two-team battle.
 *
 * `applyReactiveDamage`'s HP+`creditDealt` branch (engine.ts) was gated on the then-named
 * `positionalTeamBattle` input field — since replaced by the derived `hasPositionedEnemyRoster`
 * check — which only `simulateBattle` set. The DPS calculator supplies a
 * real, positioned enemy roster but never that flag, so every reactive-damage proc fell to the
 * credit-only branch: it reduced NO real HP, never reached `perTargetDealt`, and therefore
 * contributed exactly 0 to the re-derived DPS metric (`focusDamageTotal`, dpsSimulator.ts) — the
 * proc fired and accomplished nothing.
 *
 * Chakara is the fixture because its start-of-round proc is already proven to fire on the DPS path
 * (rhodiumChakaraDpsModeCredit.integration.test.ts) and needs no enemy attack to trigger, so the
 * gap is visible at the enemy-attack-0 default.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { simulateDPS, DPSSimulationInput } from '../dpsSimulator';
import { setupKeyedTestRng } from '../rateAccumulator';
import { DEFAULT_ATTACKER_SLOT, DEFAULT_ENEMY_SLOT } from '../dpsEnemyPlacement';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { focusDamageTotal } from '../dpsMetricFromDealt';
import type { Ship } from '../../../types/ship';
import type { CombatEvent } from '../../combat/events';

// Verbatim from docs/ship-skills.csv (Chakara, third_passive_skill_text — the R4/refit-active slot
// getShipSkillRows resolves for a 4-refit ship). Matches reactiveDamagePositionalHp.test.ts and
// rhodiumChakaraDpsModeCredit.integration.test.ts. Do NOT alter this text.
const CHAKARA_P4 =
    'This Unit starts each round with <unit-skill>Attack Up II</unit-skill> and ' +
    '<unit-skill>Defense Up II</unit-skill> for 1 turn if it has the lowest speed among all ' +
    'Allies. Then, deals <unit-damage>60% damage</unit-damage> to the highest Speed Enemy.';

// `withPassive: false` is the control — the passive (and therefore the whole proc) is absent, so
// the only difference between the two runs is the reactive itself. The 0%-damage active means the
// focus's own cast never changes the enemy's HP in EITHER run.
const chakaraSkills = (withPassive: boolean) =>
    buildShipAbilities({
        refits: withPassive ? [{}, {}, {}, {}] : [],
        activeSkillText: 'This Unit deals <unit-damage>0% damage</unit-damage>.',
        ...(withPassive ? { thirdPassiveSkillText: CHAKARA_P4 } : {}),
    } as unknown as Ship);

const ATTACK = 10_000;
const ENEMY_ID = 'enemy-1';
const ENEMY_HP = 100_000;

const run = (withPassive: boolean, events?: CombatEvent[]) => {
    const input: DPSSimulationInput = {
        attack: ATTACK,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        enemyDefense: 0,
        enemyHp: ENEMY_HP,
        rounds: 2,
        selfBuffs: [],
        enemyDebuffs: [],
        speed: 100,
        hp: 1_000_000,
        position: DEFAULT_ATTACKER_SLOT,
        shipSkills: chakaraSkills(withPassive),
        enemyAttackers: [
            {
                id: ENEMY_ID,
                // attack 0 (the calculator's default) — the enemy never hits back, so nothing but
                // the reactive proc can move either side's HP.
                stats: {
                    attack: 0,
                    crit: 0,
                    critDamage: 0,
                    speed: 40,
                    defence: 0,
                    hp: ENEMY_HP,
                },
                chargeCount: 0,
                startCharged: false,
                position: DEFAULT_ENEMY_SLOT,
            },
        ],
        ...(events ? { bus: { on: () => {}, emit: (e: CombatEvent) => void events.push(e) } } : {}),
    };
    return simulateDPS(input);
};

/** The proc FIRED and resolved the real enemy as its victim — true both before and after the fix,
 *  so it separates "fires but lands nowhere" (the bug) from "never fires at all" (a different bug
 *  the HP/metric assertions alone could not tell apart). */
const procsAgainstRealEnemy = (events: CombatEvent[]) =>
    events.filter(
        (e) =>
            e.type === 'reactive-damage-performed' && e.targetId === ENEMY_ID && (e.amount ?? 0) > 0
    );

describe("SP-1 follow-up: a reactive-damage proc hits the real DPS enemy's HP and the DPS metric", () => {
    beforeEach(() => {
        setupKeyedTestRng(12345);
    });

    it("credits the proc to the focus's per-victim map, so it reaches the re-derived DPS total", () => {
        const reactionEvents: CombatEvent[] = [];
        const reaction = run(true, reactionEvents);
        const controlEvents: CombatEvent[] = [];
        const control = run(false, controlEvents);

        // The proc fires against the real enemy in the reaction run and not at all in the control —
        // so the deltas below are the reactive's own contribution, and a green run cannot mean
        // "the proc silently stopped firing".
        expect(procsAgainstRealEnemy(reactionEvents).length).toBeGreaterThan(0);
        expect(procsAgainstRealEnemy(controlEvents)).toHaveLength(0);

        // The control's 0%-damage active credits nothing at all.
        expect(control.summary.totalDamage).toBe(0);
        // Pre-fix this was ALSO 0: the proc landed in `creditDamage` (→ totalDirectDamage) but never
        // in `perTargetDealt`, which is the only source `focusDamageTotal` reads for a real enemy.
        expect(reaction.summary.totalDamage).toBeGreaterThanOrEqual(ATTACK * 0.6);
        // Attributed to the focus against the real enemy specifically, not to the vestigial dummy.
        expect(focusDamageTotal(reaction.rounds, 'attacker')).toBeGreaterThanOrEqual(ATTACK * 0.6);
        expect(reaction.rounds[0].perTargetDealt?.attacker?.[ENEMY_ID]).toBeGreaterThan(0);
    });

    it("reduces the real enemy's HP, so finalHpPct reflects the proc", () => {
        const reaction = run(true);
        const control = run(false);

        // Nothing touches the control enemy → it ends the window untouched.
        expect(control.summary.finalHpPct).toBe(100);
        // Pre-fix the proc reduced no real HP at all, so this also read 100.
        expect(reaction.summary.finalHpPct).toBeLessThan(100);
        expect(reaction.summary.finalHpPct).toBeGreaterThan(0);
    });
});
