import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Image } from '../Image';

describe('Image fallback', () => {
    it('keeps the default placeholder when no fallback is given', () => {
        render(<Image src="" />);
        expect(screen.getByText('No image available')).toBeTruthy();
    });

    it('renders a null fallback as nothing', () => {
        const { container } = render(<Image src="" fallback={null} />);
        expect(container.innerHTML).toBe('');
    });

    it('renders a custom fallback node', () => {
        render(<Image src="" fallback={<b>custom</b>} />);
        expect(screen.getByText('custom')).toBeTruthy();
        expect(screen.queryByText('No image available')).toBeNull();
    });
});
