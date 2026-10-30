// The Text rule in wrangler.toml: the staff page and its script are imported as strings.
declare module '*.html' {
    const text: string
    export default text
}
declare module '*.client.js' {
    const text: string
    export default text
}
