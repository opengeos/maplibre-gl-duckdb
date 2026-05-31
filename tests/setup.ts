import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

if (!window.URL.createObjectURL) {
  window.URL.createObjectURL = () => 'blob:mock';
}

if (!window.URL.revokeObjectURL) {
  window.URL.revokeObjectURL = () => {};
}

// Cleanup after each test (for React component tests)
afterEach(() => {
  cleanup();
});
