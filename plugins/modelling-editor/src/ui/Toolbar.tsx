/**
 * The left toolbar: one button per registered tool for the current mode, grouped, each with a
 * tooltip showing the name, the shortcut and what it does. Tools whose `poll` fails render disabled
 * with the reason in the tooltip.
 */

import React from 'react'
import {Divider} from '@blueprintjs/core'
import {useEditor, useEngineVersion} from './EditorContext'
import {IconButton} from './IconButton'

export function Toolbar() {
    const {engine} = useEditor()
    useEngineVersion('registryChanged', 'modeChanged', 'toolChanged', 'selectionChanged')
    const ctx = engine.context()
    const tools = engine.tools.list(t => !t.modes || t.modes.includes(ctx.mode))
    const active = engine.activeTool?.id
    let lastGroup: string | undefined
    return <nav className="me-toolbar" aria-label="Tools">
        {tools.map(t => {
            const sep = lastGroup !== undefined && t.group !== lastGroup
            lastGroup = t.group
            const p = t.poll?.(ctx)
            const reason = p === undefined || p === true ? undefined : typeof p === 'string' ? p : 'Not available'
            return <React.Fragment key={t.id}>
                {sep && <Divider className="me-toolbar-divider" />}
                <IconButton
                    icon={t.icon as never}
                    size="large"
                    active={active === t.id}
                    label={t.label} shortcut={t.shortcut} description={t.description} reason={reason}
                    tooltipPlacement="right"
                    data-tool={t.id}
                    onClick={() => engine.setActiveTool(t.id)}
                />
            </React.Fragment>
        })}
    </nav>
}
