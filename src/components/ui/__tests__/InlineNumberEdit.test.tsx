import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InlineNumberEdit } from '../InlineNumberEdit';

describe('InlineNumberEdit', () => {
    const renderWith = (props: Partial<React.ComponentProps<typeof InlineNumberEdit>> = {}) => {
        const onSave = vi.fn();
        render(
            <InlineNumberEdit value={100} onSave={onSave} {...props}>
                100
            </InlineNumberEdit>
        );
        return { onSave };
    };

    it('renders children in display mode by default', () => {
        renderWith();
        expect(screen.getByText('100')).toBeInTheDocument();
        expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    });

    it('switches to input on click and pre-fills with value', () => {
        renderWith();
        fireEvent.click(screen.getByText('100'));
        const input = screen.getByRole('spinbutton');
        expect((input as HTMLInputElement).value).toBe('100');
    });

    it('saves on Enter with parsed numeric value', () => {
        const { onSave } = renderWith();
        fireEvent.click(screen.getByText('100'));
        const input = screen.getByRole('spinbutton');
        fireEvent.change(input, { target: { value: '250' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onSave).toHaveBeenCalledWith(250);
    });

    it('saves on blur', () => {
        const { onSave } = renderWith();
        fireEvent.click(screen.getByText('100'));
        const input = screen.getByRole('spinbutton');
        fireEvent.change(input, { target: { value: '42' } });
        fireEvent.blur(input);
        expect(onSave).toHaveBeenCalledWith(42);
    });

    it('reverts on Escape without calling onSave', () => {
        const { onSave } = renderWith();
        fireEvent.click(screen.getByText('100'));
        const input = screen.getByRole('spinbutton');
        fireEvent.change(input, { target: { value: '999' } });
        fireEvent.keyDown(input, { key: 'Escape' });
        expect(onSave).not.toHaveBeenCalled();
        expect(screen.getByText('100')).toBeInTheDocument();
    });

    it('saves undefined when empty and allowEmpty=true', () => {
        const { onSave } = renderWith({ allowEmpty: true });
        fireEvent.click(screen.getByText('100'));
        const input = screen.getByRole('spinbutton');
        fireEvent.change(input, { target: { value: '' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onSave).toHaveBeenCalledWith(undefined);
    });

    it('reverts when empty and allowEmpty is not set', () => {
        const { onSave } = renderWith();
        fireEvent.click(screen.getByText('100'));
        const input = screen.getByRole('spinbutton');
        fireEvent.change(input, { target: { value: '' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onSave).not.toHaveBeenCalled();
    });

    it('reverts when input is non-numeric', () => {
        const { onSave } = renderWith();
        fireEvent.click(screen.getByText('100'));
        const input = screen.getByRole('spinbutton');
        fireEvent.change(input, { target: { value: 'abc' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onSave).not.toHaveBeenCalled();
    });

    it('reverts when value is below min', () => {
        const { onSave } = renderWith({ min: 0 });
        fireEvent.click(screen.getByText('100'));
        const input = screen.getByRole('spinbutton');
        fireEvent.change(input, { target: { value: '-5' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onSave).not.toHaveBeenCalled();
    });

    it('reverts when value is above max', () => {
        const { onSave } = renderWith({ max: 6 });
        fireEvent.click(screen.getByText('100'));
        const input = screen.getByRole('spinbutton');
        fireEvent.change(input, { target: { value: '7' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onSave).not.toHaveBeenCalled();
    });

    it('does not switch to input when disabled', () => {
        renderWith({ disabled: true });
        fireEvent.click(screen.getByText('100'));
        expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    });

    it('calls onSave exactly once on Enter (no double-commit on blur cascade)', () => {
        const { onSave } = renderWith();
        fireEvent.click(screen.getByText('100'));
        const input = screen.getByRole('spinbutton');
        fireEvent.change(input, { target: { value: '250' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        fireEvent.blur(input);
        expect(onSave).toHaveBeenCalledTimes(1);
        expect(onSave).toHaveBeenCalledWith(250);
    });
    describe('keyboard reachability', () => {
        it('exposes the display trigger as a button named by label', () => {
            renderWith({ label: 'Edit minimum Attack' });
            expect(screen.getByRole('button', { name: 'Edit minimum Attack' })).toBeInTheDocument();
        });

        it('falls back to the rendered children for its accessible name', () => {
            renderWith();
            expect(screen.getByRole('button', { name: '100' })).toBeInTheDocument();
        });

        it('is in the tab order and opens on Enter', () => {
            renderWith({ label: 'Edit limit' });
            const trigger = screen.getByRole('button', { name: 'Edit limit' });
            expect(trigger).toHaveAttribute('tabindex', '0');
            trigger.focus();
            fireEvent.keyDown(trigger, { key: 'Enter' });
            expect(screen.getByRole('spinbutton')).toBeInTheDocument();
        });

        it('opens on Space', () => {
            renderWith({ label: 'Edit limit' });
            fireEvent.keyDown(screen.getByRole('button', { name: 'Edit limit' }), { key: ' ' });
            expect(screen.getByRole('spinbutton')).toBeInTheDocument();
        });

        it('is out of the tab order and inert when disabled', () => {
            renderWith({ label: 'Edit limit', disabled: true });
            const trigger = screen.getByRole('button', { name: 'Edit limit' });
            expect(trigger).toHaveAttribute('tabindex', '-1');
            expect(trigger).toHaveAttribute('aria-disabled', 'true');
            fireEvent.keyDown(trigger, { key: 'Enter' });
            expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
        });

        it('returns focus to the trigger after Escape', () => {
            renderWith({ label: 'Edit limit' });
            const trigger = screen.getByRole('button', { name: 'Edit limit' });
            fireEvent.keyDown(trigger, { key: 'Enter' });
            fireEvent.keyDown(screen.getByRole('spinbutton'), { key: 'Escape' });
            expect(screen.getByRole('button', { name: 'Edit limit' })).toHaveFocus();
        });

        it('returns focus to the trigger after committing with Enter', () => {
            const { onSave } = renderWith({ label: 'Edit limit' });
            const trigger = screen.getByRole('button', { name: 'Edit limit' });
            fireEvent.keyDown(trigger, { key: 'Enter' });
            const input = screen.getByRole('spinbutton');
            fireEvent.change(input, { target: { value: '250' } });
            fireEvent.keyDown(input, { key: 'Enter' });
            expect(onSave).toHaveBeenCalledWith(250);
            expect(screen.getByRole('button', { name: 'Edit limit' })).toHaveFocus();
        });

        it('names the editor from label', () => {
            renderWith({ label: 'Edit limit' });
            fireEvent.click(screen.getByRole('button', { name: 'Edit limit' }));
            expect(screen.getByRole('spinbutton', { name: 'Edit limit' })).toBeInTheDocument();
        });

        it('gives the editor a generic name when label is omitted', () => {
            // The trigger can fall back to its children for a name; the input has no text
            // content, so without a fallback it would be an unnamed spinbutton.
            renderWith();
            fireEvent.click(screen.getByRole('button', { name: '100' }));
            expect(screen.getByRole('spinbutton', { name: 'Edit value' })).toBeInTheDocument();
        });

        it('does not steal focus back when the editor is left by blur', () => {
            renderWith({ label: 'Edit limit' });
            fireEvent.click(screen.getByRole('button', { name: 'Edit limit' }));
            fireEvent.blur(screen.getByRole('spinbutton'));
            expect(screen.getByRole('button', { name: 'Edit limit' })).not.toHaveFocus();
        });
    });
});
