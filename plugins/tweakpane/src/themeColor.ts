export const themeColors = ['black', 'white', 'blue', 'light', 'dark', 'clean', 'clean-dark'] as const
export type ThemeColors = typeof themeColors[number]

/** The `localStorage` key of the colour mode */
export const ThemeStorageKey = 'tpTheme'
/** The `localStorage` key of the default colour mode at the time the colour mode was written */
export const ThemeDefaultStorageKey = 'tpThemeDefault'

/**
 * The defaults of earlier versions (`blue`, then `dark` or `light` from the system setting). Every visit wrote the
 * colour mode, also the default, and without {@link ThemeDefaultStorageKey}, so such a value counts as a default.
 */
const legacyDefaults: readonly ThemeColors[] = ['blue', 'dark', 'light']

/** The default colour mode: `clean`, or `clean-dark` when the system prefers a dark theme */
export function defaultThemeColor(prefersDark: boolean): ThemeColors {
    return prefersDark ? 'clean-dark' : 'clean'
}

/**
 * The kept colour mode, when the person picked it: it was not the default when it was written. A kept value that was
 * the default follows the default of now, so a new default reaches the people who never picked a colour mode.
 * @param storage - `localStorage`, or undefined where the page has none
 * @param defaultColor - the default of now ({@link defaultThemeColor})
 */
export function readThemeColor(storage: Pick<Storage, 'getItem'> | undefined, defaultColor: ThemeColors): ThemeColors {
    const color = storage?.getItem(ThemeStorageKey) as ThemeColors | null | undefined
    if (!color || !themeColors.includes(color)) return defaultColor
    const keptDefault = storage?.getItem(ThemeDefaultStorageKey)
    const picked = keptDefault ? color !== keptDefault : !legacyDefaults.includes(color)
    return picked ? color : defaultColor
}

/**
 * Keeps the colour mode with the default of now, for {@link readThemeColor}
 * @param storage - `localStorage`, or undefined where the page has none
 * @param color - the colour mode
 * @param defaultColor - the default of now ({@link defaultThemeColor})
 */
export function writeThemeColor(storage: Pick<Storage, 'setItem'> | undefined, color: ThemeColors, defaultColor: ThemeColors) {
    storage?.setItem(ThemeStorageKey, color)
    storage?.setItem(ThemeDefaultStorageKey, defaultColor)
}
