import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AbilityCard } from '../AbilityCard';
import { Ability } from '../../../types/abilities';

const damageAbility: Ability = {
    id: 'a1',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 1.5 },
};

const buffAbility: Ability = {
    id: 'a2',
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName: '',
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
    },
};

describe('AbilityCard', () => {
    it('renders a multiplier input for a damage ability and fires onChange on edit', () => {
        const onChange = vi.fn();
        render(<AbilityCard ability={damageAbility} onChange={onChange} onRemove={vi.fn()} />);
        const input = screen.getByLabelText('Skill multiplier');
        fireEvent.change(input, { target: { value: '2' } });
        expect(onChange).toHaveBeenCalledWith(
            expect.objectContaining({
                config: expect.objectContaining({ type: 'damage', multiplier: 2 }),
            })
        );
    });

    it('appends a default condition when "Add condition" is clicked', () => {
        const onChange = vi.fn();
        render(<AbilityCard ability={damageAbility} onChange={onChange} onRemove={vi.fn()} />);
        fireEvent.click(screen.getByText('Add condition'));
        expect(onChange).toHaveBeenCalledWith(
            expect.objectContaining({
                conditions: [{ subject: 'always', derivable: true }],
            })
        );
    });

    it('renders the GameBuffPicker for a buff ability', () => {
        render(<AbilityCard ability={buffAbility} onChange={vi.fn()} onRemove={vi.fn()} />);
        // GameBuffPicker trigger shows "Select <label>…" when nothing selected.
        expect(screen.getByText(/Select .*Buff/i)).toBeInTheDocument();
    });

    it('calls onRemove when the remove button is clicked', () => {
        const onRemove = vi.fn();
        render(<AbilityCard ability={damageAbility} onChange={vi.fn()} onRemove={onRemove} />);
        fireEvent.click(screen.getByLabelText('Remove ability'));
        expect(onRemove).toHaveBeenCalled();
    });

    describe('sim-coverage notices', () => {
        const control: Ability = {
            id: 'a1',
            type: 'control',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'control', effect: 'provoke' },
        };
        const dot: Ability = {
            id: 'a2',
            type: 'dot',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'dot', dotType: 'corrosion', tier: 5, stacks: 1, duration: 2 },
        };

        it('shows a not-simulated note for utility types', () => {
            render(<AbilityCard ability={control} onChange={() => {}} onRemove={() => {}} />);
            expect(screen.getByText(/not simulated in the calculators yet/i)).toBeInTheDocument();
        });

        it('warns when a firing-only type sits on the passive slot', () => {
            render(
                <AbilityCard ability={dot} slot="passive" onChange={() => {}} onRemove={() => {}} />
            );
            expect(screen.getByText(/not simulated on the passive slot/i)).toBeInTheDocument();
        });

        it('does not warn for the same type on the active slot', () => {
            render(
                <AbilityCard ability={dot} slot="active" onChange={() => {}} onRemove={() => {}} />
            );
            expect(
                screen.queryByText(/not simulated on the passive slot/i)
            ).not.toBeInTheDocument();
        });

        it('does not warn for a charge ability on the passive slot (simulated since charge-aura sourcing)', () => {
            const charge: Ability = {
                id: 'a3',
                type: 'charge',
                target: 'self',
                trigger: 'on-cast',
                conditions: [],
                config: { type: 'charge', amount: 1 },
            };
            render(
                <AbilityCard
                    ability={charge}
                    slot="passive"
                    onChange={() => {}}
                    onRemove={() => {}}
                />
            );
            expect(
                screen.queryByText(/not simulated on the passive slot/i)
            ).not.toBeInTheDocument();
        });

        it('does not warn when a passive dot uses the on-ally-crit-dot live trigger (reactive, fires through trigger machinery)', () => {
            const reactiveDot: Ability = {
                id: 'a5',
                type: 'dot',
                target: 'enemy',
                trigger: 'on-ally-crit-dot',
                conditions: [],
                config: { type: 'dot', dotType: 'corrosion', tier: 5, stacks: 1, duration: 2 },
            };
            render(
                <AbilityCard
                    ability={reactiveDot}
                    slot="passive"
                    onChange={() => {}}
                    onRemove={() => {}}
                />
            );
            expect(
                screen.queryByText(/not simulated on the passive slot/i)
            ).not.toBeInTheDocument();
        });

        it('still warns when a passive dot uses the on-cast trigger', () => {
            render(
                <AbilityCard ability={dot} slot="passive" onChange={() => {}} onRemove={() => {}} />
            );
            expect(screen.getByText(/not simulated on the passive slot/i)).toBeInTheDocument();
        });
    });

    describe('Trigger select', () => {
        const buffWithTrigger = (trigger: Ability['trigger']): Ability => ({
            ...buffAbility,
            trigger,
        });

        const debuffAbility: Ability = {
            id: 'a3',
            type: 'debuff',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: {
                type: 'debuff',
                buffName: '',
                parsedEffects: {},
                stacks: 1,
                isStackable: false,
                application: 'inflict',
            },
        };

        const dotAbility: Ability = {
            id: 'a4',
            type: 'dot',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'dot', dotType: 'corrosion', tier: 5, stacks: 1, duration: 2 },
        };

        const chargeAbility: Ability = {
            id: 'a5',
            type: 'charge',
            target: 'self',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'charge', amount: 1 },
        };

        it('renders a Trigger select for buff abilities showing the current trigger label', () => {
            render(
                <AbilityCard
                    ability={buffWithTrigger('on-crit')}
                    onChange={vi.fn()}
                    onRemove={vi.fn()}
                />
            );
            // The label element has aria-label="Trigger"
            expect(screen.getByLabelText('Trigger')).toBeInTheDocument();
            // The selected label text is visible in the trigger button
            expect(screen.getByText('On critical hit')).toBeInTheDocument();
        });

        it('renders a Trigger select for debuff abilities', () => {
            render(<AbilityCard ability={debuffAbility} onChange={vi.fn()} onRemove={vi.fn()} />);
            expect(screen.getByLabelText('Trigger')).toBeInTheDocument();
        });

        it('renders a Trigger select for dot abilities', () => {
            render(<AbilityCard ability={dotAbility} onChange={vi.fn()} onRemove={vi.fn()} />);
            expect(screen.getByLabelText('Trigger')).toBeInTheDocument();
        });

        it('renders a Trigger select for charge abilities', () => {
            render(<AbilityCard ability={chargeAbility} onChange={vi.fn()} onRemove={vi.fn()} />);
            expect(screen.getByLabelText('Trigger')).toBeInTheDocument();
        });

        it('does not render a Trigger select for damage abilities', () => {
            render(<AbilityCard ability={damageAbility} onChange={vi.fn()} onRemove={vi.fn()} />);
            expect(screen.queryByLabelText('Trigger')).not.toBeInTheDocument();
        });

        it('calls onChange with the new trigger when an option is selected', () => {
            const onChange = vi.fn();
            render(
                <AbilityCard
                    ability={buffWithTrigger('on-cast')}
                    onChange={onChange}
                    onRemove={vi.fn()}
                />
            );
            // Open the Trigger dropdown by clicking the button (id matches label's htmlFor)
            fireEvent.click(screen.getByLabelText('Trigger'));
            // Click the "On critical hit" option
            fireEvent.click(screen.getByText('On critical hit'));
            expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ trigger: 'on-crit' }));
        });

        it('shows a not-simulated note for a non-live, non-on-cast trigger (on-ally-destroyed)', () => {
            render(
                <AbilityCard
                    ability={buffWithTrigger('on-ally-destroyed')}
                    onChange={vi.fn()}
                    onRemove={vi.fn()}
                />
            );
            expect(
                screen.getByText(/not simulated — treated as assume-active/i)
            ).toBeInTheDocument();
        });

        it('shows no note for on-attacked (now a live trigger since Task 4)', () => {
            render(
                <AbilityCard
                    ability={buffWithTrigger('on-attacked')}
                    onChange={vi.fn()}
                    onRemove={vi.fn()}
                />
            );
            expect(
                screen.queryByText(/not simulated — treated as assume-active/i)
            ).not.toBeInTheDocument();
        });

        it('shows no note for a live trigger', () => {
            render(
                <AbilityCard
                    ability={buffWithTrigger('on-crit')}
                    onChange={vi.fn()}
                    onRemove={vi.fn()}
                />
            );
            expect(
                screen.queryByText(/not simulated — treated as assume-active/i)
            ).not.toBeInTheDocument();
        });

        it('shows no note for the default on-cast trigger', () => {
            render(
                <AbilityCard
                    ability={buffWithTrigger('on-cast')}
                    onChange={vi.fn()}
                    onRemove={vi.fn()}
                />
            );
            expect(
                screen.queryByText(/not simulated — treated as assume-active/i)
            ).not.toBeInTheDocument();
        });
    });

    describe('extra-action ability', () => {
        const extraActionAbility: Ability = {
            id: 'a6',
            type: 'extra-action',
            target: 'self',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'extra-action', oncePerRound: false },
        };

        it('renders the summary text for an extra-action ability', () => {
            render(
                <AbilityCard ability={extraActionAbility} onChange={vi.fn()} onRemove={vi.fn()} />
            );
            expect(screen.getByText('+1 extra action')).toBeInTheDocument();
        });

        it('appends (once per round) to summary when oncePerRound is true', () => {
            const ability: Ability = {
                ...extraActionAbility,
                config: { type: 'extra-action', oncePerRound: true },
            };
            render(<AbilityCard ability={ability} onChange={vi.fn()} onRemove={vi.fn()} />);
            expect(screen.getByText('+1 extra action (once per round)')).toBeInTheDocument();
        });

        it('calls onChange with oncePerRound flipped when checkbox is toggled', () => {
            const onChange = vi.fn();
            render(
                <AbilityCard ability={extraActionAbility} onChange={onChange} onRemove={vi.fn()} />
            );
            fireEvent.click(screen.getByLabelText('Once per round'));
            expect(onChange).toHaveBeenCalledWith(
                expect.objectContaining({
                    config: expect.objectContaining({ type: 'extra-action', oncePerRound: true }),
                })
            );
        });
    });

    describe('heal / shield / cleanse abilities', () => {
        const healAbility: Ability = {
            id: 'h1',
            type: 'heal',
            target: 'ally',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'heal', pct: 15, basis: 'hp' },
        };

        const shieldAbility: Ability = {
            id: 'h2',
            type: 'shield',
            target: 'ally',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'shield', pct: 10, basis: 'attack' },
        };

        const cleanseAbility: Ability = {
            id: 'h3',
            type: 'cleanse',
            target: 'ally',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'cleanse', count: 1 },
        };

        const purgeAbility: Ability = {
            id: 'h4',
            type: 'purge',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'purge', count: 1 },
        };

        const damageDealtHealAbility: Ability = {
            id: 'h5',
            type: 'heal',
            target: 'self',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'heal', pct: 20, basis: 'damage-dealt' },
        };

        const damageTakenShieldAbility: Ability = {
            id: 'h6',
            type: 'shield',
            target: 'self',
            trigger: 'on-attacked',
            conditions: [],
            config: { type: 'shield', pct: 30, basis: 'damage-taken' },
        };

        it('heal ability renders pct/basis/noCrit fields', () => {
            const onChange = vi.fn();
            render(<AbilityCard ability={healAbility} onChange={onChange} onRemove={vi.fn()} />);
            expect(screen.getByLabelText('Percent')).toBeInTheDocument();
            expect(screen.getByLabelText('Based on stat')).toBeInTheDocument();
            expect(screen.getByLabelText('Cannot critically hit')).toBeInTheDocument();
        });

        it('heal ability propagates pct change via onChange', () => {
            const onChange = vi.fn();
            render(<AbilityCard ability={healAbility} onChange={onChange} onRemove={vi.fn()} />);
            fireEvent.change(screen.getByLabelText('Percent'), { target: { value: '25' } });
            expect(onChange).toHaveBeenCalledWith(
                expect.objectContaining({
                    config: expect.objectContaining({ type: 'heal', pct: 25 }),
                })
            );
        });

        it('heal/shield basis select offers Caster Defense and Recipient Max HP options', () => {
            render(<AbilityCard ability={healAbility} onChange={vi.fn()} onRemove={vi.fn()} />);
            // Open the "Based on stat" select
            fireEvent.click(screen.getByLabelText('Based on stat'));
            expect(screen.getByText("Caster's Defense")).toBeInTheDocument();
            expect(screen.getByText("Recipient's Max HP")).toBeInTheDocument();
        });

        it('shield ability renders pct/basis but no noCrit checkbox', () => {
            render(<AbilityCard ability={shieldAbility} onChange={vi.fn()} onRemove={vi.fn()} />);
            expect(screen.getByLabelText('Percent')).toBeInTheDocument();
            expect(screen.getByLabelText('Based on stat')).toBeInTheDocument();
            expect(screen.queryByLabelText('Cannot critically hit')).not.toBeInTheDocument();
        });

        it('cleanse ability renders count field and does NOT show not-simulated note', () => {
            const onChange = vi.fn();
            render(<AbilityCard ability={cleanseAbility} onChange={onChange} onRemove={vi.fn()} />);
            expect(screen.getByLabelText('Count')).toBeInTheDocument();
            expect(
                screen.queryByText(/not simulated in the calculators yet/i)
            ).not.toBeInTheDocument();
        });

        it('cleanse ability propagates count change via onChange', () => {
            const onChange = vi.fn();
            render(<AbilityCard ability={cleanseAbility} onChange={onChange} onRemove={vi.fn()} />);
            fireEvent.change(screen.getByLabelText('Count'), { target: { value: '2' } });
            expect(onChange).toHaveBeenCalledWith(
                expect.objectContaining({
                    config: expect.objectContaining({ type: 'cleanse', count: 2 }),
                })
            );
        });

        it('purge ability renders Count field AND the not-simulated note', () => {
            render(<AbilityCard ability={purgeAbility} onChange={vi.fn()} onRemove={vi.fn()} />);
            expect(screen.getByLabelText('Count')).toBeInTheDocument();
            expect(screen.getByText(/not simulated in the calculators yet/i)).toBeInTheDocument();
        });

        it('purge ability propagates count change via onChange', () => {
            const onChange = vi.fn();
            render(<AbilityCard ability={purgeAbility} onChange={onChange} onRemove={vi.fn()} />);
            fireEvent.change(screen.getByLabelText('Count'), { target: { value: '3' } });
            expect(onChange).toHaveBeenCalledWith(
                expect.objectContaining({
                    config: expect.objectContaining({ type: 'purge', count: 3 }),
                })
            );
        });

        it('damage-dealt heal on passive slot renders the basis select and a leech-scope select', () => {
            render(
                <AbilityCard
                    ability={damageDealtHealAbility}
                    slot="passive"
                    onChange={vi.fn()}
                    onRemove={vi.fn()}
                />
            );
            // Basis select shows the damage-dealt option as selected.
            fireEvent.click(screen.getByLabelText('Based on stat'));
            expect(screen.getAllByText('Damage dealt').length).toBeGreaterThan(0);
            // Scope select with its two options.
            fireEvent.click(screen.getByLabelText('Leech scope'));
            expect(screen.getAllByText('All damage').length).toBeGreaterThan(0);
            expect(screen.getByText('Detonations only')).toBeInTheDocument();
        });

        it('damage-dealt heal on active slot does NOT render the leech-scope select', () => {
            render(
                <AbilityCard
                    ability={damageDealtHealAbility}
                    slot="active"
                    onChange={vi.fn()}
                    onRemove={vi.fn()}
                />
            );
            expect(screen.queryByLabelText('Leech scope')).not.toBeInTheDocument();
        });

        it('changing leech scope to Detonations only sets leechScope detonation', () => {
            const onChange = vi.fn();
            render(
                <AbilityCard
                    ability={damageDealtHealAbility}
                    slot="passive"
                    onChange={onChange}
                    onRemove={vi.fn()}
                />
            );
            fireEvent.click(screen.getByLabelText('Leech scope'));
            fireEvent.click(screen.getByText('Detonations only'));
            expect(onChange).toHaveBeenCalledWith(
                expect.objectContaining({
                    config: expect.objectContaining({ leechScope: 'detonation' }),
                })
            );
        });

        it('changing leech scope to All damage sets leechScope all', () => {
            const onChange = vi.fn();
            render(
                <AbilityCard
                    ability={{
                        ...damageDealtHealAbility,
                        config: {
                            type: 'heal',
                            pct: 20,
                            basis: 'damage-dealt',
                            leechScope: 'detonation',
                        },
                    }}
                    slot="passive"
                    onChange={onChange}
                    onRemove={vi.fn()}
                />
            );
            fireEvent.click(screen.getByLabelText('Leech scope'));
            fireEvent.click(screen.getByText('All damage'));
            expect(onChange).toHaveBeenCalledWith(
                expect.objectContaining({
                    config: expect.objectContaining({ leechScope: 'all' }),
                })
            );
        });

        it('damage-taken shield on passive slot renders the punch-through checkbox and toggles it', () => {
            const onChange = vi.fn();
            render(
                <AbilityCard
                    ability={damageTakenShieldAbility}
                    slot="passive"
                    onChange={onChange}
                    onRemove={vi.fn()}
                />
            );
            const checkbox = screen.getByLabelText('Only when damage punches through shield');
            expect(checkbox).toBeInTheDocument();
            // Toggle ON -> requiresHpDamage: true
            fireEvent.click(checkbox);
            expect(onChange).toHaveBeenCalledWith(
                expect.objectContaining({
                    config: expect.objectContaining({ requiresHpDamage: true }),
                })
            );
        });

        it('damage-taken shield punch-through toggles OFF to undefined', () => {
            const onChange = vi.fn();
            render(
                <AbilityCard
                    ability={{
                        ...damageTakenShieldAbility,
                        config: {
                            type: 'shield',
                            pct: 30,
                            basis: 'damage-taken',
                            requiresHpDamage: true,
                        },
                    }}
                    slot="passive"
                    onChange={onChange}
                    onRemove={vi.fn()}
                />
            );
            fireEvent.click(screen.getByLabelText('Only when damage punches through shield'));
            expect(onChange).toHaveBeenCalledWith(
                expect.objectContaining({
                    config: expect.objectContaining({ requiresHpDamage: undefined }),
                })
            );
        });

        it('basis hp renders neither leech-scope select nor punch-through checkbox', () => {
            render(<AbilityCard ability={healAbility} onChange={vi.fn()} onRemove={vi.fn()} />);
            expect(screen.queryByLabelText('Leech scope')).not.toBeInTheDocument();
            expect(
                screen.queryByLabelText('Only when damage punches through shield')
            ).not.toBeInTheDocument();
        });
    });

    it('reconstructs picker value from config.buffName and shows selected buff', () => {
        const buffAbilityWithName: Ability = {
            ...buffAbility,
            config: {
                ...buffAbility.config,
                type: 'buff',
                buffName: 'test-buff',
                parsedEffects: { attack: 10 },
                stacks: 1,
                isStackable: false,
            },
        };

        render(<AbilityCard ability={buffAbilityWithName} onChange={vi.fn()} onRemove={vi.fn()} />);

        // When a buff ability has config.buffName set, the GameBuffPicker
        // reconstructs its value and displays the selected buff.
        // Verify: the selected buff name appears in the rendered output
        // (GameBuffPicker displays selected buffs with their name and effects)
        expect(screen.getByText(/test-buff/i)).toBeInTheDocument();
        expect(screen.getByText(/\+10% Atk/i)).toBeInTheDocument();
    });
});
