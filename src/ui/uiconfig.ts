import {UiConfigMethods, type UiObjectConfig} from 'uiconfig.js'

export {UiConfigRendererBase, UiConfigMethods, UiConfigRenderer} from 'uiconfig.js'
export type {UiConfigContainer, IUiConfigContainer, UiObjectConfig, UiObjectType, TUiRefreshModes, ChangeArgs, ChangeEvent} from 'uiconfig.js'

// decorators
export {uiConfig, uiContainer} from 'uiconfig.js'
export {
    uiMonitor, uiSlider, uiVector, uiDropdown, uiButton, uiInput,
    uiColor, uiImage, uiToggle, uiNumber,
} from 'uiconfig.js'
export {uiPanelContainer, uiFolderContainer} from 'uiconfig.js'

export {generateUiConfig, generateUiFolder, generateValueConfig, UiConfigTypeMap} from 'uiconfig.js'
export type {TParams} from 'uiconfig.js'

/**
 * Tags that threepipe sets in the `tags` of uiConfigs. Renderers and editors read them to filter what they show;
 * a renderer that does not read them shows the full UI.
 */
export enum UiTags {
    /**
     * The basic fields of an object, material, light, camera or extension: the few fields that a simple view (like
     * an editor inspector) shows. The full UI stays available, for example behind an "All" toggle.
     *
     * The rule:
     * - Tag fields, not folders. A simple view shows a folder (as a section with its label) only when it holds a
     * basic field, at any depth, and shows only the basic fields in it. A folder without basic fields is left out.
     * - A folder with the tag is basic as a whole and is shown with all its children.
     * - Actions (duplicate, delete) are not basic, they belong in a menu (`context-menu` tag).
     *
     * Set it with the `tags` of a config, or in the params of a decorator:
     * ```ts
     * @uiSlider('Intensity', [0, 10], 0.01, {tags: [UiTags.Basic]})
     * intensity = 1
     * ```
     * {@link findTaggedUiConfigs} lists the basic fields of a uiConfig with the folders above them.
     */
    Basic = 'basic'
}

/**
 * Returns true when the `tags` of the config contain the tag. `tags` can be a string or an array of strings.
 * @param config - uiConfig to check
 * @param tag - tag to look for, like {@link UiTags.Basic}
 */
export function hasUiTag(config: UiObjectConfig | undefined, tag: string): boolean {
    const tags = config?.tags
    return Array.isArray(tags) ? tags.includes(tag) : tags === tag
}

/**
 * A config found by {@link findTaggedUiConfigs}, with the folders above it.
 */
export interface TaggedUiConfig {
    config: UiObjectConfig
    /**
     * The containers from the root (first) to the direct parent of {@link config} (last). Empty when the config is the root.
     */
    parents: UiObjectConfig[]
}

/**
 * Lists the configs in a uiConfig tree that have the tag, in the order of the tree, with the folders above each one.
 * A config with the tag is returned whole: its children are not walked. Folders without the tag are walked, at any
 * depth; the options of a dropdown are not walked. Children that are functions are called, like a renderer does
 * (`UiConfigMethods.GetChildren`). `hidden` is not checked, since it can change; a renderer checks it when it renders.
 *
 * With {@link UiTags.Basic}, this lists the fields of a simple view. A renderer can show them in sections by the label
 * of the last parent, or in one flat list.
 * @param config - root uiConfig, like `object.uiConfig` or `material.uiConfig`
 * @param tag - tag to look for, like {@link UiTags.Basic}
 */
export function findTaggedUiConfigs(config: UiObjectConfig, tag: string): TaggedUiConfig[] {
    const result: TaggedUiConfig[] = []
    const visited = new Set<UiObjectConfig>()
    const walk = (c: UiObjectConfig, parents: UiObjectConfig[]) => {
        if (!c || typeof c !== 'object' || visited.has(c)) return
        visited.add(c)
        if (hasUiTag(c, tag)) {
            result.push({config: c, parents})
            return
        }
        if (!c.children || c.type === 'dropdown') return
        const path = [...parents, c]
        for (const child of UiConfigMethods.GetChildren(c)) walk(child, path)
    }
    walk(config, [])
    return result
}
