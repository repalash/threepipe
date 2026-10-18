// The headless session page is built by @threepipe/modelling-cli (`npm run build:modelling-cli`); the MCP
// bundle serves it from its own dist/page.
import {cp, stat} from 'node:fs/promises'
import {resolve, dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
const here = dirname(fileURLToPath(import.meta.url))
const from = resolve(here, '../../modelling-cli/dist/page')
try {
    await stat(resolve(from, 'index.html'))
} catch {
    console.error(`missing ${from}/index.html - run npm run build:modelling-cli first`)
    process.exit(1)
}
await cp(from, resolve(here, '../dist/page'), {recursive: true})
