import { defineConfig } from 'vitest/config'

/**
 * Default to the Node environment (matches the rest of the monorepo + the SDK's server-
 * render reality: components are exercised via `react-dom/server` which needs no DOM).
 * The Web Component test opts into jsdom per-file with a `// @vitest-environment jsdom`
 * directive at the top of that file.
 */
export default defineConfig({
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
	},
})
