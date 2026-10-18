/**
 * The MCP tool list, generated from the modelling command registry.
 *
 * Ten tools, not one per command: `run` and `batch` take any command of the *enabled* groups (their
 * schema is the union of those commands' own JSON Schemas), `look`, `measure`, `validate`, `diff`,
 * `inspect` and `export` are the checks an agent should reach for without thinking (their schemas are
 * those commands' schemas, verbatim), `help` reads the table, and `enableToolGroup` widens `run`.
 * Nothing here is written by hand that the registry already says - a command's parameters, their
 * descriptions and its summary all come from `CommandDefinition`.
 */

export interface CommandInfo {
    name: string
    description: string
    inputSchema: {type: 'object', properties: Record<string, unknown>, required?: string[], additionalProperties?: boolean}
    group: string
    mutates: boolean
}

export interface ToolDef {
    name: string
    description: string
    inputSchema: Record<string, unknown>
}

/** Commands with a tool of their own. */
export const DEDICATED = ['look', 'measure', 'validate', 'diff', 'inspect', 'export'] as const

/** What `run` offers before any `enableToolGroup`. */
export const DEFAULT_GROUPS = ['create', 'edit', 'shape', 'session']

/** One command's schema with its `op` pinned, for `run`'s union. */
export function commandSchema(c: CommandInfo): Record<string, unknown> {
    return {
        type: 'object',
        title: c.name,
        description: c.description.split('\n')[0],
        properties: {op: {const: c.name}, ...c.inputSchema.properties},
        required: ['op', ...c.inputSchema.required ?? []],
        additionalProperties: false,
    }
}

export function groupsOf(commands: CommandInfo[]): Record<string, string[]> {
    const out: Record<string, string[]> = {}
    for (const c of commands) (out[c.group] ??= []).push(c.name)
    return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)))
}

export function runnable(commands: CommandInfo[], enabled: Set<string>): CommandInfo[] {
    return commands.filter(c => enabled.has(c.group) && !(DEDICATED as readonly string[]).includes(c.name))
}

export function buildTools(commands: CommandInfo[], enabled: Set<string>): ToolDef[] {
    const byName = new Map(commands.map(c => [c.name, c]))
    const groups = groupsOf(commands)
    const offered = runnable(commands, enabled)
    const hidden = Object.keys(groups).filter(g => !enabled.has(g))
    const opList = offered.map(c => `- ${c.name}: ${c.description.split('\n')[0]}`).join('\n')
    const union = {oneOf: offered.map(commandSchema)}
    const tools: ToolDef[] = [
        {
            name: 'run',
            description: 'Run one modelling command `{op, ...params}` on the document - the live editor when one is '
                + 'connected, otherwise a headless session. Every mutating command is one undo step and its result '
                + 'carries `locality` (what changed, and anything that changed outside what it named).\n\n'
                + `Enabled commands:\n${opList}\n\n`
                + (hidden.length ? `More groups (call enableToolGroup first): ${hidden.map(g => `${g} (${groups[g].join(', ')})`).join('; ')}.` : ''),
            inputSchema: {
                type: 'object',
                properties: {command: {description: 'The command: `{op, ...params}`.', ...union}},
                required: ['command'],
                additionalProperties: false,
            },
        },
        {
            name: 'batch',
            description: 'Run several commands in order, stopping at the first failure unless `continueOnError`. '
                + 'Same commands as `run`. Returns every result.',
            inputSchema: {
                type: 'object',
                properties: {
                    commands: {type: 'array', items: union, minItems: 1},
                    continueOnError: {type: 'boolean', description: 'Keep going after a failure.'},
                },
                required: ['commands'],
                additionalProperties: false,
            },
        },
    ]
    for (const name of DEDICATED) {
        const c = byName.get(name)
        if (!c) continue
        tools.push({name, description: c.description, inputSchema: c.inputSchema})
    }
    tools.push({
        name: 'help',
        description: 'The command table: groups and their commands, one command\'s full description and parameters '
            + '(`op`), or one group (`group`). Also says where commands are running (live editor or headless) '
            + 'and how to connect an editor.',
        inputSchema: {
            type: 'object',
            properties: {
                op: {type: 'string', description: 'A command name.'},
                group: {type: 'string', enum: Object.keys(groups), description: 'A command group.'},
            },
            additionalProperties: false,
        },
    }, {
        name: 'enableToolGroup',
        description: 'Add a group of commands to `run` and `batch` (or remove one). The tool list changes; '
            + `groups: ${Object.entries(groups).map(([g, ops]) => `${g}${enabled.has(g) ? ' (on)' : ''}: ${ops.join(', ')}`).join('; ')}.`,
        inputSchema: {
            type: 'object',
            properties: {
                group: {type: 'string', enum: Object.keys(groups)},
                enable: {type: 'boolean', description: 'Default true; false removes the group again.'},
            },
            required: ['group'],
            additionalProperties: false,
        },
    })
    return tools
}
