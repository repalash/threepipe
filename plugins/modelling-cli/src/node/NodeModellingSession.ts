import type {Command, CommandResult} from '@threepipe/plugin-modelling'
import {NodeSession, NodeSessionOptions} from './NodeSession'
import {ModellingSession} from '../session/types'

/** {@link NodeSession} as a {@link ModellingSession}. */
export class NodeModellingSession implements ModellingSession {
    readonly kind = 'node' as const
    readonly node: NodeSession

    constructor(options: NodeSessionOptions = {}) {
        this.node = new NodeSession(options)
    }

    run(command: Command): Promise<CommandResult> {
        return this.node.run(command)
    }

    async close(): Promise<void> {
        this.node.dispose()
    }
}
