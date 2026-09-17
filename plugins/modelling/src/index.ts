/**
 * `@threepipe/plugin-modelling` - a JSON command API for building geometry in threepipe.
 *
 * Everything the plugin can do is a command: `{op: 'primitive', type: 'cube', ...}`. The same table
 * serves a script, a UI, a replay log and an AI agent, and every command is validated, undoable and
 * described by a JSON Schema that an agent can read before it calls anything.
 *
 * See `issues/open/modelling-tools/03-agent-modelling-api.md` for why the surface looks like this.
 */

export * from './document'
export * from './history'
export * from './commands/types'
export * from './commands/registry'
export * from './commands/params'
export * from './commands/create'
export * from './commands/edit'
export * from './commands/scene'
export * from './commands/session'
export * from './modifiers'
export * from './commands/reference'
export * from './commands/modifiers'
export * from './ModellingPlugin'
