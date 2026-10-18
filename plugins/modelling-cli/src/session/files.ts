/**
 * Paths in commands, for sessions that run in a page.
 *
 * A page cannot write files, so `export {path}`, `look {path}` and `capture {path}` are sent without the
 * path, with the bytes asked for in the result, and written here; the result then names the file instead
 * of carrying megabytes of base64. A Node session writes through `node:fs` itself and needs none of this.
 */

import {mkdir, writeFile} from 'node:fs/promises'
import {dirname, resolve} from 'node:path'
import type {Command, CommandResult} from '@threepipe/plugin-modelling'

function dataUrlBytes(dataUrl: string): Buffer {
    return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')
}

async function write(path: string, bytes: Uint8Array): Promise<string> {
    const full = resolve(path)
    await mkdir(dirname(full), {recursive: true})
    await writeFile(full, bytes)
    return full
}

export async function runWithFiles(
    run: (c: Command) => Promise<CommandResult>, command: Command,
): Promise<CommandResult> {
    const path = typeof command.path === 'string' ? command.path : null
    if (!path || !['export', 'look', 'capture'].includes(command.op)) return run(command)
    const sent: Command = {...command}
    delete sent.path
    if (command.op === 'export') sent.includeData = true
    if (command.op === 'look') sent.includeImage = true
    const result = await run(sent)
    if (!result.ok || !result.data) return result
    const data = {...result.data as Record<string, unknown>}
    if (command.op === 'export' && typeof data.base64 === 'string') {
        data.path = await write(path, Buffer.from(data.base64, 'base64'))
        if (command.includeData !== true) delete data.base64
    } else if (command.op === 'look' && typeof data.image === 'string') {
        data.path = await write(path, dataUrlBytes(data.image))
        if (command.includeImage !== true) delete data.image
    } else if (command.op === 'capture' && typeof data.dataUrl === 'string') {
        data.path = await write(path, dataUrlBytes(data.dataUrl))
        delete data.dataUrl
    }
    return {...result, data}
}
