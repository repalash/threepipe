import {expect, it} from 'vitest'
import {existsSync, readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {generateDslTypes} from '../src/dsl/generateTypes'
import '../src/nodes'

// `src/dsl/nodes.generated.ts` is generated from the node registry; `npm run generate:dsl` rewrites it.
it('the DSL node types match the registry', () => {
    const file = join(__dirname, '../src/dsl/nodes.generated.ts')
    const text = generateDslTypes()
    if (process.env.UPDATE_DSL_TYPES) writeFileSync(file, text)
    expect(existsSync(file) && readFileSync(file, 'utf8') === text, 'nodes.generated.ts is stale: npm run generate:dsl').toBe(true)
})
