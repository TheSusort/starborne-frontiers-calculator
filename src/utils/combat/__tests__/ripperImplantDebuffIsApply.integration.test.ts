/**
 * Owner ruling R206 (2026-10-17): every debuff an implant lands is an "apply", never an "inflict",
 * so an "after it inflicts a debuff" reaction does not answer it. Ripper (game 3.23 kit, R2)
 * gains Marauder Rage II and extends all allies' active buffs by 1 turn "after it inflicts a
 * debuff"; neither fires on the Concentrate Fire his Doomsayer lands or the Provoke his Bulwark
 * lands. The implant's stamp lives in `buildEquipmentAbilities`; the tripwire that every implant
 * debuff/DoT carries it is in `debuffApplicationFilterTripwire.test.ts`.
 *
 * Every board runs with Ripper on the player side and on the enemy side. Positive control: his
 * real active inflicts Inc. Repair Down II, which wakes both. Instrument control: the same implant
 * restamped `application: 'inflict'` wakes both, so the board can see an implant-landed inflict.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { boardInput, hitKit, type BoardUnit, type Placement } from '../__testutils__/realKitBoard';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { Ship } from '../../../types/ship';
import type { GearPiece } from '../../../types/gear';
import { buildEquipmentAbilities } from '../../abilities/buildEquipmentAbilities';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(206));

const SIDES: Placement[] = ['player', 'enemy'];
const ALLY_BUFF = 'Attack Up I';

/** The implant's real built ability, made to proc every time it is eligible. */
const implant = (name: string): Ability => {
    const piece = { id: 'imp', rarity: 'epic', setBonus: name } as unknown as GearPiece;
    const [ability] = buildEquipmentAbilities(
        { implants: { implant_major: 'imp' }, equipment: {} } as unknown as Ship,
        (id) => (id === 'imp' ? piece : undefined)
    );
    if (!ability) throw new Error(`${name} built no ability`);
    return { ...ability, procChance: 1 };
};

/** The same implant ability, restamped as an inflict. */
const asInflict = (ability: Ability): Ability => {
    if (ability.config.type !== 'debuff') throw new Error('not a debuff implant');
    return { ...ability, config: { ...ability.config, application: 'inflict' } };
};

/** Ripper's game 3.23 kit, verbatim, at refit 4. Pinned inline: his 3.24 passives answer only debuffs
 *  his active or charged inflicts, so an implant-landed debuff could not wake them either way and
 *  the instrument control below would have nothing to see. */
const ripperKit = buildShipAbilities({
    refits: [{}, {}, {}, {}],
    activeSkillText:
        'This Unit deals <unit-damage>165% damage</unit-damage> and inflicts <unit-skill>Inc. Repair Down II</unit-skill> for 1 turn.',
    chargeSkillText:
        'This Unit deals <unit-damage>195% damage</unit-damage>, inflicts <unit-skill>Inc. Repair Down III</unit-skill> for 3 turns, and <unit-skill>Inc. DoT Damage Up II</unit-skill> for 2 turns.',
    chargeSkillCharge: 3,
    firstPassiveSkillText:
        'This Unit gains <unit-skill>Marauder Rage II</unit-skill> for 3 turns after it inflicts a <unit-aid>debuff</unit-aid>.',
    secondPassiveSkillText:
        'This Unit gains <unit-skill>Marauder Rage II</unit-skill> for 3 turns after it inflicts a <unit-aid>debuff</unit-aid> and all allies active <unit-skill>buffs are extended by 1 turn</unit-skill>.',
} as unknown as Ship);
const realActive = () => ripperKit.slots.find((s) => s.slot === 'active')!;

/** Ripper with his real R2 passives plus `implants`, casting `active`. Fastest, so Doomsayer's
 *  "first to activate" is his; beside the ally the foe hits, so Bulwark answers that hit. */
const ripper = (active: ShipSkills['slots'][number], implants: Ability[] = []): BoardUnit => ({
    id: 'ripper',
    kit: {
        slots: [
            active,
            ...ripperKit.slots
                .filter((s) => s.slot === 'passive')
                .map((s) => ({ ...s, abilities: [...s.abilities, ...implants] })),
        ],
    },
    position: 'M3',
    speed: 2_000,
    attack: 1_000,
    hacking: 1_000_000,
});

/** Grants itself Attack Up I (3 turns) with its round-1 charged and never casts again. */
const ally: BoardUnit = {
    id: 'ally',
    kit: {
        slots: [
            { slot: 'active', abilities: [] },
            {
                slot: 'charged',
                abilities: [
                    {
                        id: 'ally-attack-up',
                        type: 'buff',
                        target: 'self',
                        trigger: 'on-cast',
                        conditions: [],
                        config: {
                            type: 'buff',
                            buffName: ALLY_BUFF,
                            parsedEffects: { attack: 10 },
                            stacks: 1,
                            isStackable: false,
                            duration: 3,
                        },
                    },
                ],
            },
        ],
    },
    position: 'M4',
    speed: 900,
    hp: 1e9,
    chargeCount: 20,
    startCharged: true,
};

const foe: BoardUnit = {
    id: 'foe',
    kit: hitKit(10),
    position: 'M4',
    speed: 100,
    attack: 100,
    hp: 1e9,
};

interface Observed {
    /** Debuffs Ripper landed, as `name:application`. */
    landed: string[];
    /** Marauder Rage II grants on Ripper. */
    rage: number;
    /** The round the ally's Attack Up I expired (undefined: it outlasted the fight). */
    allyBuffExpired?: number;
}

const run = (placement: Placement, r: BoardUnit): Observed => {
    const { input, id } = boardInput(placement, r, [ally], [foe], 6);
    const rid = id(r);
    const obs: Observed = { landed: [], rage: 0 };
    const bus = createEventBus();
    bus.on('debuff-applied', (e) => {
        if (e.sourceId === rid) obs.landed.push(`${e.buffName}:${e.application ?? 'inflict'}`);
    });
    bus.on('buff-applied', (e) => {
        if (e.actorId === rid && e.buffName === 'Marauder Rage II') obs.rage++;
    });
    bus.on('buff-expired', (e) => {
        if (e.actorId === id(ally) && e.buffName === ALLY_BUFF) obs.allyBuffExpired ??= e.round;
    });
    runCombat({ ...input, bus });
    return obs;
};

describe.each(SIDES)('Ripper on the %s side', (placement) => {
    const plain = () => hitKit(100).slots[0];
    const baseline = () => run(placement, ripper(plain()));

    it('baseline: a plain hit lands no debuff, gains no Rage, and the ally buff expires', () => {
        const obs = baseline();
        expect(obs.landed).toEqual([]);
        expect(obs.rage).toBe(0);
        expect(obs.allyBuffExpired).toBeDefined();
    });

    it('positive control: his active inflicts Inc. Repair Down II → Rage and the extension', () => {
        const obs = run(placement, ripper(realActive()));
        expect(obs.landed.length).toBeGreaterThan(0);
        expect(obs.landed.every((l) => l === 'Inc. Repair Down II:inflict')).toBe(true);
        expect(obs.rage).toBe(obs.landed.length);
        expect(obs.allyBuffExpired).toBeUndefined();
    });

    describe.each([
        ['Doomsayer', 'DOOMSAYER', 'Concentrate Fire'],
        ['Bulwark', 'BULWARK', 'Provoke'],
    ])('%s', (_label, implantName, debuff) => {
        it(`the ${debuff} it lands is an apply: no Rage, no extension`, () => {
            const obs = run(placement, ripper(plain(), [implant(implantName)]));
            expect(obs.landed.length).toBeGreaterThan(0);
            expect(obs.landed.every((l) => l === `${debuff}:apply`)).toBe(true);
            expect(obs.rage).toBe(0);
            expect(obs.allyBuffExpired).toBe(baseline().allyBuffExpired);
        });

        it(`instrument control: the same ${debuff} restamped as an inflict wakes both`, () => {
            const obs = run(placement, ripper(plain(), [asInflict(implant(implantName))]));
            expect(obs.landed.length).toBeGreaterThan(0);
            expect(obs.landed.every((l) => l === `${debuff}:inflict`)).toBe(true);
            expect(obs.rage).toBe(obs.landed.length);
            expect(obs.allyBuffExpired).not.toBe(baseline().allyBuffExpired);
        });
    });
});
