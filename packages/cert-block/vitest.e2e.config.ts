import { defineConfig } from 'vitest/config'

/**
 * 2.0.0: the replica harness (`e2e/`), run on its own (`pnpm test:replica`): it starts a page server and drives
 * Chromium through Playwright, so it needs a Playwright Chromium (PLAYWRIGHT_BROWSERS_PATH) and is not part of `test`.
 * One file at a time, in order: the cells share one browser and one page server.
 */
/**
 * `CERT_BLOCK_E2E_REACT`: a `node_modules` holding another React (e.g. 19) to run the replica on, server and browser, in
 * place of the package's own dev React 18. Unset: React 18.
 */
const reactDir = process.env.CERT_BLOCK_E2E_REACT

export default defineConfig({
	resolve: {
		alias: reactDir
			? [
					{ find: /^react-dom(\/.*)?$/, replacement: `${reactDir}/react-dom$1` },
					{ find: /^react(\/.*)?$/, replacement: `${reactDir}/react$1` },
				]
			: [],
	},
	test: {
		environment: 'node',
		include: ['e2e/**/*.e2e.test.tsx'],
		fileParallelism: false,
		sequence: { concurrent: false },
		testTimeout: 120_000,
		hookTimeout: 120_000,
	},
})
