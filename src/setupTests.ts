// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';
import { expect, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

// Create proper types for the matchers
type Matchers = typeof matchers & {
  toBeInTheDocument(): void;
  toHaveTextContent(text: string | RegExp): void;
  // Add other matcher types as needed
};

// Extend Vitest's expect method with testing-library methods
expect.extend(matchers as unknown as Matchers);

// Cleanup after each test case
afterEach(() => {
  cleanup();
});

// Proper TextEncoder/Decoder interface definitions
interface TextEncoderInterface {
  encode(input?: string): Uint8Array;
  encodeInto(input: string, dest: Uint8Array): { read: number; written: number };
}

interface TextDecoderInterface {
  decode(input?: Uint8Array | ArrayBuffer): string;
}

// Mock TextEncoder/TextDecoder with proper types
if (typeof TextEncoder === 'undefined') {
  global.TextEncoder = class implements TextEncoderInterface {
    encoding = 'utf-8';
    encode(text: string = ''): Uint8Array {
      const arr = new Uint8Array(text.length);
      for (let i = 0; i < text.length; i++) {
        arr[i] = text.charCodeAt(i);
      }
      return arr;
    }
    encodeInto(text: string, dest: Uint8Array) {
      const written = Math.min(text.length, dest.length);
      for (let i = 0; i < written; i++) {
        dest[i] = text.charCodeAt(i);
      }
      return { read: written, written };
    }
  };
}

if (typeof TextDecoder === 'undefined') {
  global.TextDecoder = class implements TextDecoderInterface {
    encoding = 'utf-8';
    fatal = false;
    ignoreBOM = false;

    decode(arr?: Uint8Array | ArrayBuffer): string {
      if (!arr) return '';
      const uint8Array = arr instanceof Uint8Array ? arr : new Uint8Array(arr);
      return String.fromCharCode.apply(null, Array.from(uint8Array));
    }
  };
}
