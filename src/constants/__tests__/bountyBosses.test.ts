import { describe, it, expect } from 'vitest';
import {
    BOUNTY_ADDS,
    BOUNTY_ENCOUNTERS,
    bossFootprint,
    bossShip,
    bossShipId,
    isBossShipId,
    npcShip,
    npcShipId,
    parseBossShipId,
    parseNpcShipId,
} from '../bountyBosses';

describe('parseBossShipId', () => {
    it('reads a boss id back into bounty and level', () => {
        expect(parseBossShipId('boss:fenri:32')).toEqual({ id: 'fenri', level: 32 });
    });

    it('rejects unknown bosses, non-numeric levels and other id kinds', () => {
        expect(parseBossShipId('boss:nope:32')).toBeNull();
        expect(parseBossShipId('boss:fenri:x')).toBeNull();
        expect(parseBossShipId('template:abc:r0')).toBeNull();
        expect(parseBossShipId('owned-uuid')).toBeNull();
    });

    it('round-trips bossShipId', () => {
        expect(parseBossShipId(bossShipId('fenri', 32))).toEqual({ id: 'fenri', level: 32 });
    });
});

describe('bossShip', () => {
    it('is null for a level without stats', () => {
        expect(bossShip('fenri', 31)).toBeNull();
    });

    it('builds Fenri at level 32', () => {
        const ship = bossShip('fenri', 32)!;
        expect(ship.id).toBe('boss:fenri:32');
        expect(ship.baseStats.hp).toBe(327000);
        expect(ship.affinity).toBe('antimatter');
        expect(ship.type).toBe('ATTACKER');
        expect(ship.chargeSkillCharge).toBe(2);
        expect(ship.activePattern).toBe('Pattern-Line-Range-2');
        expect(ship.firstPassiveSkillText).toContain('<unit-skill>Pressing Onslaught</unit-skill>');
    });
});

describe('bossFootprint', () => {
    it('returns the boss footprint', () => {
        expect(bossFootprint(bossShip('fenri', 32)!)).toEqual(['M1', 'M2']);
    });

    it('is undefined for a non-boss ship', () => {
        expect(bossFootprint({ ...bossShip('fenri', 32)!, id: 'owned-uuid' })).toBeUndefined();
    });
});

describe('Mamma Maglienza', () => {
    it('builds at level 32 with the measured stats', () => {
        const ship = bossShip('maglienza', 32)!;
        expect(ship.id).toBe('boss:maglienza:32');
        expect(ship.name).toBe('Mamma Maglienza');
        expect(ship.affinity).toBe('electric');
        expect(ship.type).toBe('DEBUFFER');
        expect(ship.chargeSkillCharge).toBe(2);
        expect(ship.baseStats).toMatchObject({ hp: 225450, attack: 21958, speed: 121 });
        expect(bossFootprint(ship)).toEqual(['T1', 'M2', 'M3', 'B1']);
    });
});

describe('General Colosso', () => {
    it('builds at level 32 with the fitted stats', () => {
        const ship = bossShip('colosso', 32)!;
        expect(ship.id).toBe('boss:colosso:32');
        expect(ship.name).toBe('General Colosso');
        expect(ship.affinity).toBe('thermal');
        expect(ship.type).toBe('DEFENDER');
        expect(ship.chargeSkillCharge).toBe(2);
        expect(ship.baseStats).toMatchObject({
            hp: 251155,
            defence: 25137,
            critDamage: 13,
            speed: 93,
        });
        expect(bossFootprint(ship)).toEqual(['T3', 'M3', 'M4', 'B3']);
    });

    it('has three Major Grands at T1, M2, B1 and the anchor is the first footprint cell', () => {
        const encounter = BOUNTY_ENCOUNTERS.find(
            (e) => e.bountyId === 'colosso' && e.level === 32
        )!;
        expect(encounter.adds).toEqual([
            { addId: 'major-grand', position: 'T1' },
            { addId: 'major-grand', position: 'M2' },
            { addId: 'major-grand', position: 'B1' },
        ]);
        expect(bossFootprint(bossShip('colosso', 32)!)![0]).toBe('T3');
    });
});

describe('Eelun Naphula', () => {
    it('builds at level 32 on a four-cell footprint anchored at T1', () => {
        const ship = bossShip('eelun', 32)!;
        expect(ship.id).toBe('boss:eelun:32');
        expect(ship.affinity).toBe('chemical');
        expect(ship.type).toBe('SUPPORTER');
        expect(ship.chargeSkillCharge).toBe(3);
        expect(ship.activeTarget).toBe('all');
        expect(ship.chargedPattern).toBe('Pattern-All');
        expect(ship.baseStats).toMatchObject({ hp: 219150, speed: 130 });
        expect(bossFootprint(ship)).toEqual(['T1', 'M1', 'M2', 'B1']);
    });

    it('places Sitri T3, Beleth M3, Corson M4, Sitri B3', () => {
        const encounter = BOUNTY_ENCOUNTERS.find((e) => e.bountyId === 'eelun' && e.level === 32)!;
        expect(encounter.adds).toEqual([
            { addId: 'sitri', position: 'T3' },
            { addId: 'beleth', position: 'M3' },
            { addId: 'corson', position: 'M4' },
            { addId: 'sitri', position: 'B3' },
        ]);
    });

    it.each([
        ['sitri', 'ATTACKER', 31920, 109, 3],
        ['beleth', 'SUPPORTER', 63030, 119, 2],
        ['corson', 'DEFENDER', 73940, 83, 2],
    ])('resolves npc:%s:124', (id, type, hp, speed, charges) => {
        expect(parseNpcShipId(`npc:${id}:124`)).toEqual({ id, level: 124 });
        const ship = npcShip(id, 124)!;
        expect(ship.affinity).toBe('chemical');
        expect(ship.type).toBe(type);
        expect(ship.baseStats).toMatchObject({ hp, speed });
        expect(ship.chargeSkillCharge).toBe(charges);
        expect(ship.firstPassiveSkillText).toBe('');
    });

    it.each(['sitri', 'corson'])(
        '%s targets front, skipping defenders, with a range-1 cone',
        (id) => {
            expect(npcShip(id, 124)).toMatchObject({
                activeTarget: 'front-skip-defenders',
                activePattern: 'Pattern-Cone-Range-1',
                chargedTarget: 'front-skip-defenders',
                chargedPattern: 'Pattern-Cone-Range-1',
            });
        }
    );

    it('fits Sitri attack and Corson defence to the measured hits', () => {
        expect(npcShip('sitri', 124)!.baseStats.attack).toBe(16670);
        expect(npcShip('corson', 124)!.baseStats.defence).toBe(15260);
    });
});

describe('Major Grand', () => {
    it('resolves as npc:major-grand:124 with no charged skill', () => {
        expect(parseNpcShipId('npc:major-grand:124')).toEqual({ id: 'major-grand', level: 124 });
        const ship = npcShip('major-grand', 124)!;
        expect(ship.id).toBe('npc:major-grand:124');
        expect(ship.affinity).toBe('thermal');
        expect(ship.type).toBe('DEBUFFER');
        expect(ship.baseStats).toMatchObject({
            hp: 42050,
            attack: 10470,
            defence: 9086,
            speed: 106,
        });
        expect(ship.chargeSkillText).toBe('');
        expect(ship.chargeSkillCharge).toBe(0);
    });
});

describe('npc ids', () => {
    it('round-trips npcShipId', () => {
        expect(npcShipId('capo', 124)).toBe('npc:capo:124');
        expect(parseNpcShipId(npcShipId('capo', 124))).toEqual({ id: 'capo', level: 124 });
    });

    it('rejects unknown adds, bad levels and other id kinds', () => {
        expect(parseNpcShipId('npc:nope:124')).toBeNull();
        expect(parseNpcShipId('npc:capo:x')).toBeNull();
        expect(parseNpcShipId('npc:capo:124:1')).toBeNull();
        expect(parseNpcShipId('boss:fenri:32')).toBeNull();
        expect(parseBossShipId('npc:capo:124')).toBeNull();
    });

    it('isBossShipId is true only for boss ids', () => {
        expect(isBossShipId('boss:fenri:32')).toBe(true);
        expect(isBossShipId('boss:nope:32')).toBe(false);
        expect(isBossShipId('npc:capo:124')).toBe(false);
        expect(isBossShipId('owned-uuid')).toBe(false);
    });
});

describe('npcShip', () => {
    it('is null for a level the add does not exist at', () => {
        expect(npcShip('capo', 60)).toBeNull();
    });

    it('builds a Capo', () => {
        const ship = npcShip('capo', 124)!;
        expect(ship.id).toBe('npc:capo:124');
        expect(ship.affinity).toBe('electric');
        expect(ship.type).toBe('DEFENDER');
        expect(ship.chargeSkillCharge).toBe(2);
        expect(ship.baseStats).toMatchObject({ hp: 60170, defence: 10943, speed: 83 });
        expect(ship.activeSkillText).toContain('of its Defense');
    });
});

describe('Abyssal Fenri Khaliriz', () => {
    it('builds at level 33 from its own kit and stats', () => {
        const ship = bossShip('fenri', 33)!;
        expect(ship.id).toBe('boss:fenri:33');
        expect(ship.name).toBe('Abyssal Fenri Khaliriz');
        expect(ship.affinity).toBe('antimatter');
        expect(ship.chargeSkillCharge).toBe(2);
        expect(ship.baseStats).toMatchObject({ hp: 499108, speed: 130 });
        expect(bossFootprint(ship)).toEqual(['M1', 'M2']);
    });

    it('leaves the level 32 kit and name untouched', () => {
        const ship = bossShip('fenri', 32)!;
        expect(ship.name).toBe('Fenri Khaliriz');
        expect(ship.activeSkillText).toContain('350% damage');
    });

    it('places a torpedo at T2 and T4, and the torpedo resolves', () => {
        const encounter = BOUNTY_ENCOUNTERS.find((e) => e.bountyId === 'fenri' && e.level === 33)!;
        expect(encounter.adds).toEqual([
            { addId: 'torpedo', position: 'T2' },
            { addId: 'torpedo', position: 'T4' },
        ]);
        expect(parseNpcShipId('npc:torpedo:135')).toEqual({ id: 'torpedo', level: 135 });
        expect(npcShip('torpedo', 135)).not.toBeNull();
    });
});

describe('BOUNTY_ENCOUNTERS', () => {
    it('lists Fenri without adds and Mamma with three Capos', () => {
        const fenri = BOUNTY_ENCOUNTERS.find((e) => e.bountyId === 'fenri' && e.level === 32)!;
        expect(fenri.adds).toEqual([]);
        const mamma = BOUNTY_ENCOUNTERS.find((e) => e.bountyId === 'maglienza' && e.level === 32)!;
        expect(mamma.adds).toEqual([
            { addId: 'capo', position: 'T2' },
            { addId: 'capo', position: 'M4' },
            { addId: 'capo', position: 'B2' },
        ]);
    });

    it('never puts two units on one cell, and every unit resolves', () => {
        for (const encounter of BOUNTY_ENCOUNTERS) {
            const boss = bossShip(encounter.bountyId, encounter.level)!;
            expect(boss).not.toBeNull();
            const footprint = bossFootprint(boss)!;
            const cells = [...footprint, ...encounter.adds.map((a) => a.position)];
            expect(new Set(cells).size).toBe(cells.length);
            for (const add of encounter.adds) {
                const def = BOUNTY_ADDS.find((candidate) => candidate.id === add.addId)!;
                expect(npcShip(def.id, def.level)).not.toBeNull();
            }
        }
    });
});
