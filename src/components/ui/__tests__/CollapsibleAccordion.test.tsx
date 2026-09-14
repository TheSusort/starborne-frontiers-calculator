import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { CollapsibleAccordion } from '../CollapsibleAccordion';

describe('CollapsibleAccordion', () => {
    it('takes its children out of the tab order while closed', () => {
        // The body stays mounted so the height transition has something to animate. Without
        // `inert` every control inside a closed accordion is still a focus stop.
        const { container } = render(
            <CollapsibleAccordion isOpen={false} id="body">
                <button>Inside</button>
            </CollapsibleAccordion>
        );
        expect(container.querySelector('#body')).toHaveAttribute('inert');
    });

    it('puts them back when open', () => {
        const { container } = render(
            <CollapsibleAccordion isOpen id="body">
                <button>Inside</button>
            </CollapsibleAccordion>
        );
        expect(container.querySelector('#body')).not.toHaveAttribute('inert');
    });
});
