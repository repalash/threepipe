// The Text rule in wrangler.jsonc: the pages and their scripts are imported as strings (src/page.ts).
declare module '*.html' {
    const text: string
    export default text
}
declare module '*.client.js' {
    const text: string
    export default text
}
declare module '*.css' {
    const text: string
    export default text
}
