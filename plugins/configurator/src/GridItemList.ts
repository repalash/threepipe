import {createDiv, createStyles, escapeHtml, mobileAndTabletCheck} from 'ts-browser-helpers'
import tippy from 'tippy.js'
import tippyStyles from 'tippy.js/dist/tippy.css?inline'
import styles from './GridItemList.css?inline'

export interface GridItem {
    id: string
    image: string
    onClick?: (id: string) => void
    tooltip?: string
}
/**
 * Earlier it was called CustomContextGrid.
 * Used to create a overlay of grid items over the canvas allowing users to pick from a list of items.
 */
export class GridItemList {
    public static Elements: HTMLDivElement[] = []
    // private static _inited = false
    private static _container = document.createElement('div')

    private static _initializeStyles(): void {
        // GridItemList._inited = true  // since container is cleared
        createStyles(styles, GridItemList._container)
        createStyles(tippyStyles, GridItemList._container)
        GridItemList._container.id = 'gridItemList'
        GridItemList._container.style.position = 'absolute'
        GridItemList._container.style.top = '0'
        GridItemList._container.style.left = '0'
        GridItemList._container.style.width = '270px'
        GridItemList._container.style.height = '100%'
        GridItemList._container.style.pointerEvents = 'none'
        GridItemList._container.style.zIndex = '100'
        GridItemList._container.style.overflowY = 'auto'
    }

    public static Create<T extends GridItem>(tag: string, title: string, cols: number, x: number, y: number, items: T[], processDiv: (d: HTMLDivElement, item: T, container: HTMLElement) => void): HTMLDivElement {
        // if (!GridItemList._inited) GridItemList._initialize()
        const isMobile = mobileAndTabletCheck()
        const gap = isMobile ? 0.15 : 0.25 // rem
        const itemWidth = isMobile ? 1.5 : 2.5 // rem
        const margin = isMobile ? 1 : 1 // rem

        // if (GridItemList.Element) GridItemList.Remove()

        const container = createDiv({
            classList: ['customContextGrid'], addToBody: false,
            innerHTML: `
            <div class="customContextGridHeading"> ${escapeHtml(title)} </div>
            `,
        })
        container.style.top = y + 'px'
        container.style.left = x + 'px'
        container.style.gap = gap + 'rem'
        container.style.width = (itemWidth + gap) * cols - gap + margin + 'rem' // `calc(${100.0 / cols}%-${gap * cols}rem)`
        container.dataset.tag = tag
        for (const item of items) {
            const d = createDiv({
                classList: ['customContextGridItems'], addToBody: false, innerHTML: `
            <img src=${JSON.stringify(item.image || '')} class="customContextGridItemImage">
            `,
            })
            d.style.width = itemWidth + 'rem'
            d.style.height = itemWidth + 'rem'
            container.appendChild(d)
            d.onclick = () => item.onClick?.(item.id)
            if (item.tooltip) tippy(d, {placement: 'bottom', content: item.tooltip})
            processDiv(d, item, container)
        }

        GridItemList.Elements?.push(container)
        return container
    }

    public static RemoveAll(tag?: string): void {
        if (!tag) {
            for (const element of GridItemList.Elements) element.remove()
            GridItemList.Elements = []
        } else {
            const el = GridItemList.Elements.filter(e => e.dataset.tag === tag)
            for (const element of el) element.remove()
            GridItemList.Elements = GridItemList.Elements.filter(e => e.dataset.tag !== tag)
        }
    }

    public static RebuildUi(parent?: HTMLElement): void {
        if (GridItemList.Elements.length === 0) return
        if (!parent) parent = createDiv({addToBody: true, classList: ['customContextGridParent']})
        for (const element of GridItemList.Elements) element.remove()
        GridItemList._container.innerHTML = ''
        GridItemList._initializeStyles()
        let y = 20
        parent.appendChild(GridItemList._container)
        for (const element of GridItemList.Elements) {
            element.style.top = y + 'px'
            GridItemList._container.appendChild(element)
            y += element.clientHeight + 20
        }
    }
    public static Dispose() {
        GridItemList.RemoveAll()
        GridItemList._container.remove()
        GridItemList._container.innerHTML = ''
    }

}
