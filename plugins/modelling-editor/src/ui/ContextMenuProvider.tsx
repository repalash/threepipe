/**
 * One app-level context menu, positioned at the click.
 *
 * Adapted from `experiments/threepipe-blueprint-editor/src/components/ContextMenuProvider.tsx` and
 * `src/utils/ContextMenuUtils.ts`. The declarative `MenuItem2` shape is kept; the Kite "Log in
 * Console" dev item and the string-keyed action map are dropped in favour of operator ids.
 */

import React, {createContext, useCallback, useContext, useMemo, useState} from 'react'
import {ContextMenuPopover, Menu, MenuDivider, MenuItem, MenuItemProps} from '@blueprintjs/core'
import {useEditor, formatShortcut} from './EditorContext'
import type {EditorContext as EngineContext, OperatorDescriptor} from '../registry'

export interface MenuItem2 {
    props: MenuItemProps
    action?: (data?: any, obj?: any, e?: React.MouseEvent<HTMLElement>, m?: MenuItem2) => any
    data?: any
    key: string
    children?: MenuItem2[]
    hidden?: boolean
}

export function renderMenuItems<T>(menuItems: MenuItem2[] | undefined, obj: T): React.ReactNode[] {
    if (!menuItems || menuItems.length === 0) return []
    const renderMenuItem = (m: MenuItem2, i: number): React.ReactNode => {
        const {children, hidden, ...props} = m.props
        const rc = m.children?.map(renderMenuItem)
        const children2 = rc?.length || children ? <>{children}{rc}</> : undefined
        return hidden ? null : <MenuItem
            {...props}
            children={children2}
            key={m.key || `mi-${i}`}
            onClick={async e => {
                await m.action?.(m.data, obj, e, m)
                m.props.onClick?.(e as never)
            }}
        />
    }
    return menuItems.map(renderMenuItem)
}

interface Store {
    isOpen: boolean
    content: React.JSX.Element | null
    targetOffset: {left: number, top: number}
    show(event: {clientX: number, clientY: number, preventDefault?: () => void}, menu: React.JSX.Element): void
    hide(): void
    /** Show the operators that apply right now, for the given context-menu scope. */
    showOperators(event: {clientX: number, clientY: number, preventDefault?: () => void}, scope: NonNullable<OperatorDescriptor['contextMenu']>[number], extra?: MenuItem2[], title?: string): void
}

const StoreContext = createContext<Store | undefined>(undefined)

export function ContextMenuProvider({children}: {children: React.ReactNode}) {
    const {engine} = useEditor()
    const [isOpen, setIsOpen] = useState(false)
    const [targetOffset, setTargetOffset] = useState({left: 0, top: 0})
    const [content, setContent] = useState<React.JSX.Element | null>(null)

    const hide = useCallback(() => { setIsOpen(false); setContent(null) }, [])
    const show = useCallback((event: {clientX: number, clientY: number, preventDefault?: () => void}, menu: React.JSX.Element) => {
        event.preventDefault?.()
        setContent(menu)
        setTargetOffset({left: event.clientX, top: event.clientY})
        setIsOpen(true)
    }, [])

    const showOperators = useCallback<Store['showOperators']>((event, scope, extra, title) => {
        const ctx = engine.context()
        const ops = engine.operators.list(op => !!op.contextMenu?.includes(scope) && (!op.modes || op.modes.includes(ctx.mode)))
        const items = operatorsToMenuItems(ops, ctx, (id) => engine.run(id))
        const rc = [...renderMenuItems(extra, null), ...renderMenuItems(items, null)]
        if (!rc.length) return
        show(event, <Menu className="me-context-menu">
            {title ? <MenuDivider title={title} className="context-menu-divider" /> : null}
            {rc}
        </Menu>)
    }, [engine, show])

    // Blueprint's ContextMenuPopover only closes from its backdrop; Escape should close it too.
    React.useEffect(() => {
        if (!isOpen) return
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); hide() } }
        window.addEventListener('keydown', onKey, true)
        return () => window.removeEventListener('keydown', onKey, true)
    }, [isOpen, hide])

    const value = useMemo<Store>(() => ({isOpen, content, targetOffset, show, hide, showOperators}), [isOpen, content, targetOffset, show, hide, showOperators])

    return <StoreContext.Provider value={value}>
        {children}
        {content && <ContextMenuPopover
            isOpen={isOpen}
            content={content}
            targetOffset={targetOffset}
            onClose={hide}
        />}
    </StoreContext.Provider>
}

export function useContextMenu(): Store {
    const v = useContext(StoreContext)
    if (!v) throw new Error('useContextMenu: no ContextMenuProvider')
    return v
}

/** Operators as menu items, disabled with their poll reason as the title. */
export function operatorsToMenuItems(ops: OperatorDescriptor[], ctx: EngineContext, run: (id: string, props?: Record<string, unknown>) => unknown): MenuItem2[] {
    return ops.map(op => {
        const polled = (ctx.engine as any).poll ? (ctx.engine as any).poll(op, ctx) as {enabled: boolean, reason?: string} : {enabled: true}
        return {
            key: op.id,
            props: {
                text: op.label,
                icon: op.icon as never,
                label: formatShortcut(op.shortcut),
                disabled: !polled.enabled,
                title: polled.enabled ? op.description : polled.reason ?? op.description,
            },
            action: () => run(op.id),
        }
    })
}
