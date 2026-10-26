import {BoxGeometry, CylinderGeometry, Group2, Mesh, PhysicalMaterial, SphereGeometry, ThreeViewer, TorusGeometry} from 'threepipe'

/** A small jewellery scene with nested groups, to try the selection rules on */
export function buildScene(viewer: ThreeViewer) {
    const gold = new PhysicalMaterial({color: '#e8c372', metalness: 1, roughness: 0.22})
    const white = new PhysicalMaterial({color: '#dfe3e8', metalness: 1, roughness: 0.18})
    const gem = new PhysicalMaterial({color: '#a9dcff', metalness: 0.2, roughness: 0.04})
    const ruby = new PhysicalMaterial({color: '#d2304f', metalness: 0.2, roughness: 0.05})
    const pearl = new PhysicalMaterial({color: '#f4efe6', metalness: 0, roughness: 0.32})
    const paper = new PhysicalMaterial({color: '#e25c5c', metalness: 0, roughness: 0.6})
    const ribbon = new PhysicalMaterial({color: '#f2c94c', metalness: 0.1, roughness: 0.45})
    const leather = new PhysicalMaterial({color: '#5b4636', metalness: 0, roughness: 0.7})
    const plaster = new PhysicalMaterial({color: '#fafafa', metalness: 0, roughness: 0.8})

    const mesh = (name: string, g: any, m: PhysicalMaterial, p: [number, number, number] = [0, 0, 0], r?: [number, number, number]) => {
        const o = new Mesh(g, m)
        o.name = name
        o.position.set(...p)
        if (r) o.rotation.set(...r)
        return o
    }
    const group = (name: string, p: [number, number, number], ...children: any[]) => {
        const g = new Group2()
        g.name = name
        g.position.set(...p)
        g.add(...children)
        return g
    }

    // Ring > Band, Head > (Gem > Crown, Pavilion), Prongs > Prong 1-4, Gallery
    const prongs = [0, 1, 2, 3].map(i => {
        const a = i / 4 * Math.PI * 2 + Math.PI / 4
        return mesh(`Prong ${i + 1}`, new CylinderGeometry(0.035, 0.05, 0.62, 12), white, [Math.cos(a) * 0.33, 0.12, Math.sin(a) * 0.33], [Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25])
    })
    const ring = group('Solitaire Ring', [0, 0, 0],
        mesh('Band', new TorusGeometry(1, 0.12, 32, 128), gold, [0, 1.12, 0]),
        group('Head', [0, 2.32, 0],
            group('Gem', [0, 0.2, 0],
                mesh('Crown', new CylinderGeometry(0.26, 0.4, 0.14, 16), gem, [0, 0.07, 0]),
                mesh('Pavilion', new CylinderGeometry(0.4, 0.01, 0.42, 16), gem, [0, -0.21, 0]),
            ),
            group('Prongs', [0, 0, 0], ...prongs),
            mesh('Gallery', new TorusGeometry(0.3, 0.04, 12, 48), white, [0, -0.08, 0], [Math.PI / 2, 0, 0]),
        ),
    )

    const stud = (name: string, x: number) => group(name, [x, 0, 0],
        mesh('Pearl', new SphereGeometry(0.36, 32, 16), pearl, [0, 0.62, 0]),
        mesh('Cup', new SphereGeometry(0.18, 24, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), gold, [0, 0.36, 0]),
        mesh('Post', new CylinderGeometry(0.03, 0.03, 0.3, 8), gold, [0, 0.15, 0]),
    )
    const earrings = group('Pearl Earrings', [4, 0, 0.5], stud('Left Stud', -0.6), stud('Right Stud', 0.6))

    const drop = mesh('Drop', new SphereGeometry(0.45, 32, 16), ruby, [0, 0.62, 0])
    drop.scale.set(1, 1.35, 1)
    const pendant = group('Ruby Pendant', [-4, 0, 0.5],
        drop,
        mesh('Bail', new TorusGeometry(0.16, 0.04, 12, 32), gold, [0, 1.36, 0]),
        group('Chain', [0, 0, 0], ...Array.from({length: 6}, (_, i) =>
            mesh(`Link ${i + 1}`, new TorusGeometry(0.12, 0.025, 8, 24), gold, [0, 1.62 + i * 0.2, 0], [0, i % 2 ? Math.PI / 2 : 0, 0]))),
    )

    const gift = group('Gift Box', [0, 0, -4.5],
        mesh('Base', new BoxGeometry(2, 1.2, 2), paper, [0, 0.6, 0]),
        group('Lid', [0, 1.3, 0],
            mesh('Lid Top', new BoxGeometry(2.1, 0.22, 2.1), paper),
            mesh('Bow', new TorusGeometry(0.28, 0.07, 12, 32), ribbon, [0, 0.34, 0]),
        ),
        mesh('Ribbon X', new BoxGeometry(2.04, 1.25, 0.22), ribbon, [0, 0.62, 0]),
        mesh('Ribbon Z', new BoxGeometry(0.22, 1.25, 2.04), ribbon, [0, 0.62, 0]),
    )

    // like an imported glTF: Scene > root > Watch (wrappers are merged into one level)
    const watch = group('Scene', [4.5, 0, -4.5], group('root', [0, 0, 0], group('Watch', [0, 0, 0],
        mesh('Case', new CylinderGeometry(0.9, 0.9, 0.3, 48), white, [0, 0.25, 0]),
        mesh('Dial', new CylinderGeometry(0.8, 0.8, 0.02, 48), plaster, [0, 0.41, 0]),
        mesh('Crown', new CylinderGeometry(0.12, 0.12, 0.2, 16), white, [1.0, 0.25, 0], [0, 0, Math.PI / 2]),
        mesh('Strap', new BoxGeometry(0.9, 0.1, 3.6), leather, [0, 0.05, 0]),
    )))

    const stand = mesh('Display Stand', new CylinderGeometry(1.1, 1.3, 0.5, 48), plaster, [-4.5, 0.25, -4.5])

    for (const o of [ring, earrings, pendant, gift, watch, stand]) viewer.scene.addObject(o)
}
