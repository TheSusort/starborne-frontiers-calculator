import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { AbilityCard } from '../AbilityCard';
import { VICTIMLESS_INFLICTION_WARNING } from '../simCoverage';
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

        it('does NOT show a not-simulated note for a modeled control effect (provoke)', () => {
            // provoke is in SIMULATED_CONTROL_EFFECTS — the badge must be absent.
            render(<AbilityCard ability={control} onChange={() => {}} onRemove={() => {}} />);
            expect(
                screen.queryByText(/not simulated in the calculators yet/i)
            ).not.toBeInTheDocument();
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

    /**
     * SP-4c-2d. `SkillEditorModal` is live-edit — every keystroke calls onChange and there is no
     * save button — so an ability the engine drops can already be sitting in storage. This warning
     * is the only surface that reaches those, and it is WARN-ONLY by ruling: no offerable target
     * makes a victimless dot/debuff work, so removing options would leave the user nowhere to go.
     */
    describe('victimless-infliction warning', () => {
        const at = (over: Partial<Ability>): Ability => ({
            id: 'v1',
            type: 'dot',
            target: 'enemy',
            trigger: 'start-of-round',
            conditions: [],
            config: { type: 'dot', dotType: 'corrosion', tier: 5, stacks: 1, duration: 2 },
            ...over,
        });

        it('flags an ALREADY-SAVED dot that the engine drops', () => {
            // "At the start of the round, inflict Corrosion on an enemy" — authorable today,
            // and it reports stacks in the combat log while dealing nothing.
            render(<AbilityCard ability={at({})} onChange={() => {}} onRemove={() => {}} />);
            expect(screen.getByText(VICTIMLESS_INFLICTION_WARNING)).toBeInTheDocument();
        });

        it("does NOT flag Selenite's real passive (debuff on the highest-attack enemy)", () => {
            // The carve-out, on a SHIPPED ship: `debuff` + `start-of-round` +
            // `enemy-highest-attack` resolves its own target and lands. A warning here would be a
            // false alarm on a real kit — this case is the fence against the predicate being
            // "simplified" back into flagging it.
            render(
                <AbilityCard
                    ability={at({
                        type: 'debuff',
                        target: 'enemy-highest-attack',
                        config: {
                            type: 'debuff',
                            buffName: 'Concentrate Fire',
                            parsedEffects: {},
                            stacks: 1,
                            isStackable: false,
                            application: 'apply',
                            duration: 2,
                        },
                    })}
                    onChange={() => {}}
                    onRemove={() => {}}
                />
            );
            expect(screen.queryByText(VICTIMLESS_INFLICTION_WARNING)).not.toBeInTheDocument();
        });

        it('does NOT flag a damage ability on the same trigger', () => {
            render(
                <AbilityCard
                    ability={{ ...damageAbility, trigger: 'start-of-round' }}
                    onChange={() => {}}
                    onRemove={() => {}}
                />
            );
            expect(screen.queryByText(VICTIMLESS_INFLICTION_WARNING)).not.toBeInTheDocument();
        });

        it('does NOT flag a dot on on-deal-damage, which names the enemy that was hit', () => {
            render(
                <AbilityCard
                    ability={at({ trigger: 'on-deal-damage' })}
                    onChange={() => {}}
                    onRemove={() => {}}
                />
            );
            expect(screen.queryByText(VICTIMLESS_INFLICTION_WARNING)).not.toBeInTheDocument();
        });

        it('WARNS WITHOUT BLOCKING — every Target option stays selectable', () => {
            // Pins the ruling: the flagged ability still offers the full target list, including the
            // bare Enemy it is flagged for. A future change that started removing options would
            // break this rather than pass quietly. (`Select` is the project's custom control, not a
            // native <select> — the options only exist once the dropdown is opened, in a portal.)
            render(<AbilityCard ability={at({})} onChange={() => {}} onRemove={() => {}} />);
            fireEvent.click(screen.getByLabelText('Target'));
            const labels = within(screen.getByRole('listbox'))
                .getAllByRole('option')
                .map((o) => o.textContent);
            expect(labels).toContain('Enemy');
            expect(labels).toContain('All enemies');
            expect(labels).toContain('Adjacent enemies');
        });
    });

    describe('Target select for charge abilities (#399 Change 1a)', () => {
        const chargeAt = (target: Ability['target']): Ability => ({
            id: 'a-charge',
            type: 'charge',
            target,
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'charge', amount: 1 },
        });

        it('offers only self, all-allies and enemy for a fresh charge ability', () => {
            render(
                <AbilityCard ability={chargeAt('self')} onChange={vi.fn()} onRemove={vi.fn()} />
            );
            fireEvent.click(screen.getByLabelText('Target'));
            const labels = within(screen.getByRole('listbox'))
                .getAllByRole('option')
                .map((o) => o.textContent);
            expect(labels).toEqual(['Self', 'All allies', 'Enemy']);
        });

        it('keeps an already-saved legacy target visible, labelled, and selectable', () => {
            // A charge ability saved before Change 1a (or hand-imported) may still carry a target
            // the editor no longer offers for NEW charge abilities. It must stay visible — never a
            // blank "Select" fallback — and stay editable.
            render(
                <AbilityCard
                    ability={chargeAt('adjacent-enemies')}
                    onChange={vi.fn()}
                    onRemove={vi.fn()}
                />
            );
            // The selected label text is visible in the (closed) Target button.
            expect(screen.getByText(/Adjacent enemies \(legacy/)).toBeInTheDocument();
            fireEvent.click(screen.getByLabelText('Target'));
            const labels = within(screen.getByRole('listbox'))
                .getAllByRole('option')
                .map((o) => o.textContent);
            expect(labels).toEqual([
                'Self',
                'All allies',
                'Enemy',
                'Adjacent enemies (legacy — not offered for new Charge abilities)',
            ]);
        });

        it('selecting a supported target drops the legacy option from the list', () => {
            const onChange = vi.fn();
            render(
                <AbilityCard
                    ability={chargeAt('adjacent-enemies')}
                    onChange={onChange}
                    onRemove={vi.fn()}
                />
            );
            fireEvent.click(screen.getByLabelText('Target'));
            fireEvent.click(screen.getByText('Enemy'));
            expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ target: 'enemy' }));
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

        it('renders a Trigger select for damage abilities (reactive damage procs need it)', () => {
            // Phase 4c PR 4: Grif's on-enemy-cleansed "75% Damage" proc is a reactive damage
            // ability — its trigger must be editable. A plain on-cast damage now shows the
            // Trigger dropdown too (defaulting to on-cast), consistent with every other type.
            const reactiveDamage: Ability = {
                ...damageAbility,
                trigger: 'on-enemy-cleansed',
            };
            render(<AbilityCard ability={reactiveDamage} onChange={vi.fn()} onRemove={vi.fn()} />);
            expect(screen.getByLabelText('Trigger')).toBeInTheDocument();
            // The selected reactive trigger label is shown.
            expect(screen.getByText('When an enemy cleanses a debuff')).toBeInTheDocument();
        });

        it('renders a Trigger select for a plain on-cast damage ability too', () => {
            render(<AbilityCard ability={damageAbility} onChange={vi.fn()} onRemove={vi.fn()} />);
            expect(screen.getByLabelText('Trigger')).toBeInTheDocument();
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

        it('shows no note for on-ally-destroyed (now a live trigger since Phase 4b)', () => {
            render(
                <AbilityCard
                    ability={buffWithTrigger('on-ally-destroyed')}
                    onChange={vi.fn()}
                    onRemove={vi.fn()}
                />
            );
            expect(
                screen.queryByText(/not simulated — treated as assume-active/i)
            ).not.toBeInTheDocument();
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

        it('strips triggerCritFilter when trigger is changed away from on-attacked', () => {
            const abilityWithCritFilter: Ability = {
                ...buffAbility,
                trigger: 'on-attacked',
                triggerCritFilter: 'crit',
            };
            const onChange = vi.fn();
            render(
                <AbilityCard
                    ability={abilityWithCritFilter}
                    onChange={onChange}
                    onRemove={vi.fn()}
                />
            );
            // Open the Trigger dropdown and switch to "on-crit"
            fireEvent.click(screen.getByLabelText('Trigger'));
            fireEvent.click(screen.getByText('On critical hit'));
            expect(onChange).toHaveBeenCalledOnce();
            const updated = onChange.mock.calls[0][0] as Ability;
            expect(updated.trigger).toBe('on-crit');
            expect(Object.prototype.hasOwnProperty.call(updated, 'triggerCritFilter')).toBe(false);
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

        it('purge ability renders Count field and does NOT show not-simulated note', () => {
            // C2a: purge is now simulated (on-cast purge removes enemy buffs), so it was removed
            // from NOT_SIMULATED_TYPES — the not-simulated note must no longer render.
            render(<AbilityCard ability={purgeAbility} onChange={vi.fn()} onRemove={vi.fn()} />);
            expect(screen.getByLabelText('Count')).toBeInTheDocument();
            expect(
                screen.queryByText(/not simulated in the calculators yet/i)
            ).not.toBeInTheDocument();
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

    describe('Hit filter select (on-attacked trigger)', () => {
        const shieldOnAttacked: Ability = {
            id: 'a7',
            type: 'shield',
            target: 'self',
            trigger: 'on-attacked',
            conditions: [],
            config: { type: 'shield', pct: 20, basis: 'hp' },
        };

        const buffOnAttacked: Ability = {
            id: 'a8',
            type: 'buff',
            target: 'self',
            trigger: 'on-attacked',
            conditions: [],
            config: {
                type: 'buff',
                buffName: '',
                parsedEffects: {},
                stacks: 1,
                isStackable: false,
            },
        };

        it('renders a Hit filter select when trigger is on-attacked', () => {
            render(
                <AbilityCard ability={shieldOnAttacked} onChange={vi.fn()} onRemove={vi.fn()} />
            );
            expect(screen.getByLabelText('Hit filter')).toBeInTheDocument();
        });

        it('shows the three hit filter options', () => {
            render(
                <AbilityCard ability={shieldOnAttacked} onChange={vi.fn()} onRemove={vi.fn()} />
            );
            fireEvent.click(screen.getByLabelText('Hit filter'));
            expect(screen.getAllByText('Any hit').length).toBeGreaterThan(0);
            expect(screen.getByText('Only critical hits')).toBeInTheDocument();
            expect(screen.getByText('Only non-critical hits')).toBeInTheDocument();
        });

        it('defaults to "Any hit" when triggerCritFilter is absent', () => {
            render(
                <AbilityCard ability={shieldOnAttacked} onChange={vi.fn()} onRemove={vi.fn()} />
            );
            // The trigger button text shows the selected option
            expect(screen.getByText('Any hit')).toBeInTheDocument();
        });

        it('shows "Only critical hits" when triggerCritFilter is crit', () => {
            const ability: Ability = { ...shieldOnAttacked, triggerCritFilter: 'crit' };
            render(<AbilityCard ability={ability} onChange={vi.fn()} onRemove={vi.fn()} />);
            expect(screen.getByText('Only critical hits')).toBeInTheDocument();
        });

        it('shows "Only non-critical hits" when triggerCritFilter is non-crit', () => {
            const ability: Ability = { ...shieldOnAttacked, triggerCritFilter: 'non-crit' };
            render(<AbilityCard ability={ability} onChange={vi.fn()} onRemove={vi.fn()} />);
            expect(screen.getByText('Only non-critical hits')).toBeInTheDocument();
        });

        it('selecting "Only critical hits" calls onChange with triggerCritFilter: crit', () => {
            const onChange = vi.fn();
            render(<AbilityCard ability={buffOnAttacked} onChange={onChange} onRemove={vi.fn()} />);
            fireEvent.click(screen.getByLabelText('Hit filter'));
            fireEvent.click(screen.getByText('Only critical hits'));
            expect(onChange).toHaveBeenCalledWith(
                expect.objectContaining({ triggerCritFilter: 'crit' })
            );
        });

        it('selecting "Only non-critical hits" calls onChange with triggerCritFilter: non-crit', () => {
            const onChange = vi.fn();
            render(<AbilityCard ability={buffOnAttacked} onChange={onChange} onRemove={vi.fn()} />);
            fireEvent.click(screen.getByLabelText('Hit filter'));
            fireEvent.click(screen.getByText('Only non-critical hits'));
            expect(onChange).toHaveBeenCalledWith(
                expect.objectContaining({ triggerCritFilter: 'non-crit' })
            );
        });

        it('selecting "Any hit" calls onChange WITHOUT triggerCritFilter key (undefined/absent)', () => {
            const onChange = vi.fn();
            const ability: Ability = { ...shieldOnAttacked, triggerCritFilter: 'crit' };
            render(<AbilityCard ability={ability} onChange={onChange} onRemove={vi.fn()} />);
            fireEvent.click(screen.getByLabelText('Hit filter'));
            fireEvent.click(screen.getByText('Any hit'));
            const called = onChange.mock.calls[0][0] as Ability;
            expect(called.triggerCritFilter).toBeUndefined();
            expect(Object.prototype.hasOwnProperty.call(called, 'triggerCritFilter')).toBe(false);
        });

        it('does NOT render the Hit filter select when trigger is on-cast', () => {
            render(<AbilityCard ability={buffAbility} onChange={vi.fn()} onRemove={vi.fn()} />);
            expect(screen.queryByLabelText('Hit filter')).not.toBeInTheDocument();
        });

        it('does NOT render the Hit filter select when trigger is on-crit', () => {
            const ability: Ability = { ...buffAbility, trigger: 'on-crit' };
            render(<AbilityCard ability={ability} onChange={vi.fn()} onRemove={vi.fn()} />);
            expect(screen.queryByLabelText('Hit filter')).not.toBeInTheDocument();
        });

        it('renders the Hit filter select for on-ally-attacked too (engine honors triggerCritFilter per-hit there)', () => {
            const ability: Ability = { ...buffOnAttacked, trigger: 'on-ally-attacked' };
            render(<AbilityCard ability={ability} onChange={vi.fn()} onRemove={vi.fn()} />);
            expect(screen.getByLabelText('Hit filter')).toBeInTheDocument();
        });
    });

    describe('Ally role filter (on-ally-attacked trigger)', () => {
        const buffOnAllyAttacked: Ability = {
            id: 'a9',
            type: 'buff',
            target: 'ally',
            trigger: 'on-ally-attacked',
            conditions: [],
            config: {
                type: 'buff',
                buffName: '',
                parsedEffects: {},
                stacks: 1,
                isStackable: false,
            },
        };

        it('renders the role filter checkboxes when trigger is on-ally-attacked', () => {
            render(
                <AbilityCard ability={buffOnAllyAttacked} onChange={vi.fn()} onRemove={vi.fn()} />
            );
            expect(screen.getByText('Ally role filter')).toBeInTheDocument();
            expect(screen.getByLabelText('Attacker')).toBeInTheDocument();
            expect(screen.getByLabelText('Defender')).toBeInTheDocument();
            expect(screen.getByLabelText('Debuffer')).toBeInTheDocument();
            expect(screen.getByLabelText('Supporter')).toBeInTheDocument();
        });

        it('does NOT render the role filter when trigger is on-attacked', () => {
            const ability: Ability = { ...buffOnAllyAttacked, trigger: 'on-attacked' };
            render(<AbilityCard ability={ability} onChange={vi.fn()} onRemove={vi.fn()} />);
            expect(screen.queryByText('Ally role filter')).not.toBeInTheDocument();
        });

        it('does NOT render the role filter when trigger is on-cast', () => {
            render(<AbilityCard ability={buffAbility} onChange={vi.fn()} onRemove={vi.fn()} />);
            expect(screen.queryByText('Ally role filter')).not.toBeInTheDocument();
        });

        it('reflects the stored roleFilter as checked boxes', () => {
            const ability: Ability = {
                ...buffOnAllyAttacked,
                roleFilter: ['ATTACKER', 'DEBUFFER'],
            };
            render(<AbilityCard ability={ability} onChange={vi.fn()} onRemove={vi.fn()} />);
            expect(screen.getByLabelText('Attacker')).toBeChecked();
            expect(screen.getByLabelText('Debuffer')).toBeChecked();
            expect(screen.getByLabelText('Defender')).not.toBeChecked();
            expect(screen.getByLabelText('Supporter')).not.toBeChecked();
        });

        it('checking a role calls onChange with that role added to roleFilter', () => {
            const onChange = vi.fn();
            render(
                <AbilityCard ability={buffOnAllyAttacked} onChange={onChange} onRemove={vi.fn()} />
            );
            fireEvent.click(screen.getByLabelText('Attacker'));
            expect(onChange).toHaveBeenCalledWith(
                expect.objectContaining({ roleFilter: ['ATTACKER'] })
            );
        });

        it('unchecking the only selected role calls onChange WITHOUT a roleFilter key (absent, not [])', () => {
            const onChange = vi.fn();
            const ability: Ability = { ...buffOnAllyAttacked, roleFilter: ['DEFENDER'] };
            render(<AbilityCard ability={ability} onChange={onChange} onRemove={vi.fn()} />);
            fireEvent.click(screen.getByLabelText('Defender'));
            const updated = onChange.mock.calls[0][0] as Ability;
            expect(updated.roleFilter).toBeUndefined();
            expect(Object.prototype.hasOwnProperty.call(updated, 'roleFilter')).toBe(false);
        });

        it('strips roleFilter when trigger is changed away from on-ally-attacked', () => {
            const onChange = vi.fn();
            const ability: Ability = { ...buffOnAllyAttacked, roleFilter: ['SUPPORTER'] };
            render(<AbilityCard ability={ability} onChange={onChange} onRemove={vi.fn()} />);
            fireEvent.click(screen.getByLabelText('Trigger'));
            fireEvent.click(screen.getByText('On critical hit'));
            const updated = onChange.mock.calls[0][0] as Ability;
            expect(updated.trigger).toBe('on-crit');
            expect(Object.prototype.hasOwnProperty.call(updated, 'roleFilter')).toBe(false);
        });

        it('keeps triggerCritFilter but strips roleFilter when switching to on-attacked', () => {
            const onChange = vi.fn();
            const ability: Ability = {
                ...buffOnAllyAttacked,
                triggerCritFilter: 'crit',
                roleFilter: ['ATTACKER'],
            };
            render(<AbilityCard ability={ability} onChange={onChange} onRemove={vi.fn()} />);
            fireEvent.click(screen.getByLabelText('Trigger'));
            fireEvent.click(screen.getByText('When attacked'));
            const updated = onChange.mock.calls[0][0] as Ability;
            expect(updated.trigger).toBe('on-attacked');
            expect(updated.triggerCritFilter).toBe('crit');
            expect(Object.prototype.hasOwnProperty.call(updated, 'roleFilter')).toBe(false);
        });

        it('clicking Attacker in the SECOND card fires only the second card onChange (no duplicate-id collision)', () => {
            const onChange1 = vi.fn();
            const onChange2 = vi.fn();
            const card1: Ability = { ...buffOnAllyAttacked, id: 'card1' };
            const card2: Ability = { ...buffOnAllyAttacked, id: 'card2' };

            const { container } = render(
                <div>
                    <div data-testid="card1">
                        <AbilityCard ability={card1} onChange={onChange1} onRemove={vi.fn()} />
                    </div>
                    <div data-testid="card2">
                        <AbilityCard ability={card2} onChange={onChange2} onRemove={vi.fn()} />
                    </div>
                </div>
            );

            // Click the "Attacker" label that lives inside the second card only.
            const card2El = container.querySelector('[data-testid="card2"]') as HTMLElement;
            // getAllByLabelText across the whole document would return 2 inputs with the same id.
            // Scoping to card2 proves the label targets the right input.
            const attackerInCard2 = within(card2El).getByLabelText('Attacker');
            fireEvent.click(attackerInCard2);

            // Only the second card's onChange should fire.
            expect(onChange2).toHaveBeenCalledOnce();
            expect(onChange1).not.toHaveBeenCalled();
        });
    });

    describe('Recipient faction filter (#363)', () => {
        const buffAllAllies: Ability = {
            id: 'a10',
            type: 'buff',
            target: 'all-allies',
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

        it('renders the control for an ally-plural target', () => {
            render(<AbilityCard ability={buffAllAllies} onChange={vi.fn()} onRemove={vi.fn()} />);
            expect(screen.getByText('Recipient faction filter')).toBeInTheDocument();
            expect(screen.getByLabelText('Tianchen')).toBeInTheDocument();
            expect(screen.getByLabelText('XAOC')).toBeInTheDocument();
        });

        it('does NOT render the control for a charge ability, even with an ally-plural target', () => {
            const chargeAllAllies: Ability = {
                id: 'a11',
                type: 'charge',
                target: 'all-allies',
                trigger: 'on-cast',
                conditions: [],
                config: { type: 'charge', amount: 1 },
            };
            render(<AbilityCard ability={chargeAllAllies} onChange={vi.fn()} onRemove={vi.fn()} />);
            expect(screen.queryByText('Recipient faction filter')).not.toBeInTheDocument();
        });

        it('does NOT render the control for a non-ally target', () => {
            const damageAllEnemies: Ability = { ...damageAbility, target: 'all-enemies' };
            render(
                <AbilityCard ability={damageAllEnemies} onChange={vi.fn()} onRemove={vi.fn()} />
            );
            expect(screen.queryByText('Recipient faction filter')).not.toBeInTheDocument();
        });

        it('unchecking the only selected faction calls onChange WITHOUT a factionFilter key (absent, not [])', () => {
            const onChange = vi.fn();
            const ability: Ability = { ...buffAllAllies, factionFilter: ['TIANCHAO'] };
            render(<AbilityCard ability={ability} onChange={onChange} onRemove={vi.fn()} />);
            fireEvent.click(screen.getByLabelText('Tianchen'));
            const updated = onChange.mock.calls[0][0] as Ability;
            expect(updated.factionFilter).toBeUndefined();
            expect(Object.prototype.hasOwnProperty.call(updated, 'factionFilter')).toBe(false);
        });

        it('checking a faction calls onChange with that faction added to factionFilter', () => {
            const onChange = vi.fn();
            render(<AbilityCard ability={buffAllAllies} onChange={onChange} onRemove={vi.fn()} />);
            fireEvent.click(screen.getByLabelText('Tianchen'));
            expect(onChange).toHaveBeenCalledWith(
                expect.objectContaining({ factionFilter: ['TIANCHAO'] })
            );
        });

        it('strips factionFilter when the target changes to one that cannot carry it', () => {
            const onChange = vi.fn();
            const ability: Ability = { ...buffAllAllies, factionFilter: ['TIANCHAO'] };
            render(<AbilityCard ability={ability} onChange={onChange} onRemove={vi.fn()} />);
            fireEvent.click(screen.getByLabelText('Target'));
            fireEvent.click(screen.getByText('Self'));
            const updated = onChange.mock.calls[0][0] as Ability;
            expect(updated.target).toBe('self');
            expect(Object.prototype.hasOwnProperty.call(updated, 'factionFilter')).toBe(false);
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

/**
 * #407 — the target dropdown is narrowed by ability TYPE.
 *
 * Unfiltered, it let a user author a `buff` aimed at `all-enemies` and SAVE it: a status that lands
 * in the per-victim ENEMY store but inflicts on ONE enemy (the cast anchor), because
 * `playerTurn.ts`'s `matchingAbility` lookup searches debuff-typed configs only. Owner ruling R4
 * closes it at the authoring boundary, so the engine is untouched and this is where it is pinned.
 *
 * The saved-data case matters as much as the filter: a `Select` whose value is absent from its
 * options falls back to a blank placeholder and MISREPRESENTS what is stored. Whatever a user
 * already saved must stay visible and selectable, labelled — the same treatment #399 gave the
 * legacy charge targets, whose tests above are the pattern this describe follows.
 */
describe('AbilityCard target options (#407)', () => {
    /** The Select is a custom portal listbox, not a native <select>: open it, then read the
     *  options out of the listbox. Same access path as the #399 charge-target tests above. */
    const openTargetOptions = (): string[] => {
        fireEvent.click(screen.getByLabelText('Target'));
        return within(screen.getByRole('listbox'))
            .getAllByRole('option')
            .map((o) => o.textContent ?? '');
    };

    it('a buff ability is not offered any enemy target', () => {
        render(<AbilityCard ability={buffAbility} onChange={vi.fn()} onRemove={vi.fn()} />);
        expect(openTargetOptions()).toEqual([
            'Self',
            'Ally',
            'All allies',
            'Lowest HP ally',
            'Adjacent allies',
        ]);
    });

    it('a damage ability is not offered any ally target', () => {
        // Instrument validation for the test above: without this, "the enemy targets are missing"
        // could be explained by the filter hiding everything but the ally side for every type.
        render(<AbilityCard ability={damageAbility} onChange={vi.fn()} onRemove={vi.fn()} />);
        expect(openTargetOptions()).toEqual([
            'Enemy',
            'All enemies',
            'Adjacent enemies',
            'Target + adjacent enemies',
        ]);
    });

    it('a control ability keeps BOTH sides — Taunt is its self arm', () => {
        // `control` is one of the three genuinely both-sided types (measured: 6 corpus Taunts
        // alongside 37 inflicted controls, on Anemone/Iridium/Isha/Madax among others). Narrowing
        // it would break real ships.
        const controlAbility: Ability = {
            id: 'a-control',
            type: 'control',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'control', effect: 'stasis' },
        };
        render(<AbilityCard ability={controlAbility} onChange={vi.fn()} onRemove={vi.fn()} />);
        const labels = openTargetOptions();
        expect(labels).toContain('Self');
        expect(labels).toContain('All enemies');
    });

    it('a SAVED buff-at-enemy target stays visible and labelled, not silently dropped', () => {
        // The exact shape a user could already have persisted before this filter existed. The
        // Select must still show it — otherwise the editor displays a target the ability does not
        // have, and the next save would silently rewrite the user's own data.
        render(
            <AbilityCard
                ability={{ ...buffAbility, target: 'all-enemies' }}
                onChange={vi.fn()}
                onRemove={vi.fn()}
            />
        );
        // Visible in the CLOSED button, i.e. the Select is not falling back to its placeholder.
        expect(screen.getByText(/All enemies \(saved value/)).toBeInTheDocument();
        expect(openTargetOptions()).toEqual([
            'Self',
            'Ally',
            'All allies',
            'Lowest HP ally',
            'Adjacent allies',
            'All enemies (saved value — not valid for a Buff ability)',
        ]);
    });

    it('leaves the stricter #399 charge narrowing alone', () => {
        // `charge` is both-sided, so the side filter would narrow nothing for it — CHARGE_TARGET_OPTIONS
        // must keep winning, with its own legacy wording (asserted by the #399 describe above).
        const chargeAbility: Ability = {
            id: 'a-charge-407',
            type: 'charge',
            target: 'self',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'charge', amount: 1 },
        };
        render(<AbilityCard ability={chargeAbility} onChange={vi.fn()} onRemove={vi.fn()} />);
        expect(openTargetOptions()).toEqual(['Self', 'All allies', 'Enemy']);
    });
});

// The top-up buff-steal names a STATUS, and real status names contain spaces ("Titanite
// Plating"). Trimming inside a CONTROLLED input's onChange rewrites the DOM value on every
// keystroke, so the interior space is stripped the moment it is typed and a multi-word name can
// never be entered at all. Whitespace still has to be normalized — on blur, where it does not
// fight the caret.
describe('AbilityCard — the top-up buff-steal name accepts multi-word statuses', () => {
    const stealAbility: Ability = {
        id: 'a-steal',
        type: 'buff-steal',
        target: 'enemy',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'buff-steal', count: 1, buffName: undefined, upToStacks: undefined },
    };

    /** The editor is CONTROLLED: without feeding the ability back the input value never changes
     *  and the bug is invisible. */
    const Harness = ({ initial }: { initial: Ability }): React.ReactElement => {
        const [ability, setAbility] = React.useState(initial);
        return <AbilityCard ability={ability} onChange={setAbility} onRemove={vi.fn()} />;
    };

    /** Keystroke-by-keystroke, reading the live DOM value back each time — exactly what a user's
     *  keyboard does to a controlled input. A single bulk `change` would hide the defect. */
    const typeInto = (input: HTMLInputElement, text: string): void => {
        for (const ch of text) {
            fireEvent.change(input, { target: { value: input.value + ch } });
        }
    };

    it('keeps the interior space while typing a two-word status name', () => {
        render(<Harness initial={stealAbility} />);
        const input = screen.getByLabelText<HTMLInputElement>('Named buff (top-up)');

        typeInto(input, 'Titanite Plating');

        expect(input.value).toBe('Titanite Plating');
    });

    it('normalizes surrounding whitespace on blur, not on every keystroke', () => {
        render(<Harness initial={stealAbility} />);
        const input = screen.getByLabelText<HTMLInputElement>('Named buff (top-up)');

        fireEvent.change(input, { target: { value: 'Titanite Plating  ' } });
        expect(input.value).toBe('Titanite Plating  ');

        fireEvent.blur(input);
        expect(input.value).toBe('Titanite Plating');
    });

    it('clears the name/threshold pair together when the name is blanked on blur', () => {
        const seeded: Ability = {
            ...stealAbility,
            config: { type: 'buff-steal', count: 1, buffName: 'Protection', upToStacks: 3 },
        };
        const onChange = vi.fn();
        render(<AbilityCard ability={seeded} onChange={onChange} onRemove={vi.fn()} />);
        const input = screen.getByLabelText<HTMLInputElement>('Named buff (top-up)');

        fireEvent.change(input, { target: { value: '   ' } });
        fireEvent.blur(input);

        expect(onChange).toHaveBeenLastCalledWith(
            expect.objectContaining({
                config: expect.objectContaining({
                    type: 'buff-steal',
                    buffName: undefined,
                    upToStacks: undefined,
                }),
            })
        );
    });
});
