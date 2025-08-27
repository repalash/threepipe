import {ThreeElements} from '@react-three/fiber'
import {Children, forwardRef, ReactNode, useMemo} from 'react'
import {suspend} from 'suspend-react'
import {ITextSVGOptions, makeTextSvgAdvanced} from 'threepipe'
import {useViewer} from './ViewerContextInternal.ts'

export type TextPlaneProps = Omit<ThreeElements['mesh'], 'ref'> & {
    children: ReactNode
    font?: string,
    fontSize?: number,
    color: string
    backgroundColor: string
    options: Omit<ITextSVGOptions, 'font'|'fontSize'|'textColor'|'bgFillColor'|'text'>
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export const TextPlane = /* @__PURE__ */ forwardRef(
    (
        {
            font,
            fontSize = 1,
            children,
            color, backgroundColor,
            options,
            ...props
        }: TextPlaneProps,
        ref
    ) => {
        const [, text] = useMemo(() => {
            const n: ReactNode[] = []
            let t = ''
            Children.forEach(children, (child) => {
                if (typeof child === 'string' || typeof child === 'number') {
                    t += child
                } else {
                    n.push(child)
                }
            })
            return [n, t]
        }, [children])

        const viewer = useViewer()
        if (!viewer) return null

        const bs = 1000
        // console.log('here')
        // suspend(async() => new Promise((res) => preloadFont({font, characters}, res)), ['troika-text', font, characters])
        const svgTex = suspend(async() => {
            return await makeTextSvgAdvanced({
                fontSize: bs,
                maskText: false,
                textColor: color ?? '#000000',
                bgFillColor: backgroundColor ?? 'transparent',
                boxHeight: bs,
                boxWidth: bs * (text.length + 1) / 2,
                height: bs,
                width: bs * (text.length + 1) / 2,
                svgBackground: 'transparent',
                fontPath: font,
                fontFamily: font ? 'CustomFont' : undefined,
                ...options,
                text: text,
            }, viewer.assetManager.importer)
        }, ['text-plane', text, fontSize, font])

        return (
            <mesh ref={ref} renderOrder={1} {...props} >
                {children}
                <planeGeometry args={[fontSize * (svgTex?.image.width || bs) / bs, fontSize * (svgTex?.image.height || bs) / bs, 2, 2]}/>
                {/* @ts-expect-error not sure why */}
                <unlitMaterial transparent={true} map={svgTex}/>
            </mesh>
        )
    }
)
