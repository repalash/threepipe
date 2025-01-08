import Stats from 'stats.js'

export class GLStatsJS {
    protected _stats: any = new Stats()
    protected _container: HTMLElement

    constructor(container: HTMLElement) {
        this._container = container
        this._stats.dom.id = 'stats-js'
        this._stats.dom.style.position = 'absolute'
        this._stats.dom.style.left = 'unset'
        this._stats.dom.style.right = '0'

    }

    show() {
        this._container.appendChild(this._stats.dom)
        this._stats.showPanel(0)
    }

    hide() {
        this._container.removeChild(this._stats.dom)
    }

    begin() {
        this._stats.begin()
    }

    end() {
        this._stats.end()
    }
}
