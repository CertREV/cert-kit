/**
 * The reader face, react-free: `@certrev/cert-block/reader`.
 *
 * Importing this loads no React, so a server bundle that cannot load `./builder` (it creates a React context at import)
 * can still render, and a stylesheet pipeline can still read the CSS. The Builder card reaches the same function
 * through `envelopeCardHtml` (`./builder/face`); the stylesheet is also the package asset `./reader.css`.
 */
export { READER_CSS } from './reader-css.generated.js'
export {
	type ReaderFaceInput,
	type ReaderLayout,
	type ReaderPart,
	renderReaderFace,
} from './render.js'
