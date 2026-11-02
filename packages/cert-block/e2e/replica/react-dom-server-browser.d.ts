// The Web-streams build Hydrogen's worker renders with; @types/react-dom types its API on `react-dom/server` only.
declare module 'react-dom/server.browser' {
	export { renderToReadableStream } from 'react-dom/server'
}
