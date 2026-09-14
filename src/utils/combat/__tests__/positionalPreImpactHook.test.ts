import { describe, it, expect } from 'vitest';
import { parsePattern, parseTarget } from '../../targetingParser';
import { applyPositionalDamage, type VictimDamageOutcome } from '../positionalApply';
import type { AttackerDamageScalars, VictimDefenseProfile } from '../victimDamage';
import type { CombatActor } from '../state';

const actor = (id: string, position: CombatActor['position'], currentHp = 1e9): CombatActor =>
    ({ id, position, currentHp }) as CombatActor;

// Neutral scalars/profile — affinity-matched so the resolved hit is finite and nobody dies
// across the 2-hit fixture (mirrors positionalApply.test.ts's harness).
const scalars = (): AttackerDamageScalars => ({
    effectiveAttack: 1000,
    multiplierPct: 100,
    secondaryStatValue: 0,
    hits: 2,
    effectiveCritDamage: 0,
    outgoingDamageBuffPct: 0,
    incomingDamageModifierPct: 0,
    defensePenetrationPct: 0,
    attackerAffinity: 'chemical',
});

const profile = (): VictimDefenseProfile => ({
    defence: 0,
    defenceModifierPct: 0,
    affinity: 'chemical',
});

// Minimal `applyToVictim` return — no consumer in this suite reads more than the required shape.
const stubOutcome = (): VictimDamageOutcome => ({
    shieldBefore: 0,
    hpDamage: 0,
    barriered: false,
});

/**
 * Pattern-Line-Range-1 @ M4 puts 'anchor' at the origin cell and 'covered' at the one covered
 * cell behind it — a 2-hit cast over a 2-victim footprint, the shape this hook is tested against.
 * Both victims start at effectively-infinite HP so the footprint is identical on both hits.
 */
function runTwoHitTwoVictimCast(hooks: {
    onVictimPreImpact?: (victim: CombatActor, isAnchor: boolean, subAttackIndex: number) => void;
    applyToVictim?: (
        victim: CombatActor,
        damage: number,
        isAnchor?: boolean,
        subAttackIndex?: number
    ) => VictimDamageOutcome;
}): void {
    const pattern = parsePattern('Pattern-Line-Range-1');
    const target = parseTarget('front');
    const anchorActor = actor('anchor', 'M4');
    const covered = actor('covered', 'M3');

    applyPositionalDamage({
        hitCrits: [false, false],
        scalars: scalars(),
        pattern,
        actorPosition: 'M2',
        target,
        opposingLiving: [anchorActor, covered],
        defenseProfileOf: profile,
        applyToVictim: hooks.applyToVictim ?? (() => stubOutcome()),
        onVictimPreImpact: hooks.onVictimPreImpact,
    });
}

// The hook must fire BEFORE the victim takes the hit, so a pool drained by that same hit's
// reflect is invisible to it. The probe records the order of (pre-impact, apply) pairs.
describe('onVictimPreImpact', () => {
    it('fires once per (sub-attack x victim), each time immediately BEFORE applyToVictim', () => {
        const order: string[] = [];
        runTwoHitTwoVictimCast({
            onVictimPreImpact: (victim, isAnchor, h) =>
                order.push(`pre:${victim.id}:${isAnchor}:${h}`),
            applyToVictim: (victim, _dmg, isAnchor, h) => {
                order.push(`apply:${victim.id}:${isAnchor}:${h}`);
                return stubOutcome();
            },
        });
        // Every pre is immediately followed by its own apply — no interleaving, nothing between.
        expect(order).toEqual([
            'pre:anchor:true:0',
            'apply:anchor:true:0',
            'pre:covered:false:0',
            'apply:covered:false:0',
            'pre:anchor:true:1',
            'apply:anchor:true:1',
            'pre:covered:false:1',
            'apply:covered:false:1',
        ]);
    });

    it('is optional — omitting it changes nothing', () => {
        expect(() => runTwoHitTwoVictimCast({})).not.toThrow();
    });
});
