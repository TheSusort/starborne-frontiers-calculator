import { describe, it, expect } from 'vitest';
import { normalizeTeamActorsToWalked, synthesizeBuffOnlyWalk } from '../teamActorWalk';
import type { TeamActorEngineInput } from '../engine';

const buffOnly = (over: Partial<TeamActorEngineInput> = {}): TeamActorEngineInput => ({
    id: 'support-1',
    speed: 100,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    ...over,
});

describe('synthesizeBuffOnlyWalk', () => {
    it('attaches an empty-kit walk with neutral stats (hp 1 / defence 0 / hacking 200)', () => {
        const w = synthesizeBuffOnlyWalk(buffOnly()).walk!;
        expect(w.shipSkills.slots).toEqual([]);
        expect(w.stats.hp).toBe(1);
        expect(w.stats.defence).toBe(0);
        expect(w.stats.hacking).toBe(200);
        expect(w.affinityDamageModifier).toBe(0);
    });

    it('sets hasChargedSkill from chargeCount (reproduces the legacy charge cadence gate)', () => {
        expect(synthesizeBuffOnlyWalk(buffOnly({ chargeCount: 0 })).walk!.hasChargedSkill).toBe(
            false
        );
        expect(synthesizeBuffOnlyWalk(buffOnly({ chargeCount: 2 })).walk!.hasChargedSkill).toBe(
            true
        );
    });
});

describe('normalizeTeamActorsToWalked', () => {
    it('synthesizes a walk only for actors lacking one; passes walked actors through by reference', () => {
        const walked = buffOnly({ id: 'w', walk: synthesizeBuffOnlyWalk(buffOnly()).walk });
        const [a, b] = normalizeTeamActorsToWalked([buffOnly({ id: 'a' }), walked]);
        expect(a.walk).toBeTruthy();
        expect(b).toBe(walked); // unchanged reference
    });
});
