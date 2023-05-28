import styles from './CustomContextMenu.css'

export class CustomContextMenu {
    public static Element: HTMLDivElement | undefined = undefined
    private static _inited = false

    private static _initialize(): void {
        this._inited = true
        document.addEventListener('pointerdown', (e) => {
            if (this.Element && !this.Element.contains(e.target as any)) {
                this.Remove()
            }
        })
    }

    public static Create(items: Record<string, () => void>, x: number, y: number, show = true, removeOnSelect = true): HTMLDivElement {
        if (!this._inited) this._initialize()

        if (this.Element) this.Remove()

        const container = document.createElement('div')
        container.id = 'customContextMenu'
        container.style.top = y + 'px'
        container.style.left = x + 'px'
        container.innerHTML = '<style>' + styles + '</style>'

        for (const [key, func] of Object.entries(items)) {
            const d = document.createElement('div')
            d.classList.add('customContextMenuItems')
            d.innerHTML = key
            container.appendChild(d)
            d.onclick = async() => {
                await func()
                if (removeOnSelect) this.Remove()
            }
        }

        this.Element = container
        if (show) document.body.appendChild(container)
        return container
    }

    public static Remove(): void {
        this.Element?.remove()
        this.Element = undefined
    }
}
