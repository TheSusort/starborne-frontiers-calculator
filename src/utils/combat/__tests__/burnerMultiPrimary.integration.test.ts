/**
 * Owner ruling R110: every enemy a whole-battlefield pattern strikes is a primary target, so the
 * Burner gear set's on-deal-damage "Applies Inferno 1 for 2 turns." lands on EACH of them — seen in
 * game on Curator in 4-piece Burner. Each victim takes its own landing check: an 'apply' DoT fails
 * only on an affinity disadvantage against THAT victim.
 *
 * A single-target multi-attack skill (Enforcer) still stacks one Inferno per attack on its one
 * target, and an area pattern that is not the whole battlefield (a Cone) still applies it to the
 * anchor only.
 *
 * Curator's and Enforcer's real parsed kits, Curator's real targeting row from
 * docs/ship-targeting.csv, the real 4-piece Burner set (buildEquipmentAbilities). Every board runs
 * with the wearer on the player side and on the enemy side.
 */
import { existsSync, readFileSync } from 'fs';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import {
    boardInput,
    realKit,
    NO_KIT,
    type BoardUnit,
    type Placement,
} from '../__testutils__/realKitBoard';
import {
    parsePattern,
    parseTarget,
    parseTargetingCsv,
    type ParsedPattern,
    type ParsedTarget,
} from '../../targetingParser';
import { buildEquipmentAbilities } from '../../abilities/buildEquipmentAbilities';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { AffinityName, Ship } from '../../../types/ship';
import type { GearPiece } from '../../../types/gear';

const TARGETING_CSV = 'docs/ship-targeting.csv';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable() || !existsSync(TARGETING_CSV))
        throw new Error(
            'docs/ship-skills.csv, docs/ship-data.json and docs/ship-targeting.csv are required'
        );
});
beforeEach(() => setupKeyedRng(110));

const SIDES: Placement[] = ['player', 'enemy'];

/** The real 4-piece Burner set's abilities. */
const burner = (): Ability[] => {
    const gear: Record<string, string> = {};
    const pieces: Record<string, GearPiece> = {};
    (['weapon', 'hull', 'generator', 'sensor'] as const).forEach((slot, i) => {
        gear[slot] = `burn-${i}`;
        pieces[`burn-${i}`] = {
            id: `burn-${i}`,
            slot,
            rarity: 'legendary',
            setBonus: 'BURNER',
        } as GearPiece;
    });
    const built = buildEquipmentAbilities(
        { implants: {}, equipment: gear } as unknown as Ship,
        (id) => pieces[id]
    );
    if (!built.some((a) => a.config.type === 'dot' && a.config.dotType === 'inferno'))
        throw new Error('Burner set did not build its Inferno rider');
    return built;
};

/** `ship`'s real kit without its charged skill (round 1 is always the active), wearing Burner. */
const inBurner = (ship: string): ShipSkills => {
    const slots = realKit(ship).slots.filter((s) => s.slot !== 'charged');
    const passive = slots.find((s) => s.slot === 'passive');
    return {
        slots: passive
            ? slots.map((s) =>
                  s === passive ? { ...s, abilities: [...s.abilities, ...burner()] } : s
              )
            : [...slots, { slot: 'passive', abilities: burner() }],
    };
};

const curatorTargeting = (): { target: ParsedTarget; pattern: ParsedPattern } => {
    const row = parseTargetingCsv(readFileSync(TARGETING_CSV, 'utf8')).find(
        (r) => r.name === 'Curator'
    );
    if (!row) throw new Error('Curator missing from docs/ship-targeting.csv');
    return { target: parseTarget(row.activeTarget), pattern: parsePattern(row.activePattern) };
};

const wearer = (
    ship: string,
    targeting: { target: ParsedTarget; pattern: ParsedPattern },
    affinity?: AffinityName
): BoardUnit => ({
    id: 'wearer',
    kit: inBurner(ship),
    position: 'M4',
    speed: 300,
    attack: 10_000,
    critDamage: 50,
    ...(affinity ? { affinity } : {}),
    ...targeting,
});

const foe = (id: string, position: BoardUnit['position'], affinity?: AffinityName): BoardUnit => ({
    id,
    kit: NO_KIT,
    position,
    speed: 1,
    ...(affinity ? { affinity } : {}),
});

/** Round-1 Inferno stacks the wearer landed, per victim name; `struck` names every victim its
 *  round-1 cast hit. */
const observe = (
    placement: Placement,
    attacker: BoardUnit,
    opponents: BoardUnit[]
): { inferno: Record<string, number>; struck: string[] } => {
    const { input, id } = boardInput(placement, attacker, [], opponents, 1);
    const all = [attacker, ...opponents];
    const nameOf = (actorId: string): string => all.find((u) => id(u) === actorId)?.id ?? actorId;
    const bus = createEventBus();
    const inferno: Record<string, number> = {};
    const struck = new Set<string>();
    bus.on('dot-applied', (e) => {
        if (e.sourceId !== id(attacker) || e.dotType !== 'inferno' || e.round !== 1) return;
        const v = nameOf(e.targetId);
        inferno[v] = (inferno[v] ?? 0) + e.stacks;
    });
    bus.on('attacked', (e) => {
        if (e.attackerId === id(attacker) && e.round === 1) struck.add(nameOf(e.targetId));
    });
    runCombat({ ...input, bus });
    return { inferno, struck: [...struck].sort() };
};
const infernoByVictim = (
    placement: Placement,
    attacker: BoardUnit,
    opponents: BoardUnit[]
): Record<string, number> => observe(placement, attacker, opponents).inferno;

describe('Curator’s targeting row is the whole battlefield', () => {
    it('docs/ship-targeting.csv gives Curator’s active Pattern-All', () => {
        expect(curatorTargeting().pattern.shape).toBe('all');
    });
});

describe.each(SIDES)('Burner on Curator (wearer on the %s side)', (placement) => {
    it('his active strikes three enemies → each holds one Inferno stack', () => {
        const obs = infernoByVictim(placement, wearer('Curator', curatorTargeting()), [
            foe('front', 'M4'),
            foe('top', 'T4'),
            foe('bottom', 'B4'),
        ]);
        expect(obs).toEqual({ front: 1, top: 1, bottom: 1 });
    });

    it('an enemy with the affinity advantage over Curator gets none; the other two get one each', () => {
        // Thermal holds the advantage over chemical.
        const obs = infernoByVictim(placement, wearer('Curator', curatorTargeting(), 'chemical'), [
            foe('front', 'M4'),
            foe('top', 'T4', 'thermal'),
            foe('bottom', 'B4'),
        ]);
        expect(obs).toEqual({ front: 1, bottom: 1 });
    });
});

describe.each(SIDES)('regression: one primary keeps one Inferno target (%s side)', (placement) => {
    it('Enforcer’s three attacks on one enemy → three Inferno stacks on that enemy', () => {
        const obs = infernoByVictim(
            placement,
            wearer('Enforcer', {
                target: parseTarget('front'),
                pattern: parsePattern('Pattern-Base'),
            }),
            [foe('front', 'M4'), foe('top', 'T4')]
        );
        expect(obs).toEqual({ front: 3 });
    });

    it('Curator’s skill on a Cone → Inferno on the anchor only', () => {
        const obs = observe(
            placement,
            wearer('Curator', {
                target: parseTarget('front'),
                pattern: parsePattern('Pattern-Cone-Range-1'),
            }),
            [foe('front', 'M4'), foe('covered', 'M3')]
        );
        expect(obs.struck).toEqual(['covered', 'front']);
        expect(obs.inferno).toEqual({ front: 1 });
    });
});
