import { render, RenderOptions } from '@testing-library/react';
import { TestProviders } from './TestProviders';

const customRender = (ui: React.ReactElement, options?: Omit<RenderOptions, 'wrapper'>) =>
  render(ui, { wrapper: TestProviders, ...options });

// re-export everything
export * from '@testing-library/react';
export { act } from 'react';
export { customRender as render };
