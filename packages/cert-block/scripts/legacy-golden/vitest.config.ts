import { defineConfig } from 'vitest/config'

// Used only by dump-envelope-111.oracle.ts (the package's own vitest config includes src/**/*.test.* and nothing else).
export default defineConfig({
	server: { fs: { strict: false } },
	test: { include: ['scripts/legacy-golden/*.oracle.ts'], environment: 'node' },
})
