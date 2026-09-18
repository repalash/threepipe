export default async ({run, page, log}) => {
    await run({op: 'delete', object: '*'})
    await run({op: 'primitive', type: 'cylinder', name: 'drum', radius: 0.5, height: 1, segments: 12})
    const out = await page.evaluate(async () => {
        const m = window.modelling, v = window.viewer
        const r = await m.run({op: 'export', format: 'glb', includeData: true})
        const bytes = Uint8Array.from(atob(r.data.base64), c => c.charCodeAt(0))
        const file = new File([bytes], 'topology.glb', {type: 'model/gltf-binary'})
        await m.run({op: 'delete', object: '*'})

        const errors = []
        const orig = console.error
        console.error = (...a) => { errors.push(a.map(String).join(' ')); orig(...a) }
        const obj = await v.load(file, {autoScale: false, autoCenter: false})
        console.error = orig

        const found = []
        v.scene.modelRoot.traverse(o => {
            if (!o.isObject3D) return
            found.push({
                name: o.name, type: o.type, isMesh: !!o.geometry,
                userDataKeys: Object.keys(o.userData || {}),
                gltfExt: Object.keys(o.userData?.gltfExtensions || {}),
                inDoc: !!m.document.find(o.uuid),
            })
        })
        return {loaded: !!obj, docSize: m.document.size, found, errors}
    })
    log(JSON.stringify(out, null, 1).slice(0, 2200))
}
