/**
 * Draws a menu the engine resolved (`engine.resolveMenu`, `engine.headerMenus`): the header's
 * dropdowns, the Ctrl+V/E/F and X popups and the right-click menus are all this component over the
 * engine's menu definitions (Blender's `VIEW3D_MT_*`, `plugin-editor-engine/src/menus/menus.ts`). Nothing
 * here names an operator or a menu.
 *
 * Entries the engine has no operator for are drawn disabled, with "Not available yet" in their tooltip.
 * Submenus open in a portal, so a menu that scrolls (taller than the window) does not clip them, and
 * every level is capped at the window's height.
 */

import React from 'react'
import {Menu, MenuDivider, MenuItem} from '@blueprintjs/core'
import type {EditorEngine, ResolvedMenu, ResolvedMenuItem} from '@threepipe/plugin-editor-engine'
import {formatShortcut, useEditor} from './EditorContext'

const SUBMENU_POPOVER = {
    usePortal: true,
    // Submenus flip to the left and slide up rather than run off the window.
    modifiers: {flip: {enabled: true}, preventOverflow: {enabled: true, options: {padding: 4, altAxis: true}}},
} as const

/** The rows of a resolved menu as Blueprint menu items; submenus recurse. */
export function menuItems(engine: EditorEngine, menu: ResolvedMenu, onRun?: () => void): React.ReactElement[] {
    const draw = (item: ResolvedMenuItem): React.ReactElement => {
        switch (item.type) {
        case 'separator':
            return <MenuDivider key={item.key} />
        case 'label':
            return <MenuDivider key={item.key} title={item.label} className="me-menu-label" />
        case 'operator':
            return <MenuItem
                key={item.key}
                text={item.label}
                icon={item.icon as never}
                label={formatShortcut(item.shortcut)}
                disabled={!item.enabled}
                title={item.tooltip}
                data-menu-item={item.id}
                data-menu-label={item.label}
                data-available={item.available}
                onClick={() => { onRun?.(); void engine.run(item.id, item.props) }}
            />
        case 'menu':
            if (!item.menu) {
                return <MenuItem key={item.key} text={item.label} icon={item.icon as never} label={formatShortcut(item.shortcut)}
                    disabled title={item.tooltip} data-submenu={item.id} data-menu-label={item.label} data-available={false} />
            }
            return <MenuItem
                key={item.key}
                text={item.label}
                icon={item.icon as never}
                label={formatShortcut(item.shortcut)}
                data-submenu={item.id}
                data-menu-label={item.label}
                data-available
                popoverProps={SUBMENU_POPOVER as never}
                submenuProps={{className: 'me-menu', 'data-menu-id': item.menu.id} as never}
            >
                {item.menu.items.map(draw)}
            </MenuItem>
        }
    }
    return menu.items.map(draw)
}

/** A whole menu: a header dropdown, or a popup at the pointer (with its title, as Blender's popups have). */
export function MenuView({menu, title, className, onRun}: {menu: ResolvedMenu, title?: string, className?: string, onRun?: () => void}) {
    const {engine} = useEditor()
    return <Menu className={className ?? 'me-menu'} data-menu-id={menu.id}>
        {title ? <MenuDivider title={title} className="context-menu-divider" /> : null}
        {menuItems(engine, menu, onRun)}
    </Menu>
}
