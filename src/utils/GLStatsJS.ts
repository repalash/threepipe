import Stats from 'stats.js'

export class GLStatsJS {
    private _stats: Stats = new Stats()

    constructor(private _container: HTMLElement) {
        this._stats.dom.id = 'stats-js'
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
