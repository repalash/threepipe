import type {Command, CommandResult} from '@threepipe/plugin-modelling'

/**
 * Somewhere commands run: a Node session (no pixels), a headless page this process launched, or a live
 * editor reached through the agent socket. All three answer with the same `CommandResult`.
 */
export interface ModellingSession {
    readonly kind: 'node' | 'browser' | 'editor'
    run(command: Command): Promise<CommandResult>
    close(): Promise<void>
}
