/**
 * PR-B2 — Ravager's `on-own-debuff-resisted` inflictor-side reaction (ENGINE integration).
 *
 * Ravager's second passive (verbatim from docs/ship-skills.csv): "...If its debuff is
 * resisted, it gains <unit-skill>Hacking Module Overdrive</unit-skill> for 1 turn." This is
 * the INFLICTOR-scoped mirror of the RESISTER-scoped `on-debuff-resisted` (D-PR16 Lockdown /
 * Vindicator's on-resist HP retaliation): it fires on Ravager itself when a debuff RAVAGER
 * inflicted is resisted by its target, not when Ravager resists an incoming debuff.
 *
 * Driven through the REAL pipeline: `simulateBattle` (placement-based two-team battle) →
 * `buildShipAbilities` parses the verbatim passive text into an `on-own-debuff-resisted`
 * reactive ability → the engine's reactive listener (triggers.ts) enqueues the Hacking Module
 * Overdrive grant when the `debuff-resisted` event's `sourceId` is Ravager. Asserted via the
 * combat log's `buff` entries (kind:'buff', note: buffName) — proves the full parse → build →
 * engine → log path, not just the listener plumbing in isolation.
 *
 * Deterministic resist: Ravager's hacking is forced to 0 while the target's security defaults
 * to 100 (resolveStats' `security ?? 100`) — the live hacking-vs-security landing chance
 * clamps to 0, so Ravager's inflicted debuff is resisted on every cast, no RNG pin needed.
 *
 * Team symmetry (the epic's binding constraint): the SAME passive text, run twice — once with
 * Ravager on the PLAYER team, once with Ravager on the ENEMY team — must both grant Hacking
 * Module Overdrive. `on-own-debuff-resisted`'s listener filters `e.sourceId === ownerId`
 * (triggers.ts), which is side-agnostic by construction, so this is a genuine regression guard
 * against an accidental side-scoped filter creeping in later.
 */
import { describe, it, expect } from 'vitest';
import { simulateBattle, BattlePlacement } from '../../calculators/battleSimulator';
import type { Ship } from '../../../types/ship';
import type { Position } from '../../../types/encounters';
import { flattenCombatLog } from '../log/__testutils__/flattenCombatLog';

// Verbatim from docs/ship-skills.csv (second_passive_skill_text field). Do NOT alter this text.
const RAVAGER_P2 =
    'This Unit ignores 10% of Defense. It gains 1 stack of <unit-skill>Overload</unit-skill> every turn. Upon killing an enemy, it loses <unit-skill>Overload</unit-skill> and gains <unit-skill>Marauder Rage III</unit-skill> for 3 turns. If its debuff is resisted, it gains <unit-skill>Hacking Module Overdrive</unit-skill> for 1 turn.';

const HACKING_MODULE_OVERDRIVE = 'Hacking Module Overdrive';

/** Ravager: a real corpus-phrased "inflicts <unit-skill>X</unit-skill> for N turns" active
 *  (parses to an enemy-targeted timed debuff, skillTextParser.test.ts) + the verbatim
 *  RAVAGER_P2 passive on the R2 (2-refit) slot, so buildShipAbilities produces the REAL
 *  on-own-debuff-resisted reactive ability from production parsing — not a hand-written proxy. */
const makeRavager = (id: string): Ship => ({
    id,
    name: 'Ravager',
    rarity: 'legendary',
    faction: 'TERRAN_COMBINE',
    type: 'Attacker',
    baseStats: {
        hp: 0,
        attack: 0,
        defence: 0,
        hacking: 200,
        security: 100,
        crit: 0,
        critDamage: 0,
        speed: 100,
    },
    equipment: {},
    implants: {},
    // 2 refits → getShipSkillRows selects secondPassiveSkillText (skillRows.ts).
    refits: Array.from({ length: 2 }, () => ({})) as unknown as Ship['refits'],
    affinity: 'antimatter',
    activeSkillText: 'This Unit inflicts <unit-skill>Defense Down II</unit-skill> for 2 turns.',
    chargeSkillCharge: 0,
    activeTarget: 'front',
    activePattern: 'Pattern-Base',
    secondPassiveSkillText: RAVAGER_P2,
});

/** A harmless target with a trivial damage active — just needs to be alive so Ravager's
 *  debuff has somewhere to land (and miss). Its default security (100) vs Ravager's forced
 *  hacking 0 guarantees a 0% landing chance. */
const makeTarget = (id: string): Ship => ({
    id,
    name: 'Target',
    rarity: 'legendary',
    faction: 'AURELIAN_SOVEREIGNTY',
    type: 'Defender',
    baseStats: {
        hp: 0,
        attack: 0,
        defence: 0,
        hacking: 200,
        security: 100,
        crit: 0,
        critDamage: 0,
        speed: 50,
    },
    equipment: {},
    implants: {},
    refits: [],
    affinity: 'antimatter',
    activeSkillText: 'This Unit deals <unit-damage>10% damage</unit-damage>.',
    chargeSkillCharge: 0,
    activeTarget: 'front',
    activePattern: 'Pattern-Base',
});

const ravagerPlacement = (ship: Ship, position: Position): BattlePlacement => ({
    ship,
    position,
    statOverrides: {
        attack: 100,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        // Forced to 0: vs the target's default security 100, the live landing chance
        // clamp((0-100)/100, 0, 1) = 0 → every inflicted debuff is resisted, deterministically.
        hacking: 0,
        defence: 0,
        hp: 1_000_000,
        security: 100,
        speed: 100,
    },
});

const targetPlacement = (ship: Ship, position: Position): BattlePlacement => ({
    ship,
    position,
    statOverrides: {
        attack: 1,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        hacking: 200,
        defence: 0,
        hp: 1_000_000,
        security: 100,
        speed: 50,
    },
});

/** Every `buff` combat-log entry for `buffName` attributed to `actorId`, across all rounds. */
const buffEntriesFor = (
    result: ReturnType<typeof simulateBattle>,
    actorId: string,
    buffName: string
) =>
    flattenCombatLog(result).filter(
        (e) => e.kind === 'buff' && e.actorId === actorId && e.note === buffName
    );

describe('Ravager on-own-debuff-resisted (engine integration)', () => {
    it('PLAYER-side Ravager: a resisted inflicted debuff grants itself Hacking Module Overdrive', () => {
        const result = simulateBattle({
            playerTeam: [ravagerPlacement(makeRavager('ravager'), 'M4')],
            enemyTeam: [targetPlacement(makeTarget('target'), 'M4')],
            rounds: 2,
        });

        // Ravager is playerTeam[0] → the engine's reserved focus id 'attacker'.
        const grants = buffEntriesFor(result, 'attacker', HACKING_MODULE_OVERDRIVE);
        expect(grants.length).toBeGreaterThan(0);
    });

    it('ENEMY-side Ravager: the SAME reaction fires when Ravager is on the enemy team (team symmetry)', () => {
        const result = simulateBattle({
            playerTeam: [targetPlacement(makeTarget('target'), 'M4')],
            enemyTeam: [ravagerPlacement(makeRavager('ravager'), 'M4')],
            rounds: 2,
        });

        // Ravager is enemyTeam[0] → minted id `e:ravager:0` (battleSimulator.ts id scheme).
        const grants = buffEntriesFor(result, 'e:ravager:0', HACKING_MODULE_OVERDRIVE);
        expect(grants.length).toBeGreaterThan(0);
    });

    it('control: WITHOUT the resist-inflicting kit, no Hacking Module Overdrive is ever granted', () => {
        // Same Ravager passive, but its active never fires a debuff (bare 0-damage attack) —
        // no debuff-resisted event ever occurs, so the reaction never enqueues. Non-vacuity
        // guard: proves the grant above is caused by the resist, not an unconditional on-cast.
        const bareRavager: Ship = {
            ...makeRavager('ravager'),
            activeSkillText: 'This Unit deals <unit-damage>0% damage</unit-damage>.',
        };
        const result = simulateBattle({
            playerTeam: [ravagerPlacement(bareRavager, 'M4')],
            enemyTeam: [targetPlacement(makeTarget('target'), 'M4')],
            rounds: 2,
        });
        const grants = buffEntriesFor(result, 'attacker', HACKING_MODULE_OVERDRIVE);
        expect(grants.length).toBe(0);
    });
});
