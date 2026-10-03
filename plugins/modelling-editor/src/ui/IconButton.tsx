/**
 * Icon-only buttons that keep the canvas focused.
 *
 * From `experiments/threepipe-blueprint-editor/src/components/InteractionIconButton.tsx` and
 * `WindowPanelFlap.tsx`, with a tooltip that shows the name, the shortcut and a one-line description.
 */

import React from 'react'
import {Button, ButtonProps, Tooltip} from '@blueprintjs/core'
import {formatShortcut} from './EditorContext'

export interface IconButtonProps extends ButtonProps {
    label?: string
    shortcut?: string
    description?: string
    /** Disabled with this reason shown in the tooltip. */
    reason?: string
    tooltipPlacement?: 'top' | 'bottom' | 'left' | 'right'
}

export function TooltipContent({label, shortcut, description, reason}: Pick<IconButtonProps, 'label' | 'shortcut' | 'description' | 'reason'>) {
    return <div className="me-tooltip">
        <div className="me-tooltip-title">
            <span>{label}</span>
            {shortcut ? <kbd className="me-kbd">{formatShortcut(shortcut)}</kbd> : null}
        </div>
        {description ? <div className="me-tooltip-desc">{description}</div> : null}
        {reason ? <div className="me-tooltip-reason">{reason}</div> : null}
    </div>
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(props1, ref) {
    const {className, label, shortcut, description, reason, tooltipPlacement, ...props} = props1
    const button = <Button
        ref={ref}
        className={`me-icon-button ${className ?? ''}`}
        size="medium" variant="minimal"
        aria-label={label}
        // keep the canvas focused so the engine's keymap stays live
        onMouseDown={e => e.preventDefault()}
        {...props}
        disabled={props.disabled || !!reason}
    />
    if (!label && !description) return button
    return <Tooltip
        content={<TooltipContent label={label} shortcut={shortcut} description={description} reason={reason} />}
        placement={tooltipPlacement ?? 'bottom'}
        hoverOpenDelay={350}
        compact
        // the button is disabled, so wrap in a span so the tooltip still gets hover events
        targetTagName="span"
    >{button}</Tooltip>
})

export function PanelFlap({isCollapsed, onClick, position}: {isCollapsed: boolean, onClick: () => void, position: 'left' | 'right' | 'bottom'}) {
    const iconMap = {
        left: isCollapsed ? 'chevron-right' : 'chevron-left',
        right: isCollapsed ? 'chevron-left' : 'chevron-right',
        bottom: isCollapsed ? 'chevron-up' : 'chevron-down',
    } as const
    return <Button
        variant="minimal"
        size="small"
        icon={iconMap[position]}
        onClick={onClick}
        title={isCollapsed ? `Expand ${position} panel` : `Collapse ${position} panel`}
        className={`panel-toggle-button panel-toggle-${position}`}
        onContextMenu={e => e.preventDefault()}
        onMouseDown={e => e.preventDefault()}
    />
}
