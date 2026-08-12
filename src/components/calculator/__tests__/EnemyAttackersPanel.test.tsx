import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EnemyAttackersPanel, EnemyAttackerConfig } from '../EnemyAttackersPanel';
import { buildDefaultShipSkills } from '../../../utils/abilities/configToSimInputs';
import { Ship } from '../../../types/ship';

const mockGetShipById = vi.fn((_id: string): Ship | undefined => undefined);

vi.mock('../../../contexts/ShipsContext', () => ({
    useShips: () => ({ ships: [], getShipById: mockGetShipById }),
}));

vi.mock('../../ui/layout/Sidebar', () => ({ Sidebar: () => null }));

// ShipSelector pulls in ShipDisplay which needs many context providers — stub it out.
vi.mock('../../ship/ShipSelector', () => ({
    ShipSelector: () => null,
}));

const minimalShip: Ship = {
    id: 'x',
    name: 'Test Ship',
    rarity: 'LEGENDARY',
    faction: 'ATLAS_SYNDICATE',
    type: 'ATTACKER',
    baseStats: {
        hp: 0,
        attack: 0,
        defence: 0,
        hacking: 0,
        security: 0,
        crit: 0,
        critDamage: 0,
        speed: 0,
    },
    equipment: {},
    implants: {},
    refits: [],
};

const manual: EnemyAttackerConfig = {
    id: '1',
    name: 'Enemy 1',
    attack: 4000,
    crit: 0,
    critDamage: 0,
    speed: 50,
    hacking: 0,
    chargeCount: 0,
    startCharged: false,
    // SP-3b Task 8: an enemy is a real, placed, killable actor. `hp: 0` would mean an
    // already-destroyed enemy, so these are the page's real defaults rather than zeros.
    position: 'M4',
    hp: 40000,
    defence: 5000,
    security: 100,
};

const noop = () => {};

describe('EnemyAttackersPanel', () => {
    beforeEach(() => {
        mockGetShipById.mockReset();
        mockGetShipById.mockReturnValue(undefined);
    });
    it('renders manual fields with their defaults', () => {
        render(
            <EnemyAttackersPanel
                isOpen
                onToggle={noop}
                enemies={[manual]}
                onAdd={noop}
                onRemove={noop}
                onSelectShip={noop}
                onUpdate={noop}
            />
        );
        expect(screen.getByLabelText('Attack')).toHaveValue(4000);
        expect(screen.getByLabelText('Speed')).toHaveValue(50);
        // No ship picked → autofill note absent
        expect(
            screen.queryByText('Damage abilities are simulated; other abilities are not yet.')
        ).not.toBeInTheDocument();
    });

    it('shows the autofill note when a ship is selected for an enemy', () => {
        mockGetShipById.mockImplementation((id: string) => (id === 'x' ? minimalShip : undefined));
        render(
            <EnemyAttackersPanel
                isOpen
                onToggle={noop}
                enemies={[{ ...manual, shipId: 'x', shipSkills: buildDefaultShipSkills() }]}
                onAdd={noop}
                onRemove={noop}
                onSelectShip={noop}
                onUpdate={noop}
            />
        );
        expect(
            screen.getByText('Damage abilities are simulated; other abilities are not yet.')
        ).toBeInTheDocument();
    });

    it('calls onAdd and keeps the add button visible beyond four enemies (no cap)', () => {
        const onAdd = vi.fn();
        const { rerender } = render(
            <EnemyAttackersPanel
                isOpen
                onToggle={noop}
                enemies={[manual]}
                onAdd={onAdd}
                onRemove={noop}
                onSelectShip={noop}
                onUpdate={noop}
            />
        );
        fireEvent.click(screen.getByText('+ Add enemy'));
        expect(onAdd).toHaveBeenCalled();

        const slots = ['M4', 'T4', 'B4', 'M3', 'T3'] as const;
        const five = [1, 2, 3, 4, 5].map((n) => ({
            ...manual,
            id: `${n}`,
            name: `Enemy ${n}`,
            position: slots[n - 1],
        }));
        rerender(
            <EnemyAttackersPanel
                isOpen
                onToggle={noop}
                enemies={five}
                onAdd={onAdd}
                onRemove={noop}
                onSelectShip={noop}
                onUpdate={noop}
            />
        );
        expect(screen.getByText('+ Add enemy')).toBeInTheDocument();
    });

    it('renders an affinity selector defaulting to Antimatter', () => {
        render(
            <EnemyAttackersPanel
                isOpen
                onToggle={noop}
                enemies={[manual]}
                onAdd={noop}
                onRemove={noop}
                onSelectShip={noop}
                onUpdate={noop}
            />
        );
        // The shared Affinity Select renders its label and the selected option text.
        expect(screen.getByText('Affinity')).toBeInTheDocument();
        expect(screen.getByText('Antimatter')).toBeInTheDocument();
    });

    it('reflects the enemy affinity field and calls onUpdate with the chosen affinity', () => {
        const onUpdate = vi.fn();
        render(
            <EnemyAttackersPanel
                isOpen
                onToggle={noop}
                enemies={[{ ...manual, affinity: 'thermal' }]}
                onAdd={noop}
                onRemove={noop}
                onSelectShip={noop}
                onUpdate={onUpdate}
            />
        );
        // Selected value is reflected.
        expect(screen.getByText('Thermal')).toBeInTheDocument();
        // Open the affinity Select and pick Electric.
        fireEvent.click(screen.getByLabelText('Affinity'));
        fireEvent.click(screen.getByText('Electric'));
        expect(onUpdate).toHaveBeenCalledWith('1', { affinity: 'electric' });
    });

    it('propagates manual edits and removal', () => {
        const onUpdate = vi.fn();
        const onRemove = vi.fn();
        render(
            <EnemyAttackersPanel
                isOpen
                onToggle={noop}
                enemies={[manual]}
                onAdd={noop}
                onRemove={onRemove}
                onSelectShip={noop}
                onUpdate={onUpdate}
            />
        );
        fireEvent.change(screen.getByLabelText('Attack'), { target: { value: '8000' } });
        expect(onUpdate).toHaveBeenCalledWith('1', { attack: 8000 });
        fireEvent.click(screen.getByLabelText('Remove enemy'));
        expect(onRemove).toHaveBeenCalledWith('1');
    });

    it('renders the hacking field and propagates edits', () => {
        const onUpdate = vi.fn();
        render(
            <EnemyAttackersPanel
                isOpen
                onToggle={noop}
                enemies={[{ ...manual, hacking: 250 }]}
                onAdd={noop}
                onRemove={noop}
                onSelectShip={noop}
                onUpdate={onUpdate}
            />
        );
        expect(screen.getByLabelText('Hacking')).toHaveValue(250);
        fireEvent.change(screen.getByLabelText('Hacking'), { target: { value: '300' } });
        expect(onUpdate).toHaveBeenCalledWith('1', { hacking: 300 });
    });

    // ── SP-3b Task 8: the enemy is a real, placed, killable actor ───────────────
    it("renders the enemy's OWN hp/defence/security and propagates edits", () => {
        const onUpdate = vi.fn();
        render(
            <EnemyAttackersPanel
                isOpen
                onToggle={noop}
                enemies={[manual]}
                onAdd={noop}
                onRemove={noop}
                onSelectShip={noop}
                onUpdate={onUpdate}
            />
        );
        // The defaults must not be zeros: hp 0 is an already-destroyed enemy (every damage-dealt
        // rider then pays out nothing) and security 0 makes the healer's debuffs land strictly more
        // often than they did before the run became positional.
        expect(screen.getByLabelText('HP')).toHaveValue(40000);
        expect(screen.getByLabelText('Defence')).toHaveValue(5000);
        expect(screen.getByLabelText('Security')).toHaveValue(100);

        fireEvent.change(screen.getByLabelText('HP'), { target: { value: '1' } });
        expect(onUpdate).toHaveBeenCalledWith('1', { hp: 1 });
        // HP clamps to 1, not 0. Clearing the field is the reachable path to 0 (parseInt('') is NaN),
        // and 0 is the one value the field must never emit: a 0-HP enemy starts the run already
        // destroyed, so the healer's cast delivers nothing to it and every damage-dealt rider pays
        // out zero. A typed 0 must not get through either.
        fireEvent.change(screen.getByLabelText('HP'), { target: { value: '' } });
        expect(onUpdate).toHaveBeenCalledWith('1', { hp: 1 });
        fireEvent.change(screen.getByLabelText('HP'), { target: { value: '0' } });
        expect(onUpdate).toHaveBeenCalledWith('1', { hp: 1 });
        expect(onUpdate).not.toHaveBeenCalledWith('1', { hp: 0 });
        fireEvent.change(screen.getByLabelText('Defence'), { target: { value: '9000' } });
        expect(onUpdate).toHaveBeenCalledWith('1', { defence: 9000 });
        fireEvent.change(screen.getByLabelText('Security'), { target: { value: '250' } });
        expect(onUpdate).toHaveBeenCalledWith('1', { security: 250 });
    });

    it('renders a board-slot dropdown and reports the chosen cell', () => {
        const onUpdate = vi.fn();
        render(
            <EnemyAttackersPanel
                isOpen
                onToggle={noop}
                enemies={[manual]}
                onAdd={noop}
                onRemove={noop}
                onSelectShip={noop}
                onUpdate={onUpdate}
            />
        );
        // Column 4 is the FRONT — annotated, because there is no board to read it off.
        expect(screen.getByText('M4 (front)')).toBeInTheDocument();
        // `Select` is portal-based, not a native <select>: open it, then click the option.
        fireEvent.click(screen.getByLabelText('Board slot'));
        fireEvent.click(screen.getByText('T1'));
        expect(onUpdate).toHaveBeenCalledWith('1', { position: 'T1' });
    });

    it("annotates another enemy's cell as taken", () => {
        render(
            <EnemyAttackersPanel
                isOpen
                onToggle={noop}
                enemies={[manual, { ...manual, id: '2', name: 'Enemy 2', position: 'T1' }]}
                onAdd={noop}
                onRemove={noop}
                onSelectShip={noop}
                onUpdate={noop}
            />
        );
        // Open the FIRST enemy's dropdown (M4) — T1 belongs to the second enemy.
        fireEvent.click(screen.getAllByLabelText('Board slot')[0]);
        expect(screen.getByText('T1 (taken)')).toBeInTheDocument();
    });

    it('renders correctly with zero enemies and still shows the Add button', () => {
        render(
            <EnemyAttackersPanel
                isOpen
                onToggle={noop}
                enemies={[]}
                onAdd={noop}
                onRemove={noop}
                onSelectShip={noop}
                onUpdate={noop}
            />
        );
        // No enemy cards rendered.
        expect(screen.queryByLabelText('Remove enemy')).not.toBeInTheDocument();
        // Add button still visible with zero enemies.
        expect(screen.getByText('+ Add enemy')).toBeInTheDocument();
    });
});
