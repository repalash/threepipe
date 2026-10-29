// Vite emits the worker as dist/motionbricks.worker.js and gives its URL.
declare module '*?worker&url' {
    const url: string
    export default url
}
