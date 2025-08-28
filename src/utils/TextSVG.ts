import {embedUrlRefs, parseFileExtension, svgUrl} from 'ts-browser-helpers'
import {uiDropdown, uiFolderContainer, uiInput, UiObjectConfig, uiSlider, uiToggle} from 'uiconfig.js'
import {IAssetImporter} from '../assetmanager'
import {LinearFilter} from 'three'
import {ITexture} from '../core'
import {DataUrlLoader} from '../assetmanager/import/DataUrlLoader'

export interface ITextSVGOptions{
    text: string;
    fontFamily?: string;
    fontPath?: string;
    svgBackground?: string;
    xOffset?: number; yOffset?: number;
    width?: number; height?: number;
    boxWidth?: number; boxHeight?: number;
    fontSize?: number;
    fontWeight?: string | number;
    fontStyle?: 'normal' | 'italic' | 'oblique';
    lineHeight?: string | number;
    letterSpacing?: string | number;
    whiteSpace?: 'normal' | 'pre' | 'nowrap' | 'pre-wrap' | 'pre-line';
    direction?: 'auto' | 'ltr' | 'rtl';
    maskText?: boolean; innerShadow?: boolean;
    bgFillColor?: string;
    textColor?: string;
    textAnchor?: 'start' | 'middle' | 'end';
    style?: string;
}

const onOpsChange = (ctx: TextSVGOptions)=>({
    onChange: (ev: any)=>{
        if (!ev.last) return
        ctx.onChange()
    },
})

@uiFolderContainer('Text SVG Options')
export class TextSVGOptions implements ITextSVGOptions {
    @uiInput('Text', onOpsChange) text = 'Custom Text'
    @uiSlider('Font Size', [2, 1024], 1, onOpsChange) fontSize = 100
    @uiSlider('Width', [2, 4096], 1, onOpsChange) width = 1024
    @uiSlider('Height', [2, 4096], 1, onOpsChange) height = 1024
    @uiSlider('X Offset', [-1024, 1024], 1, onOpsChange) xOffset = 0
    @uiSlider('Y Offset', [-1024, 1024], 1, onOpsChange) yOffset = 0
    @uiSlider('V-Width', [2, 4096], 1, onOpsChange) boxWidth = 1024
    @uiSlider('V-Height', [2, 4096], 1, onOpsChange) boxHeight = 1024
    @uiDropdown('Text Anchor', ['start', 'middle', 'end'].map(label=>({label} as UiObjectConfig)), onOpsChange) textAnchor: 'start'|'middle'|'end' = 'middle'
    @uiInput('Font', onOpsChange) fontFamily = ''
    @uiInput('Font Url', onOpsChange) fontPath = ''
    @uiInput('Font Weight', onOpsChange) fontWeight: string | number = 'normal'
    @uiDropdown('Font Style', ['normal', 'italic', 'oblique'].map(label=>({label} as UiObjectConfig)), onOpsChange) fontStyle: 'normal'|'italic'|'oblique' = 'normal'
    @uiInput('Line Height', onOpsChange) lineHeight: string | number = 'normal'
    @uiInput('Letter Spacing', onOpsChange) letterSpacing: string | number = 'normal'
    @uiDropdown('White Space', ['normal', 'pre', 'nowrap', 'pre-wrap', 'pre-line'].map(label=>({label} as UiObjectConfig)), onOpsChange) whiteSpace: 'normal'|'pre'|'nowrap'|'pre-wrap'|'pre-line' = 'normal'
    @uiDropdown('Direction', ['auto', 'ltr', 'rtl'].map(label=>({label} as UiObjectConfig)), onOpsChange) direction: 'ltr'|'rtl' = 'ltr'
    @uiToggle('Mask Text', onOpsChange) maskText = false
    @uiToggle('Inner Shadow', onOpsChange) innerShadow = false
    @uiInput('Text Color', onOpsChange) textColor = '#000000'
    @uiInput('BG Fill', onOpsChange) bgFillColor = '#ffffff'
    @uiInput('SVG BG', onOpsChange) svgBackground = '#ffffff'

    onChange = ()=>{return}
    set(ops: ITextSVGOptions) {
        Object.assign(this, ops)
    }
    reset() {
        const oc = this.onChange
        Object.assign(this, new TextSVGOptions())
        this.onChange = oc
    }
    toJSON() {
        return {
            text: this.text,
            fontFamily: this.fontFamily,
            fontPath: this.fontPath,
            svgBackground: this.svgBackground,
            width: this.width,
            height: this.height,
            xOffset: this.xOffset,
            yOffset: this.yOffset,
            boxWidth: this.boxWidth,
            boxHeight: this.boxHeight,
            fontSize: this.fontSize,
            fontWeight: this.fontWeight,
            fontStyle: this.fontStyle,
            lineHeight: this.lineHeight,
            letterSpacing: this.letterSpacing,
            whiteSpace: this.whiteSpace,
            direction: this.direction,
            maskText: this.maskText,
            innerShadow: this.innerShadow,
            bgFillColor: this.bgFillColor,
            textColor: this.textColor,
            textAnchor: this.textAnchor,
        }
    }
    declare uiConfig: UiObjectConfig
}

export const fontFormatExtensionMap: any = {
    'woff': 'woff',
    'woff2': 'woff2',
    'ttf': 'truetype',
    'otf': 'opentype',
    'eot': 'embedded-opentype',
}

export function buildTextSvg({
    text = 'Custom Text',
    svgBackground = '#ffffff',
    xOffset = 0, yOffset = 0,
    width = 1024, height = 1024,
    boxWidth = 1024, boxHeight = 1024,
    fontFamily = '', fontSize = 32,
    fontWeight = 'normal',
    fontStyle = 'normal',
    lineHeight = 'normal',
    letterSpacing = 'normal',
    whiteSpace = 'normal',
    direction = 'auto',
    maskText = false, innerShadow = false,
    bgFillColor = '#000000', textColor = '#ffffff',
    textAnchor = 'middle',
    style = '',
}: ITextSVGOptions) {
    const s = `
<svg style="background-color:${svgBackground}" width="${width}" height="${height}" viewBox="0 0 ${boxWidth} ${boxHeight}"
 xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
     <defs>
        <style>
        ${style}
        .text-g{
            overflow:hidden; text-anchor: ${textAnchor}; 
            font-size: ${fontSize}px; 
            font-family: ${JSON.stringify(fontFamily || 'Arial')};
            font-weight: ${fontWeight};
            font-style: ${fontStyle};
            line-height: ${lineHeight};
            letter-spacing: ${letterSpacing};
            white-space: ${whiteSpace};
            direction: ${direction};
        }
        </style>
    </defs>

    <g class="text-g">
        <defs>

` + (maskText ? `
<mask id="textMask">
<text style="fill:white; font-size: ${fontSize}px; font-weight: ${fontWeight}; font-style: ${fontStyle}; line-height: ${lineHeight}; letter-spacing: ${letterSpacing}; white-space: ${whiteSpace}; direction: ${direction};" x="${xOffset + boxWidth / 2}" y="${boxHeight / 2 + yOffset + fontSize / 4}" > ${text} </text>
</mask>
` : '') + `

` + (innerShadow ? `
<filter id="innerShadow" x="-20%" y="-20%" width="140%" height="140%">
<feGaussianBlur in="SourceGraphic" stdDeviation="0.5" result="blur"/>
<feOffset in="blur" dx="1.5" dy="1.5"/>
</filter>
` : '') + `

        </defs>

` + (maskText ? `
        <g mask="url(#textMask)">
` : '') + `

        <rect x="0" y="0" width="${boxWidth}" height="${boxHeight}" style="fill:${bgFillColor}"/>
        <text style="${innerShadow ? 'filter: url(#innerShadow);' : ''} fill:${textColor}; font-weight: ${fontWeight}; font-style: ${fontStyle}; line-height: ${lineHeight}; letter-spacing: ${letterSpacing}; white-space: ${whiteSpace}; direction: ${direction};" x="${xOffset + boxWidth / 2}" y="${boxHeight / 2 + yOffset + fontSize / 4}"> ${text} </text>

` + (maskText ? `
        </g>
` : '') + `

    </g>
</svg>
`
    return s
}

/**
 * List of font names and paths to font files.
 */
const fonts: Record<string, string> = {
    roboto: 'https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Mu4mxKKTU1Kg.woff2',
}

export async function makeTextSvgAdvanced(options: ITextSVGOptions, importer: IAssetImporter) {
    const fontFamily = options.fontFamily || 'Arial'
    let fontPath = options.fontPath || fonts[fontFamily] || ''
    let style = options.style || ''
    if (fontPath.length > 0) {
        if (!fontPath.startsWith('http:') && !fontPath.startsWith('https:') && !fontPath.startsWith('data:') && !fontPath.startsWith('blob:') && !fontPath.startsWith('ftp:') && globalThis.window) {
            // assume relative path to current url window.location
            const url = new URL(fontPath, window.location.href)
            fontPath = url.href
        }
        const fontExt = parseFileExtension(fontPath) || 'woff'
        style += '\n' +
            (fontPath.length > 0 ? `
            @font-face {
                font-family: ${JSON.stringify(fontFamily)};
                src: url(${fontPath}) format(${fontFormatExtensionMap[fontExt] || fontExt});
            }` : '')
    }
    let svg = buildTextSvg({
        ...options,
        fontFamily,
        style,
    })
    svg = await embedUrlRefs(svg, async(p)=>getAssetData(p, importer))
    svg = svgUrl(svg)
    // const svgTex = await new SVGTextureLoader().loadAsync(svg)
    const svgTex = await importer.importSingle<ITexture>(svg)
    if (!svgTex) return null
    svgTex.generateMipmaps = false
    svgTex.minFilter = LinearFilter
    // svgTex._isSVGTexture = true
    svgTex.flipY = true
    svgTex.needsUpdate = true
    return svgTex
}

const assetLoadOptions = undefined

async function getAssetData(path: string, importer: IAssetImporter) {
    if (path.startsWith('http://www.w3.org')) return path

    if (!importer) throw new Error('no importer')
    const assetLoadOptions1 = assetLoadOptions || {
        fileHandler: new DataUrlLoader(importer.loadingManager),
        processRaw: false,
    }
    try {
        const assetData = (await importer.importSingle(path, assetLoadOptions1)) as any as string
        // console.log(asset, assetData, JSON.stringify(this.assetLoadOptions1))
        return assetData
    } catch (e) {
        console.error(e)
        return ''
    }
}
