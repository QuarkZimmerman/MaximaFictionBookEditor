// Runs before every unit test file (see vitest.config.ts `setupFiles`).
// Adds the jest-dom matchers (toBeInTheDocument, toHaveTextContent, ...) to Vitest's `expect`.
// React Testing Library unmounts rendered trees automatically via the global `afterEach`.
import '@testing-library/jest-dom/vitest';
