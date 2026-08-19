/**
 * Ship-kit Wave 5, Task A3 — engine fan-out for the two enemy-adjacency `AbilityTarget` scopes
 * (`adjacent-enemies` / `target-and-adjacent-enemies`) added in Task A1 and parsed in Task A2
 * (Vindicator Provoke / Out. Damage Down I → `adjacent-enemies`; Asphyxiator Stasis →
 * `target-and-adjacent-enemies`). Prior to this task, engine.ts:211's self-vs-enemy
 * classification does not list either scope, so both fall through to `self` — the applied
 * status is misregistered as a SELF buff on the caster instead of an enemy debuff on the board
 * neighbours. This file drives the fix through a real positional battle (`simulateBattle`) using
 * synthetic ships whose skill text carries the SAME two adjacency phrasings the parser recognises
 * (`detectAdjacentEnemyScope` in skillTextParser.ts — verbatim structure from Vindicator/
 * Asphyxiator in docs/ship-skills.csv), so the parser → engine pipeline is exercised end to end.
 *
 * Board layout (src/utils/targeting/board.ts hex adjacency): the primary target sits at M4 (the
 * unique front/col-4 cell in this roster, so single-target `front` selection deterministically
 * picks it). neighbors(M4) = [M3, T3, T4, B3, B4] — nbrA (M3) and nbrB (T3) are real neighbours;
 * `far` (T1) is not (`{q:0,r:0}` vs M4's `{q:2,r:1}` — no hex-adjacency), proving the fan-out
 * doesn't leak to the whole roster.
 */
import { describe, it, expect } from 'vitest';
import { simulateBattle } from '../../calculators/battleSimulator';
import { runCombat, CombatEngineInput } from '../engine';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { createEventBus, CombatEvent } from '../events';
import type { Ship } from '../../../types/ship';
import type { Position } from '../../../types/encounters';
import { flattenCombatLog } from '../log/__testutils__/flattenCombatLog';
import { bareEnemy, BARE_ENEMY_ID } from '../__testutils__/bareRosterFixture';

const DEBUFF_NAME = 'Defense Down II';

// Verbatim-shaped phrasing (matches skillTextParser's ADJACENT_ENEMY_ONLY_RE / real Vindicator
// text: "... to all enemies adjacent to the target."). "applies" (not "inflicts") is a guaranteed
// (non-resistible) application verb — isolates the fan-out/classification behaviour from any
// hacking-vs-security landing RNG.
const ADJACENT_ONLY_TEXT = `This Unit applies <unit-skill>${DEBUFF_NAME}</unit-skill> for 2 turns to all enemies adjacent to the target.`;
// Verbatim-shaped phrasing (matches TARGET_AND_ADJACENT_ENEMY_RE / real Asphyxiator text: "... on
// the targeted enemy and all enemies adjacent to it.").
const TARGET_AND_ADJACENT_TEXT = `This Unit applies <unit-skill>${DEBUFF_NAME}</unit-skill> for 2 turns to the targeted enemy and all enemies adjacent to it.`;

const ship = (id: string, over: Partial<Ship>): Ship =>
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

interface Placement {
    ship: Ship;
    position: Position;
    statOverrides: {
        attack: number;
        crit: number;
        critDamage: number;
        defensePenetration: number;
        hacking: number;
        defence: number;
        hp: number;
    };
}

const place = (s: Ship, position: Position, attack: number, hp: number): Placement => ({
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

const adjacentOnlyCaster = (id: string): Ship => ship(id, { activeSkillText: ADJACENT_ONLY_TEXT });
const targetAndAdjacentCaster = (id: string): Ship =>
    ship(id, { activeSkillText: TARGET_AND_ADJACENT_TEXT });
const plain = (id: string): Ship =>
    ship(id, { activeSkillText: 'This Unit deals <unit-damage>1% damage</unit-damage>.' });

/** Every `kind:'debuff'` log entry attributed to `actorId` for `DEBUFF_NAME`, across the whole
 *  run — `note` carries the buff name (buildCombatLog.ts's `debuff-applied` mapping), one entry
 *  per landed recipient (emitDebuffApplied is called once per recipient id in the fan-out loop). */
const debuffRecipients = (result: ReturnType<typeof simulateBattle>, actorId: string): string[] =>
    flattenCombatLog(result)
        .filter((e) => e.kind === 'debuff' && e.actorId === actorId && e.note === DEBUFF_NAME)
        .map((e) => e.targets[0]?.targetId)
        .filter((id): id is string => id !== undefined);

describe('Ship-kit W5 Task A3: adjacent-enemies debuff fan-out (positional, player caster)', () => {
    const run = (caster: Ship) =>
        simulateBattle({
            playerTeam: [place(caster, 'M4', 1, 1e9)],
            enemyTeam: [
                place(plain('tgt'), 'M4', 1, 1e9), // primary target (unique front cell)
                place(plain('nbrA'), 'M3', 1, 1e9), // neighbour of M4
                place(plain('nbrB'), 'T3', 1, 1e9), // neighbour of M4
                place(plain('far'), 'T1', 1, 1e9), // NOT a neighbour of M4
            ],
            rounds: 1,
        });

    const TGT = 'e:tgt:0';
    const NBR_A = 'e:nbrA:1';
    const NBR_B = 'e:nbrB:2';
    const FAR = 'e:far:3';

    it('adjacent-only: the primary target is excluded, both neighbours receive it, the non-neighbour does not', () => {
        const result = run(adjacentOnlyCaster('atk'));
        const recipients = debuffRecipients(result, 'attacker');

        expect(recipients).not.toContain(TGT);
        expect(recipients).toContain(NBR_A);
        expect(recipients).toContain(NBR_B);
        expect(recipients).not.toContain(FAR);
    });

    it('target+adjacent: the primary target AND both neighbours receive it, the non-neighbour does not', () => {
        const result = run(targetAndAdjacentCaster('atk'));
        const recipients = debuffRecipients(result, 'attacker');

        expect(recipients).toContain(TGT);
        expect(recipients).toContain(NBR_A);
        expect(recipients).toContain(NBR_B);
        expect(recipients).not.toContain(FAR);
    });
});

describe('Ship-kit W5 Task A3: team symmetry — an ENEMY-side caster fans out onto its PLAYER-side mirror', () => {
    const run = (caster: Ship) =>
        simulateBattle({
            playerTeam: [
                place(plain('tgt'), 'M4', 1, 1e9),
                place(plain('nbrA'), 'M3', 1, 1e9),
                place(plain('nbrB'), 'T3', 1, 1e9),
                place(plain('far'), 'T1', 1, 1e9),
            ],
            enemyTeam: [place(caster, 'M4', 1, 1e9)],
            rounds: 1,
        });

    // player[0] is always the reserved focus id 'attacker'; the rest are `p:<shipId>:<idx>`
    // (battleSimulator.ts's naming convention). The caster is the sole enemy → `e:atk:0`.
    const TGT = 'attacker';
    const NBR_A = 'p:nbrA:1';
    const NBR_B = 'p:nbrB:2';
    const FAR = 'p:far:3';
    const CASTER = 'e:atk:0';

    it('adjacent-only cast by an enemy lands on the player neighbours, not the primary target', () => {
        const result = run(adjacentOnlyCaster('atk'));
        const recipients = debuffRecipients(result, CASTER);

        expect(recipients).not.toContain(TGT);
        expect(recipients).toContain(NBR_A);
        expect(recipients).toContain(NBR_B);
        expect(recipients).not.toContain(FAR);
    });

    it('target+adjacent cast by an enemy lands on the player target AND its neighbours', () => {
        const result = run(targetAndAdjacentCaster('atk'));
        const recipients = debuffRecipients(result, CASTER);

        expect(recipients).toContain(TGT);
        expect(recipients).toContain(NBR_A);
        expect(recipients).toContain(NBR_B);
        expect(recipients).not.toContain(FAR);
    });
});

/**
 * Control-path smoke test: buildShipAbilities additively emits a `type:'control'` ability
 * alongside a named control-effect debuff (Stasis/Provoke/…, CONTROL_EFFECT_DISPLAY_NAME —
 * buildShipAbilities.ts:1817) whose `target` is RE-DERIVED from the named twin's
 * `detectEnemyGrantScope` (buildShipAbilities.ts:1811-1819, Task A2) — so a real Vindicator
 * Provoke / Asphyxiator Stasis cast carries a control ability with `target:'adjacent-enemies'` /
 * `'target-and-adjacent-enemies'` too. playerTurn.ts's control-applied loop only special-cases
 * `ctrl.target === 'enemy'` (Block-Debuff/resisted-suppression) — a non-'enemy' string just
 * always emits (same as the pre-existing standalone-control path), so the new target values must
 * not throw. This does not assert control-applied semantics (out of scope here, unchanged by
 * this task) — only that the control-twin's presence doesn't break the fan-out this task owns.
 */
describe('Ship-kit W5 Task A3: control-path smoke test (real control-effect buff names)', () => {
    const controlCaster = (id: string, text: string): Ship => ship(id, { activeSkillText: text });

    it('a Provoke (adjacent-enemies) cast does not throw and still fans out to neighbours only', () => {
        const provokeText = `This Unit applies <unit-skill>Provoke</unit-skill> for 1 turn to all enemies adjacent to the target.`;
        const run = () =>
            simulateBattle({
                playerTeam: [place(controlCaster('atk', provokeText), 'M4', 1, 1e9)],
                enemyTeam: [
                    place(plain('tgt'), 'M4', 1, 1e9),
                    place(plain('nbrA'), 'M3', 1, 1e9),
                    place(plain('nbrB'), 'T3', 1, 1e9),
                ],
                rounds: 1,
            });

        expect(run).not.toThrow();
        const result = run();
        const recipients = flattenCombatLog(result)
            .filter((e) => e.kind === 'debuff' && e.actorId === 'attacker' && e.note === 'Provoke')
            .map((e) => e.targets[0]?.targetId);
        expect(recipients).not.toContain('e:tgt:0');
        expect(recipients).toContain('e:nbrA:1');
        expect(recipients).toContain('e:nbrB:2');
    });

    it('a Stasis (target-and-adjacent-enemies) cast does not throw and still fans out to target+neighbours', () => {
        const stasisText = `This Unit applies <unit-skill>Stasis</unit-skill> for 1 turn to the targeted enemy and all enemies adjacent to it.`;
        const run = () =>
            simulateBattle({
                playerTeam: [place(controlCaster('atk', stasisText), 'M4', 1, 1e9)],
                enemyTeam: [
                    place(plain('tgt'), 'M4', 1, 1e9),
                    place(plain('nbrA'), 'M3', 1, 1e9),
                    place(plain('nbrB'), 'T3', 1, 1e9),
                ],
                rounds: 1,
            });

        expect(run).not.toThrow();
        const result = run();
        const recipients = flattenCombatLog(result)
            .filter((e) => e.kind === 'debuff' && e.actorId === 'attacker' && e.note === 'Stasis')
            .map((e) => e.targets[0]?.targetId);
        expect(recipients).toContain('e:tgt:0');
        expect(recipients).toContain('e:nbrA:1');
        expect(recipients).toContain('e:nbrB:2');
    });
});

/**
 * Single-entry roster: `bareEnemy({ stats: { hp: 1_000_000_000 } })` gives the run exactly one
 * real, targetable opposing actor, and `normalizeCombatRoster`'s `withTargeting`
 * (normalizeRoster.ts:86-92) fills BOTH targeting axes for every run through the boundary — so
 * this run IS positional. The `positional` gate (engine.ts:9113, `const positional =`) — and its
 * `willApplyPositionally` prediction (engine.ts:9030, `const willApplyPositionally =`) — calls `resolvesPositionalVictim`, which IS satisfied here: the
 * roster's one member has max hp > 0 (`isTargetableRosterMember`, positionalBinding.ts:36).
 * `targetId` IS threaded onto the turn args, as `BARE_ENEMY_ID` — not left unset, and not the
 * vestigial `enemy` dummy.
 *
 * Both mechanics still land the same way they did before this correction, but for a different,
 * purely structural reason: `target-and-adjacent-enemies` resolves to exactly one recipient (the
 * anchor itself) because `adjacentEnemyIdsFor` (engine.ts:7170, `adjacentEnemyIdsFor: (anchorId:
 * string): string[] =>`, always supplied on a resolved
 * anchor) finds no OTHER roster member to return as a neighbour — not because of any
 * non-positional "no anchor" fallback (the anchor IS defined). `adjacent-enemies` applies to
 * nobody for the same reason (an empty neighbour set), not because there is no primary-target
 * anchor to resolve neighbours from.
 *
 * SP-4b-2b: this block used to exercise the DPS calculator's real NON-positional single-opponent
 * shape — no `enemyAttackers` at all, `targetId` never threaded, landing via the legacy
 * `targetId === undefined && !positionalLanding → [undefined]` fallback. An empty roster is now a
 * validation error at the boundary, and the fixture's replacement roster (one targetable member)
 * makes the run positional instead of reproducing the old shape. The 0-max-hp "pressure source"
 * roster was tried here as a substitute AT THE TIME, and rejected: it restored the legacy fallback
 * then, but that fallback resolved to the vestigial `enemy` dummy, not `BARE_ENEMY_ID`, so adopting
 * it would have meant re-pinning the assertion below rather than just re-deriving it.
 *
 * SP-4c-2a then retired the substitute OUTRIGHT, so it is no longer an option for anyone:
 * `withTargetableHp` (normalizeRoster.ts, `MIN_TARGETABLE_MAX_HP`) floors every enemy attacker's
 * max HP unconditionally, so no roster reaches the engine unhittable. The exemplar this note used
 * to name for the trick, `accumulatorGather.integration.test.ts`, is itself a positional run now
 * ("a run that used to be a NON-positional pressure source is now positional").
 *
 * So the original DPS-invariance / non-positional coverage is NOT preserved by this block, and
 * cannot be re-created by a fresh fixture either: there is no non-positional shape left below the
 * boundary. What remains is the single-real-enemy positional edge case described above.
 */
describe('Ship-kit W5 Task A3: single-entry roster edge case (positional, no neighbours to fan out to)', () => {
    const BASE: Omit<CombatEngineInput, 'shipSkills' | 'bus'> = {
        enemyAttackers: bareEnemy({ stats: { hp: 1_000_000_000 } }),
        attack: 1000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        enemyDefense: 0,
        enemyHp: 1_000_000_000,
        numRounds: 1,
        selfBuffs: [],
        enemyDebuffs: [],
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        hasChargedSkill: false,
        startCharged: false,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        defence: 0,
        hp: 1_000_000_000,
        speed: 100,
        hacking: 200,
        enemySecurity: 0,
    };

    const runDummy = (caster: Ship) => {
        const bus = createEventBus();
        const debuffsApplied: Extract<CombatEvent, { type: 'debuff-applied' }>[] = [];
        bus.on('debuff-applied', (e) => debuffsApplied.push(e));
        runCombat({ ...BASE, shipSkills: buildShipAbilities(caster), bus });
        return debuffsApplied.filter((e) => e.buffName === DEBUFF_NAME);
    };

    it('adjacent-enemies applies to nobody (no OTHER roster member to resolve as a neighbour)', () => {
        const applied = runDummy(adjacentOnlyCaster('atk'));
        expect(applied).toHaveLength(0);
    });

    it('target-and-adjacent-enemies applies to exactly the sole opponent — the anchor itself, no neighbours to fan out to', () => {
        const applied = runDummy(targetAndAdjacentCaster('atk'));
        expect(applied).toHaveLength(1);
        // M1: the recipient is the real roster entry, not the vestigial `enemy` sink.
        expect(applied[0]?.targetId).toBe(BARE_ENEMY_ID);
    });
});
