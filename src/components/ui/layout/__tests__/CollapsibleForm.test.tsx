import { render, screen } from '../../../../test-utils/test-utils';
import { CollapsibleForm } from '../CollapsibleForm';

describe('CollapsibleForm Component', () => {
  test('renders children when visible', () => {
    render(
      <CollapsibleForm isVisible={true}>
        <div>Form content</div>
      </CollapsibleForm>
    );

    expect(screen.getByText('Form content')).toBeInTheDocument();
    expect(screen.getByText('Form content').parentElement).toHaveClass('opacity-100');
  });

  test('hides children when not visible', () => {
    render(
      <CollapsibleForm isVisible={false}>
        <div>Form content</div>
      </CollapsibleForm>
    );

    const container = screen.getByText('Form content').parentElement;
    expect(container).toHaveClass('opacity-0', 'max-h-0', 'overflow-hidden', '!m-0');
  });

  test('applies transition classes', () => {
    render(
      <CollapsibleForm isVisible={true}>
        <div>Form content</div>
      </CollapsibleForm>
    );

    const container = screen.getByText('Form content').parentElement;
    expect(container).toHaveClass('transition-all', 'duration-300', 'ease-in-out');
  });

  test('applies correct max height when visible', () => {
    render(
      <CollapsibleForm isVisible={true}>
        <div>Form content</div>
      </CollapsibleForm>
    );

    const container = screen.getByText('Form content').parentElement;
    expect(container).toHaveClass('max-h-[3300px]');
  });

  test('renders nested components correctly', () => {
    render(
      <CollapsibleForm isVisible={true}>
        <div>Parent</div>
        <div>
          <span>Child 1</span>
          <span>Child 2</span>
        </div>
      </CollapsibleForm>
    );

    expect(screen.getByText('Parent')).toBeInTheDocument();
    expect(screen.getByText('Child 1')).toBeInTheDocument();
    expect(screen.getByText('Child 2')).toBeInTheDocument();
  });
});
