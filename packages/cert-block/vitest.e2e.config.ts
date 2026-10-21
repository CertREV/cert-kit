import { defineConfig } from 'vitest/config'

/**
 * 2.0.0: the replica harness (`e2e/`), run on its own (`pnpm test:replica`): it starts a page server and drives
 * Chromium through Playwright, so it needs a Playwright Chromium (PLAYWRIGHT_BROWSERS_PATH) and is not part of `test`.
 * One file at a time, in order: the cells share one browser and one page server.
 */
export default defineConfig({
	test: {
		environment: 'node',
		include: ['e2e/**/*.e2e.test.tsx'],
		fileParallelism: false,
		sequence: { concurrent: false },
		testTimeout: 120_000,
		hookTimeout: 120_000,
	},
})
