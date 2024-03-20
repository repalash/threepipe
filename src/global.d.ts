declare module '*.txt' {
    const content: string
    export default content
}
declare module '*.glsl' {
    const content: string
    export default content
}
declare module '*.vert' {
    const content: string
    export default content
}
declare module '*.frag' {
    const content: string
    export default content
}
declare module '*.module.scss' {
    const content: any
    export default content
    export const stylesheet: string
}
// declare module '*.module.css' {
//     const content: any
//     export default content
//     export const stylesheet: string
// }
declare module '*.css?inline' {
    const content: string
    export default content
}

// export {}

// hack for typedoc
// eslint-disable-next-line @typescript-eslint/naming-convention
// declare type OffscreenCanvas = HTMLCanvasElement
