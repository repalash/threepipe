/**
 * The agent socket in the shell: a header indicator while an agent is connected (or trying to be),
 * and the Connect Agent dialog.
 *
 * Hidden while the socket is idle, so an editor nobody connected to looks exactly as before.
 */

import {useEffect, useReducer, useState} from 'react'
import {Button, Dialog, DialogBody, DialogFooter, FormGroup, InputGroup, Tag} from '@blueprintjs/core'
import type {AgentActivity, AgentSocketPlugin} from '@threepipe/plugin-modelling'
import {useEditor} from './EditorContext'

const URL_KEY = 'threepipe-agent-relay-url'

/** The page's `AgentSocketPlugin`, re-rendering on its events. */
export function useAgentSocket(): AgentSocketPlugin | undefined {
    const {engine} = useEditor()
    const socket = engine.viewer.getPlugin('AgentSocketPlugin' as never) as AgentSocketPlugin | undefined
    const [, bump] = useReducer((x: number) => x + 1, 0)
    useEffect(() => {
        if (!socket) return
        socket.addEventListener('statusChanged', bump)
        socket.addEventListener('agentCommand', bump)
        return () => {
            socket.removeEventListener('statusChanged', bump)
            socket.removeEventListener('agentCommand', bump)
        }
    }, [socket])
    return socket
}

/** `extrude pier` - what a person would call the step. */
export function describeActivity(a: AgentActivity): string {
    const c = a.command as Record<string, unknown>
    const target = typeof c.object === 'string' ? c.object : typeof c.name === 'string' ? c.name : typeof c.type === 'string' ? c.type : ''
    return `${a.command.op}${target ? ' ' + target : ''}`
}

export function AgentIndicator() {
    const {engine} = useEditor()
    const socket = useAgentSocket()
    if (!socket || socket.status === 'idle') return null
    const last = socket.lastActivity
    const label = socket.status === 'connected'
        ? socket.agents.length ? `Agent: ${socket.agents.join(', ')}` : 'Agent socket open'
        : socket.status === 'connecting' ? 'Agent: connecting…' : 'Agent: error'
    return <button className={`me-agent-indicator me-agent-${socket.status}${socket.busy ? ' me-agent-busy' : ''}`}
        data-agent-indicator={socket.status} onClick={() => engine.run('agent.connect')}
        title={socket.error ?? (last ? `Last: ${describeActivity(last)}${last.result.ok ? '' : ' - ' + last.result.error}` : 'No commands yet')}>
        <span className="me-agent-dot" />
        <span className="me-agent-label">{label}</span>
        {last && <span className="me-agent-last" data-agent-last>{describeActivity(last)}{last.result.ok ? '' : ' ✕'}</span>}
    </button>
}

export function AgentDialog({isOpen, onClose, onLook}: {isOpen: boolean, onClose: () => void, onLook: () => void}) {
    const socket = useAgentSocket()
    const [url, setUrl] = useState(() => socket?.url ?? localStorage.getItem(URL_KEY) ?? 'ws://127.0.0.1:9396')
    const [token, setToken] = useState('')
    if (!socket) return null
    const connected = socket.status !== 'idle'
    const connect = () => {
        localStorage.setItem(URL_KEY, url)
        socket.connect(url.trim(), token.trim())
    }
    return <Dialog isOpen={isOpen} onClose={onClose} title="Agent" className="me-dialog me-agent-dialog" icon="link">
        <DialogBody>
            <div className="me-agent-status" data-agent-status={socket.status}>
                <Tag minimal intent={socket.status === 'connected' ? 'success' : socket.status === 'error' ? 'danger' : socket.status === 'connecting' ? 'warning' : 'none'}>{socket.status}</Tag>
                {socket.url && <code>{socket.url}</code>}
                {socket.agents.length > 0 && <span> · {socket.agents.join(', ')}</span>}
                {socket.error && <div className="me-agent-error">{socket.error}</div>}
            </div>
            {!connected && <>
                <p className="me-dialog-note">Start a relay - <code>npx threepipe-modelling relay</code>, or the MCP server
                    (<code>@threepipe/modelling-mcp</code>) - and paste the URL and token it prints. Every command the agent sends
                    runs here and lands in this undo history.</p>
                <FormGroup label="Relay URL" labelFor="me-agent-url">
                    <InputGroup id="me-agent-url" data-agent-url value={url} onChange={e => setUrl(e.target.value)} />
                </FormGroup>
                <FormGroup label="Token" labelFor="me-agent-token">
                    <InputGroup id="me-agent-token" data-agent-token value={token} onChange={e => setToken(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && connect()} />
                </FormGroup>
            </>}
            {connected && <div className="me-agent-activity" data-agent-activity>
                {socket.activity.length === 0 && <div className="me-dialog-note">No commands yet.</div>}
                {socket.activity.slice(-12).reverse().map(a => <div key={a.time + a.result.index} className={a.result.ok ? '' : 'me-agent-failed'}>
                    <b>#{a.result.index}</b> {describeActivity(a)} <span className="me-agent-ms">{a.result.ok ? `${a.result.ms} ms` : a.result.error}</span>
                </div>)}
            </div>}
        </DialogBody>
        <DialogFooter actions={<>
            {connected && <Button text="Last look" icon="eye-open" onClick={onLook} />}
            {connected
                ? <Button text="Disconnect" intent="danger" data-agent-disconnect onClick={() => socket.disconnect()} />
                : <Button text="Connect" intent="primary" data-agent-connect disabled={!url.trim()} onClick={connect} />}
            <Button text="Close" onClick={onClose} />
        </>} />
    </Dialog>
}
