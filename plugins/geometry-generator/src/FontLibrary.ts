import {Font, FontLoader} from 'three/examples/jsm/loaders/FontLoader.js'

export class FontLibrary {
    static FontPaths: Record<string, string> = {
        ['helvetica']: 'https://threejs.org/examples/fonts/helvetiker_regular.typeface.json',
        ['helvetica-bold']: 'https://threejs.org/examples/fonts/helvetiker_bold.typeface.json',
        ['optimer']: 'https://threejs.org/examples/fonts/optimer_regular.typeface.json',
        ['optimer-bold']: 'https://threejs.org/examples/fonts/optimer_bold.typeface.json',
        ['gentilis']: 'https://threejs.org/examples/fonts/gentilis_regular.typeface.json',
        ['gentilis-bold']: 'https://threejs.org/examples/fonts/gentilis_bold.typeface.json',
    }
    static DefaultFont = 'helvetica'
    static Fonts: Record<string, Font> = {}

    static GetFont(name: string): Font {
        if (this.Fonts[name]) return this.Fonts[name]
        return this.Fonts[this.DefaultFont] || new FontLoader().parse({})
    }

    static async LoadFont(name: string): Promise<Font> {
        if (this.Fonts[name]) return this.Fonts[name]
        let path = this.FontPaths[name]
        if (!path) {
            console.error('FontLibrary: Path not found for font:', name, ' using default font instead.', this.DefaultFont)
            if (this.Fonts[this.DefaultFont]) return this.Fonts[this.DefaultFont]
            path = this.FontPaths[this.DefaultFont]
            if (!path) throw new Error('Default font path not found in FontLibrary.')
        }
        this.Fonts[name] = await new FontLoader().loadAsync(path)
        return this.Fonts[name]
    }

    static async AddFont(name: string, path: string, load = true): Promise<void> {
        this.FontPaths[name] = path
        if (load) {
            await this.LoadFont(name)
        }
    }

    static Init
    static {
        this.Init = this.LoadFont(this.DefaultFont).then(()=>{
            this.Fonts[''] = this.Fonts[this.DefaultFont]
        })
    }
}
