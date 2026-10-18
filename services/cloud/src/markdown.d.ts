// Types of src/markdown.js (copied JavaScript, kept as it is).
export function isMarkdownPath(path: string): boolean
export function wantsRenderedMarkdown(request: Request, url: URL): boolean
export function markdownToPage(md: string, opts: {path: string, rawHref: string}): string
export function markdownResponse(obj: R2ObjectBody, request: Request, opts: {path: string, rawHref: string}): Promise<Response>
