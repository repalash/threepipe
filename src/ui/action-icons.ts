/** A line icon of 16 px with the stroke in the current colour, for an action button of a UI (`UiObjectConfig.icon`) */
const actionIcon = (d: string) => `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`

/**
 * The icons of the object and selection actions, one set for the buttons of the object uiConfig (Duplicate Object,
 * Delete Object) and the actions of the `PickingPlugin`, so a UI shows the same icon for the same action.
 */
export const ACTION_ICONS = {
    focus: actionIcon('<path d="M2.5 5.5v-3h3M10.5 2.5h3v3M13.5 10.5v3h-3M5.5 13.5h-3v-3"/><circle cx="8" cy="8" r="2"/>'),
    toggleVisibility: actionIcon('<path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>'),
    /** Hide or show, while the selected object is hidden: the crossed eye */
    toggleVisibilityHidden: actionIcon('<path d="M2 2l12 12M6.2 3.8A6.6 6.6 0 0 1 8 3.5c4.1 0 6.5 4.5 6.5 4.5a11 11 0 0 1-1.9 2.4M10.1 12.1A6.6 6.6 0 0 1 8 12.5C3.9 12.5 1.5 8 1.5 8a11 11 0 0 1 2.4-2.9"/>'),
    duplicate: actionIcon('<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 3.5V3a.5.5 0 0 0-.5-.5H3a.5.5 0 0 0-.5.5v7a.5.5 0 0 0 .5.5h.5"/>'),
    delete: actionIcon('<path d="M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.7 8.6a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9l.7-8.6"/>'),
    selectParent: actionIcon('<path d="M6.5 6L9.5 3l3 3M9.5 3v6.5a3 3 0 0 1-3 3h-3"/>'),
}
