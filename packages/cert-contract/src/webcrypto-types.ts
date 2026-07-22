/**
 * WebCrypto type shim — TYPE-ONLY, erased at runtime.
 *
 * The VERIFY path calls the WebCrypto SubtleCrypto API through the global `crypto`
 * object, which exists on every target runtime (Node 20+, Cloudflare Workers, Shopify
 * Oxygen, Vercel Edge, browsers). We only need the `CryptoKey` TYPE for the function
 * signatures.
 *
 * We source it from `node:crypto`'s `webcrypto` namespace via an `import type`. Because
 * this is a type-only import it is fully elided by the compiler — the emitted JS contains
 * NO `require('node:crypto')` / `import 'node:crypto'`, so the main entry stays free of any
 * Node builtin at runtime. (In this monorepo `@types/node` is present; a downstream
 * Workers project that lacks it but provides the DOM/WebCrypto lib globals resolves the
 * same `crypto.subtle` calls against its own ambient `CryptoKey`.)
 */

import type { webcrypto } from 'node:crypto'

/** The WebCrypto opaque key handle returned by `crypto.subtle.importKey`. */
export type CryptoKey = webcrypto.CryptoKey
