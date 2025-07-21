import {IPassID, IPipelinePass} from './Pass'
import {includesAll} from 'ts-browser-helpers'

export function sortPasses(ps: IPipelinePass<IPassID>[]) {
    const pipeline: IPassID[] = []

    const dict: Record<IPassID, {after: IPassID[], before: IPassID[], dependencies: Set<IPassID>}> = {}
    for (const pass of ps) {
        if (!pass.passId) continue
        dict[pass.passId] = {
            after: pass.after ?? [],
            before: pass.before ?? [],
            dependencies: new Set(pass.required ?? []),
        }
    }
    for (const [passId, pass] of Object.entries(dict)) {
        const optional = new Set([...pass.after, ...pass.before])
        pass.dependencies.forEach(v => optional.has(v) && optional.delete(v))
        optional.forEach(value => {
            const dPass = dict[value]
            if (!dPass) return
            if (dPass.dependencies.has(passId)) {
                console.error('cyclic', passId, value)
                throw 'Encountered cyclic dependency when sorting passes' // todo better error
            }
            pass.dependencies.add(value)
        })
    }

    // eslint-disable-next-line no-constant-condition
    while (true) {
        let updated = false
        const entries = [...Object.entries(dict)]
        for (const [passId, pass] of entries) {
            if (pipeline.includes(passId)) continue
            if (includesAll(pipeline, pass.dependencies.values())) {
                const afterIndex = Math.max(-1, ...pass.after.map(v => pipeline.indexOf(v)))
                const beforeIndex = Math.min(pipeline.length, ...pass.before.map(v => {
                    const k = pipeline.indexOf(v)
                    return k < 0 ? pipeline.length : k
                }))
                if (afterIndex >= beforeIndex) {
                    console.error(pass, ps, pipeline, afterIndex, beforeIndex)
                    // throw 'Not possible' // todo better error
                    throw 'Unknown error when sorting passes' // todo better error
                }
                pipeline.splice(pass.after.length > 0 ? afterIndex + 1 : beforeIndex, 0, passId)
                // console.log(pipeline, passId, afterIndex, beforeIndex)
                updated = true
                delete dict[passId]
            }
        }
        if (Object.keys(dict).length < 1) break
        if (!updated) {
            console.error(entries, dict, pipeline)
            throw 'Required pass dependency removed unexpectedly' // when some dependency(required) doesnt exist. todo: show better error.
            break
        }
    }
    // console.log('Refreshed Pipeline:', pipeline)
    return pipeline
}
