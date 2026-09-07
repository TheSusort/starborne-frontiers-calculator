import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AddShipTemplateForm, ShipTemplateFormData } from '../AddShipTemplateForm';

const BLANK: ShipTemplateFormData = {
    name: 'Probe Ship',
    affinity: 'chemical',
    rarity: 'rare',
    faction: 'Atlas Syndicate',
    type: 'Attacker',
    hp: 1,
    attack: 1,
    defence: 1,
    hacking: 1,
    security: 1,
    critRate: 1,
    critDamage: 1,
    speed: 1,
    hpRegen: 0,
    shield: 0,
    shieldPenetration: 0,
    defensePenetration: 0,
    imageKey: '',
    activeSkillText: '',
    chargeSkillText: '',
    chargeSkillCharge: 0,
    firstPassiveSkillText: '',
    secondPassiveSkillText: '',
    thirdPassiveSkillText: '',
    activeTarget: '',
    activePattern: '',
    chargedTarget: '',
    chargedPattern: '',
    definitionId: '',
};

const renderForm = (initialData: ShipTemplateFormData | null = null) => {
    const onSubmit = vi.fn<(data: ShipTemplateFormData) => Promise<void>>().mockResolvedValue();
    const { container } = render(
        <AddShipTemplateForm
            onSubmit={onSubmit}
            loading={false}
            mode="edit"
            initialData={initialData}
        />
    );
    const submit = () => fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    return { onSubmit, submit };
};

const activePattern = () => screen.getByLabelText('Active Pattern');
const chargedPattern = () => screen.getByLabelText('Charged Pattern');
const submitButton = () => screen.getByRole('button', { name: 'Update Template' });

describe('AddShipTemplateForm — targeting fields', () => {
    // The edit path must read the stored columns back into the form: the service now
    // writes all four on update, so a field the form drops is a field the edit nulls out.
    it('populates all four fields from an existing template and submits them unchanged', () => {
        const { onSubmit, submit } = renderForm({
            ...BLANK,
            activeTarget: 'front',
            activePattern: 'Pattern-Cone-Range-2',
            chargedTarget: 'all',
            chargedPattern: 'Pattern-All',
        });

        expect(activePattern()).toHaveValue('Pattern-Cone-Range-2');
        expect(chargedPattern()).toHaveValue('Pattern-All');

        submit();

        expect(onSubmit).toHaveBeenCalledWith(
            expect.objectContaining({
                activeTarget: 'front',
                activePattern: 'Pattern-Cone-Range-2',
                chargedTarget: 'all',
                chargedPattern: 'Pattern-All',
            })
        );
    });

    it('keeps an empty charged pattern empty rather than copying the active one', () => {
        const { onSubmit, submit } = renderForm({
            ...BLANK,
            activeTarget: 'front',
            activePattern: 'Pattern-Cone-Range-2',
        });

        // The empty charged target must READ as inherit-from-active, not as an unchosen
        // Select — Select falls back to `defaultOption` ('Select') for a value it cannot
        // find, which would hide the only label that carries the meaning.
        expect(screen.getByText('— same as active —')).toBeInTheDocument();

        submit();

        expect(onSubmit).toHaveBeenCalledWith(
            expect.objectContaining({ chargedTarget: '', chargedPattern: '' })
        );
    });

    // A pattern the parser rejects would make parseShipTargeting throw wherever the sim
    // reads the ship, so it must not be saveable.
    it('blocks submission while a pattern is unparseable, and unblocks when it parses', () => {
        renderForm(BLANK);

        expect(submitButton()).not.toBeDisabled();

        fireEvent.change(activePattern(), { target: { value: 'Pattern-Nonsense' } });
        expect(screen.getByText(/Unknown pattern shape/)).toBeInTheDocument();
        expect(submitButton()).toBeDisabled();

        fireEvent.change(activePattern(), { target: { value: 'Pattern-Cone-Range-2' } });
        expect(submitButton()).not.toBeDisabled();
        expect(screen.getByText(/shape: cone/)).toBeInTheDocument();
    });

    it('blocks submission for an unparseable CHARGED pattern too', () => {
        renderForm(BLANK);

        fireEvent.change(chargedPattern(), { target: { value: 'Pattern-Nonsense' } });

        expect(submitButton()).toBeDisabled();
    });

    // parseShipTargeting needs both active columns; one alone yields no targeting at all.
    it('warns when only one of the two active axes is filled', () => {
        renderForm({ ...BLANK, activeTarget: 'front' });

        expect(screen.getByText(/no targeting at all/)).toBeInTheDocument();

        fireEvent.change(activePattern(), { target: { value: 'Pattern-Cone-Range-2' } });
        expect(screen.queryByText(/no targeting at all/)).not.toBeInTheDocument();
    });
});
