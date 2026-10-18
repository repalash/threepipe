// Run metrics: what a build cost. From the build's `transcript.json` (scripts/modelling-session.mjs, or the
// CLI's `session` verb) and, when given, the agent's own transcript (Claude Code JSONL), counted with the same
// rules as the status page (.repos/status/build.mjs): active time skips gaps over 10 minutes, tokens are
// summed from `message.usage`, tool calls are `tool_use` blocks.

import {readFileSync} from 'node:fs'

const RENDER_OPS = new Set(['capture', 'look'])

/** @param {{summary?: object, operations?: object[]}} t a parsed transcript.json */
export function transcriptMetrics(t) {
    const ops = t.operations ?? []
    const byOp = {}
    let commandMs = 0, opWallMs = 0, renderMs = 0, renders = 0, failed = 0
    for (const o of ops) {
        const op = o.command?.op ?? '?'
        const ms = o.result?.ms ?? 0, wall = o.wallMs ?? 0
        const b = byOp[op] ??= {count: 0, ms: 0, wallMs: 0}
        b.count++; b.ms += ms; b.wallMs += wall
        commandMs += ms; opWallMs += wall
        if (RENDER_OPS.has(op)) { renders++; renderMs += wall || ms }
        if (o.result && !o.result.ok) failed++
    }
    const s = t.summary ?? {}
    return {
        commands: ops.length, failed, renders,
        commandMs: Math.round(commandMs), operationWallMs: Math.round(opWallMs), renderWallMs: Math.round(renderMs),
        // whole-build wall time, recorded by the harness since 2026-10-18; older transcripts lack it
        buildWallMs: s.wallMs ?? null, session: s.session ?? (s.url ? 'browser' : null),
        byOp,
    }
}

/** @param {string} path an agent transcript (.jsonl) */
export function agentMetrics(path) {
    let out = 0, inp = 0, cacheRead = 0, cacheWrite = 0, tools = 0
    const models = new Set(), ts = []
    for (const line of readFileSync(path, 'utf8').split('\n')) {
        if (!line) continue
        let m
        try { m = JSON.parse(line) } catch { continue }
        if (m.timestamp) ts.push(Date.parse(m.timestamp))
        if (m.type !== 'assistant') continue
        const u = m.message?.usage ?? {}
        out += u.output_tokens ?? 0; inp += u.input_tokens ?? 0
        cacheRead += u.cache_read_input_tokens ?? 0; cacheWrite += u.cache_creation_input_tokens ?? 0
        if (m.message?.model) models.add(m.message.model)
        for (const c of m.message?.content ?? []) if (c?.type === 'tool_use') tools++
    }
    ts.sort((a, b) => a - b)
    let active = 0
    for (let i = 1; i < ts.length; i++) active += Math.min(ts[i] - ts[i - 1], 600000)
    return {models: [...models], activeMin: Math.round(active / 60000), toolCalls: tools, outputTokens: out,
        inputTokens: inp + cacheRead + cacheWrite, cacheReadTokens: cacheRead}
}
