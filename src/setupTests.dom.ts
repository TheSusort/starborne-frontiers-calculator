// DOM-only test setup, loaded by `setupTests.ts` when the file runs under jsdom.
// jest-dom adds custom matchers for asserting on DOM nodes, e.g.
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';
import { expect, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

// Extend Vitest's expect method with testing-library methods
expect.extend(matchers);

// Unmount anything rendered by the test
afterEach(() => {
    cleanup();
});
