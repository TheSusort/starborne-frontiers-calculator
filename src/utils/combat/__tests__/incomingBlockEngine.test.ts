/**
 * D-PR3 Task 7 — end-to-end engine integration for victim-side incoming-damage BLOCK.
 *
 * Block folds into the shared damage funnel `applyVictimDamage` (so it covers both the
 * positional per-sub-hit path and the aggregate per-attack path). These tests drive the
 * enemy→player positional apply, mirroring the Task-6 harness (incomingReductionEngine.test.ts):
 * positioned ENEMY attacker(s) hit a positioned PLAYER victim whose passive slot carries an
 * `incoming-block` ability. Damage is observed via the death-bracket idiom: size the victim's HP
 * at/above the expected landed damage and assert it dies / survives, pinning damage to a range.
 *
 * DETERMINISTIC PROC FORCING: the real registry chances (Ironclad ≤0.20, Shadowguard ≤0.16)
 * never fire a single time through the deterministic rate-gate (it back-loads: chance 0.2 first
 * fires on the 5th draw). So instead of registry pieces we inject SYNTHETIC `incoming-block`
 * abilities with procChance = 1.0 directly into the victim's passive slot — exactly as the
 * Task-6 harness injects synthetic passives. A rate-gate at chance 1.0 fires on EVERY draw, so
 * every eligible intake blocks. This exercises the real engine block step (counter increment,
 * gate, once-per-round flag, damage reduction) end-to-end; only the proc PROBABILITY is forced.
 *
 * Ironclad (nth-hit-2plus, partial, NOT once-per-round): the 1st direct intake in a round is
 *   unblocked (hitIndexThisRound = 1); the 2nd+ intake blocks blockPct. We use TWO enemies so
 *   the victim takes two direct intakes in one round, then assert the aggregate HP loss equals
 *   firstHit + secondHit*(1-blockPct), strictly less than two unblocked hits.
 *
 * Shadowguard (self-stealth, full block 1.0, once-per-round): while stealthed, ONE direct intake
 *   is fully blocked (0 HP loss); a 2nd intake the same round is NOT blocked again (once-per-round).
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus } from '../events';
import { ShipSkills, Ability } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

// ── Targeting/pattern helpers ──────────────────────────────────────────────────────
const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

// A self-Stealth buff active: the actor grants ITSELF 'Stealth' (99 turns) on its turn.
const stealthSelfBuff = (id: string): Ability => ({
    id,
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName: 'Stealth',
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        duration: 99,
    },
});

// A no-op damage active (attack 0 victims deal nothing). Kept so an actor "casts" each round.
const noopActive: ShipSkills['slots'][number] = {
    slot: 'active',
    abilities: [
        {
            id: 'noop-dmg',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'damage', multiplier: 0 },
        },
    ],
};

/** A synthetic incoming-block passive slot (procChance forced to 1.0 for determinism). */
const blockPassiveSlot = (
    id: string,
    cfg: {
        condition: 'nth-hit-2plus' | 'self-stealth';
        blockPct: number;
        oncePerRound: boolean;
        procChance?: number;
    }
): ShipSkills['slots'][number] => ({
    slot: 'passive',
    abilities: [
        {
            id,
            type: 'incoming-block',
            target: 'self',
            trigger: 'on-cast',
            conditions: [],
            config: {
                type: 'incoming-block',
                condition: cfg.condition,
                procChance: cfg.procChance ?? 1,
                blockPct: cfg.blockPct,
                oncePerRound: cfg.oncePerRound,
            },
            autoFilled: true,
        },
    ],
});

/** A positioned PLAYER victim with optional incoming-block passive + optional self-Stealth cast. */
const playerVictim = (
    id: string,
    position: Position,
    hp: number,
    opts: { passive?: ShipSkills['slots'][number]; stealth?: boolean; speed?: number } = {}
): TeamActor => {
    const active: ShipSkills['slots'][number] = opts.stealth
        ? { slot: 'active', abilities: [stealthSelfBuff(`${id}-stealth`)] }
        : noopActive;
    return {
        id,
        speed: opts.speed ?? 1000, // act before the enemies so Stealth is up when they attack
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position,
        walk: {
            shipSkills: { slots: [active, ...(opts.passive ? [opts.passive] : [])] },
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 0,
                hp,
            },
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
    };
};

/** A positioned ENEMY attacker: attack × 100% × 1 hit vs defence 0 → firing-hit = attack. */
const offensiveEnemy = (
    id: string,
    position: Position,
    selection: ParsedTarget['selection'],
    attack: number,
    opts: { speed?: number } = {}
): EnemyAttacker => ({
    id,
    stats: {
        attack,
        crit: 0,
        critDamage: 0,
        defence: 0,
        hp: 1_000_000_000,
        speed: opts.speed ?? 1,
    },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parsedTarget(selection),
    pattern: basePattern(),
    shipSkills: {
        slots: [
            {
                slot: 'active',
                abilities: [
                    {
                        id: `${id}-hit`,
                        type: 'damage',
                        target: 'enemy',
                        trigger: 'on-cast',
                        conditions: [],
                        config: { type: 'damage', multiplier: 100 },
                    },
                ],
            },
        ],
    },
});

const BASE = (overrides: Partial<CombatEngineInput>): CombatEngineInput => ({
    enemyAttackers: [],
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [{ slot: 'active', abilities: [stealthSelfBuff('focus-stealth')] }] },
    // The focus is pinned to the back of the middle row AND cloaked.
    //
    // It used to be off the board entirely, and that is what kept the enemy's targeting on the
    // stealthed victim: `resolvePositionalTarget` drops stealthed cells UNLESS every candidate is
    // stealthed, and with the victim the only placed player actor that "restore all" branch always
    // fired. The normalization boundary places the focus too, so an un-stealthed focus becomes the
    // one visible cell and soaks every hit. Cloaking it restores the restore-all branch, and the
    // enemies' own-row front->back scan (they sit in row M) then resolves onto the victim at M4.
    // Inert to everything under test here — the gates below read the VICTIM's Stealth, never the
    // focus's.
    position: 'M1',
    speed: 2000, // ahead of every victim/enemy, so the focus's Stealth is up before anyone fires
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
    healTargetId: 'attacker', // healing mode → positioned enemy roster is built
    mode: 'healing',
    ...overrides,
});

/** Set of actor ids that emitted ship-destroyed in this run. */
const destroyedIds = (input: CombatEngineInput): Set<string> => {
    const bus = createEventBus();
    const ids = new Set<string>();
    bus.on('ship-destroyed', (e) => ids.add(e.actorId));
    runCombat({ ...input, bus });
    return ids;
};

/** Does the victim die at HP = `hp`? (true = took >= hp damage.) */
const diesAt = (build: (hp: number) => CombatEngineInput, hp: number, victimId: string): boolean =>
    destroyedIds(build(hp)).has(victimId);

describe('D-PR3 Task 7 — Ironclad partial block (nth-hit-2plus) at the funnel', () => {
    // Two enemies each hit the victim for 1000 (attack 1000 × 100% vs defence 0). Both target the
    // SAME victim → two direct intakes in one round. Ironclad-style passive: blockPct 0.5,
    // nth-hit-2plus, NOT once-per-round, procChance forced to 1.
    //   1st intake (hitIndexThisRound = 1): condition nth-hit-2plus false → unblocked → 1000.
    //   2nd intake (hitIndexThisRound = 2): condition true, gate(1.0) fires → blocks 0.5 → 500.
    // Total landed = 1000 + 500 = 1500 (vs 2000 unblocked).
    const run = (hp: number, opts: { block: boolean }): CombatEngineInput =>
        BASE({
            teamActors: [
                playerVictim('victim', 'M4', hp, {
                    passive: opts.block
                        ? blockPassiveSlot('ironclad-test', {
                              condition: 'nth-hit-2plus',
                              blockPct: 0.5,
                              oncePerRound: false,
                          })
                        : undefined,
                }),
            ],
            enemyAttackers: [
                offensiveEnemy('enemy-1', 'M1', 'front', 1000),
                offensiveEnemy('enemy-2', 'M2', 'front', 1000),
            ],
        });

    it('1st intake unblocked, 2nd intake blocked 50% → total 1500 (< unblocked 2000)', () => {
        const build = (hp: number) => run(hp, { block: true });
        // Pin total landed to (1499, 1501): dies at 1500, survives at 1501.
        expect(diesAt(build, 1500, 'victim')).toBe(true);
        expect(diesAt(build, 1501, 'victim')).toBe(false);
        // Strictly less than two unblocked hits: survives at 1600 (would die if 2000 landed).
        expect(diesAt(build, 1600, 'victim')).toBe(false);
    });

    it('control: WITHOUT the block ability both hits land fully → total 2000', () => {
        const build = (hp: number) => run(hp, { block: false });
        expect(diesAt(build, 2000, 'victim')).toBe(true);
        expect(diesAt(build, 2001, 'victim')).toBe(false);
        // Dies at 1600 here (full 2000 > 1600), unlike the blocked case above.
        expect(diesAt(build, 1600, 'victim')).toBe(true);
    });
});

describe('D-PR3 Task 7 — per-round reset of the intake counter (Ironclad)', () => {
    // Single enemy hits the victim once per round across TWO rounds. With nth-hit-2plus, EACH
    // round's lone hit is the 1st intake (hitIndexThisRound = 1) → never blocked, PROVIDED the
    // directIntakeIndex resets per round. If it leaked, round 2's hit would be the "2nd" → blocked.
    // Total over 2 rounds = 1000 + 1000 = 2000 (full); a leaked counter would give 1000 + 500 = 1500.
    const run = (hp: number): CombatEngineInput =>
        BASE({
            numRounds: 2,
            teamActors: [
                playerVictim('victim', 'M4', hp, {
                    passive: blockPassiveSlot('ironclad-test', {
                        condition: 'nth-hit-2plus',
                        blockPct: 0.5,
                        oncePerRound: false,
                    }),
                }),
            ],
            enemyAttackers: [offensiveEnemy('enemy-1', 'M1', 'front', 1000)],
        });

    it('each round the lone hit is the 1st intake → never blocked (counter resets) → total 2000', () => {
        // Dies at 2000 (full two unblocked hits); survives at 2001.
        expect(diesAt(run, 2000, 'victim')).toBe(true);
        expect(diesAt(run, 2001, 'victim')).toBe(false);
        // A leaked counter would block round 2 → total 1500 → victim would SURVIVE at 1600.
        // It must DIE at 1600 here, proving no block happened (counter reset each round).
        expect(diesAt(run, 1600, 'victim')).toBe(true);
    });
});

describe('D-PR3 Task 7 — Shadowguard full block (self-stealth, once-per-round) at the funnel', () => {
    // Victim self-Stealths (acts first), then two enemies each hit it for 1000. Shadowguard-style
    // passive: blockPct 1.0, self-stealth, ONCE per round, procChance forced to 1.
    //   1st intake: stealthed → gate fires → fully blocked (0), once-per-round flag consumed.
    //   2nd intake: stealthed but once-per-round already consumed → NOT blocked → 1000.
    // Total landed = 0 + 1000 = 1000 (vs 2000 with no block).
    const run = (hp: number, opts: { block: boolean }): CombatEngineInput =>
        BASE({
            teamActors: [
                playerVictim('victim', 'M4', hp, {
                    stealth: true,
                    passive: opts.block
                        ? blockPassiveSlot('shadowguard-test', {
                              condition: 'self-stealth',
                              blockPct: 1,
                              oncePerRound: true,
                          })
                        : undefined,
                }),
            ],
            enemyAttackers: [
                offensiveEnemy('enemy-1', 'M1', 'front', 1000),
                offensiveEnemy('enemy-2', 'M2', 'front', 1000),
            ],
        });

    it('1st intake fully blocked, 2nd intake unblocked (once-per-round) → total 1000', () => {
        const build = (hp: number) => run(hp, { block: true });
        // Pin total landed to (999, 1001): dies at 1000, survives at 1001.
        expect(diesAt(build, 1000, 'victim')).toBe(true);
        expect(diesAt(build, 1001, 'victim')).toBe(false);
        // Only ONE hit's worth landed: survives at 1500 (would die if both 2000 landed, or if the
        // 2nd were also blocked it would survive even at 1 — but it dies at 1000, proving exactly
        // one hit landed).
        expect(diesAt(build, 1500, 'victim')).toBe(false);
    });

    it('control: WITHOUT the block ability both hits land → total 2000', () => {
        const build = (hp: number) => run(hp, { block: false });
        expect(diesAt(build, 2000, 'victim')).toBe(true);
        expect(diesAt(build, 2001, 'victim')).toBe(false);
        expect(diesAt(build, 1000, 'victim')).toBe(true); // full 2000 > 1000
    });
});
