/**
 * One app-level context menu, positioned at the click.
 *
 * Adapted from `experiments/threepipe-blueprint-editor/src/components/ContextMenuProvider.tsx` and
 * `src/utils/ContextMenuUtils.ts`. The declarative `MenuItem2` shape is kept; the Kite "Log in
 * Console" dev item and the string-keyed action map are dropped in favour of operator ids.
 */

import React, {createContext, useCallback, useContext, useMemo, useState} from 'react'
import {ContextMenuPopover, Menu, MenuDivider, MenuItem, MenuItemProps} from '@blueprintjs/core'
import {useEditor} from './EditorContext'
import type {MenuRequestItem} from '@threepipe/plugin-editor-engine'
import {MenuView} from './MenuView'

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
    /**
     * Show one of the engine's menus at the pointer (`uiRequest: menu` with a `menu` id: the X delete menu,
     * Shift+A, Ctrl+V/E/F, the right-click menus).
     */
    showMenu(event: {clientX: number, clientY: number}, menuId: string, title?: string): void
    /** Show a one-off list the engine asked for (`uiRequest: menu` with `items`: the keymap picker). */
    showItems(event: {clientX: number, clientY: number}, items: MenuRequestItem[], title?: string): void
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

    const isOpenRef = React.useRef(false)
    isOpenRef.current = isOpen

    /**
     * Open a popup. Requested from an item of an open menu (context menu > Delete > the delete-type
     * menu): that item's click also closes its popover through `onClose`, after this runs. Let it close,
     * then open the new one, so the close cannot swallow it.
     */
    const openRef = React.useRef<(event: {clientX: number, clientY: number}, menu: React.JSX.Element) => void>(() => undefined)
    openRef.current = (event, menu) => {
        if (isOpenRef.current) {
            hide()
            requestAnimationFrame(() => show(event, menu))
        } else {
            show(event, menu)
        }
    }
    const open = useCallback((event: {clientX: number, clientY: number}, menu: React.JSX.Element) => openRef.current(event, menu), [])

    const showItems = useCallback<Store['showItems']>((event, items, title) => {
        const ctx = engine.context()
        const rc = items.map((item, i) => {
            const op = engine.operators.get(item.id)
            if (!op) return null
            const polled = engine.poll(op, ctx)
            return <MenuItem
                key={`${item.id}-${i}`}
                text={item.label ?? op.label}
                icon={item.label ? undefined : op.icon as never}
                disabled={!polled.enabled}
                title={polled.enabled ? op.description : polled.reason ?? op.description}
                onClick={() => { void engine.run(item.id, item.props) }}
            />
        }).filter(x => !!x)
        if (!rc.length) return
        open(event, <Menu className="me-context-menu me-popup-menu">
            {title ? <MenuDivider title={title} className="context-menu-divider" /> : null}
            {rc}
        </Menu>)
    }, [engine])

    const showMenu = useCallback<Store['showMenu']>((event, menuId, title) => {
        const menu = engine.resolveMenu(menuId)
        if (!menu?.items.length) return
        open(event, <MenuView menu={menu} title={title ?? menu.label} className="me-context-menu me-popup-menu" onRun={hide} />)
    }, [engine, hide])

    // Blueprint's ContextMenuPopover only closes from its backdrop; Escape should close it too.
    // The engine's keymap stands down while a menu is open, so its keys go to the menu.
    React.useEffect(() => {
        if (!isOpen) return
        engine.input.suspend('me-context-menu')
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); hide() } }
        window.addEventListener('keydown', onKey, true)
        return () => {
            window.removeEventListener('keydown', onKey, true)
            engine.input.resume('me-context-menu')
        }
    }, [isOpen, hide, engine])

    const value = useMemo<Store>(() => ({isOpen, content, targetOffset, show, hide, showMenu, showItems}), [isOpen, content, targetOffset, show, hide, showMenu, showItems])

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
