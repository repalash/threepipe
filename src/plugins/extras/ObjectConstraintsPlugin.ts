import {AViewerPluginEventMap, AViewerPluginSync, ThreeViewer} from '../../viewer'
import {IMaterial, IObject3D, IObject3DEventMap} from '../../core'
import {basicObjectConstraints, ConstraintPropsType, TConstraintPropsType} from './helpers/BasicObjectConstraints'
import {getOrCall, onChange, serializable, serialize} from 'ts-browser-helpers'
import {generateUiConfig, uiDropdown, uiFolderContainer, uiInput, UiObjectConfig, uiSlider, uiToggle} from 'uiconfig.js'
import {generateUUID} from '../../three'
import type {AnimationObjectPlugin} from '../animation/AnimationObjectPlugin'

export type ObjectConstraintsPluginEventMap = AViewerPluginEventMap

/**
 * Object Constraints Plugin
 *
 * Create sophisticated object relationships and behaviors using simple constraint-based animation system inspired by Blender's constraints.
 *
 * The ObjectConstraintsPlugin provides a powerful constraint system that allows objects to automatically follow, copy, or respond to other objects' transformations and properties. This enables complex animations and interactive behaviors without manual keyframe animation.
 */
@uiFolderContainer('Object Constraints')
export class ObjectConstraintsPlugin extends AViewerPluginSync<ObjectConstraintsPluginEventMap> {
    public static readonly PluginType = 'ObjectConstraintsPlugin'

    @uiToggle()
    @serialize()
        enabled = true

    dependencies = []

    constructor(enabled = true) {
        super()
        this.enabled = enabled
    }

    addConstraint<T extends TConstraintPropsType = TConstraintPropsType>(obj: IObject3D, constraintOrType?: ObjectConstraint<T> | T, target?: string | IObject3D) {
        const constraint = typeof constraintOrType === 'string' ?
            new ObjectConstraint<T>(constraintOrType) :
            constraintOrType || new ObjectConstraint<T>()
        if (!obj.userData.constraints) {
            obj.userData.constraints = []
        }
        if (target) {
            if (typeof target === 'string') constraint.target = target
            else constraint.target = target.uuid
        }
        if (!obj.userData.constraints.includes(constraint)) {
            obj.userData.constraints.push(constraint)
            this._registerConstraint(constraint, obj)
            obj.setDirty({change: 'userData.constraints', source: 'ObjectConstraintsPlugin.addConstraint'})
        }

        return constraint
    }

    removeConstraint(obj: IObject3D, constraint: ObjectConstraint) {
        if (!obj.userData.constraints) return
        const index = obj.userData.constraints.indexOf(constraint)
        if (index !== -1) {
            obj.userData.constraints.splice(index, 1)
            this._unregisterConstraint(constraint, obj)
            obj.setDirty({change: 'userData.constraints', source: 'ObjectConstraintsPlugin.addConstraint'})
        }
    }

    private _objectAdd = (e: {object?: IObject3D})=>{
        const obj = e.object
        if (!obj) return
        if (obj.isWidget) return
        if (Array.isArray(obj.userData.constraints)) {
            obj.userData.constraints.forEach(ao=> this._registerConstraint(ao, obj))
        }
        this._setupUiConfig(obj)
        // refresh target refs for all registered constraints that have target == obj.uuid
        this._constraints.keys().forEach(c=>{
            if (c?.target === obj.uuid) this._refreshConstraint(c, obj)
        })

    }

    private _objectRemove = (e: {object?: IObject3D})=>{
        const obj = e.object
        if (!obj) return
        if (Array.isArray(obj.userData.constraints)) {
            obj.userData.constraints.forEach(ao=> this._unregisterConstraint(ao, obj))
        }
        this._cleanUpUiConfig(obj)
        // remove target obj references from constraints
        this._constraintTargets.get(obj)?.forEach(c=>this._refreshConstraint(c, null))
    }

    private _constraints: Map<ObjectConstraint, {
        obj: IObject3D,
        target?: IObject3D
    }> = new Map()

    private _constraintTargets: Map<IObject3D, Set<ObjectConstraint>> = new Map()
    private _constraintObjects: Map<IObject3D, Set<ObjectConstraint>> = new Map()

    private _objectUpdate = (e: IObject3DEventMap['objectUpdate'])=>{
        this._constraintTargets.get(e.object)?.forEach(constraint => {
            constraint.setDirty(e, true)
        })
        this._constraintObjects.get(e.object)?.forEach(constraint => {
            constraint.setDirty(e, false)
        })
    }

    private _refreshConstraint(constraint: ObjectConstraint, targetObj?: IObject3D | null) {
        const data = this._constraints.get(constraint)
        if (!data) return
        const target = targetObj !== undefined ? targetObj ?? undefined : this._viewer?.object3dManager.findObject(constraint.target)
        const lastTarget = data.target
        if (target !== lastTarget) {
            this._removeTarget(lastTarget, constraint)
            this._addTarget(target, constraint)
        }
        data.target = target
    }

    private _registerConstraint(constraint: ObjectConstraint, obj: IObject3D) {
        if (this._constraints.has(constraint)) {
            this._refreshConstraint(constraint)
            return
        }
        this._constraints.set(constraint, {obj})
        if (!this._constraintObjects.has(obj)) {
            this._constraintObjects.set(obj, new Set())
            // obj.addEventListener('objectUpdate', this._constraintObjectUpdate)
        }
        this._constraintObjects.get(obj)!.add(constraint)
        this._refreshConstraint(constraint)
        constraint.refresh = ()=>this._refreshConstraint(constraint)
        constraint.remove = ()=>this.removeConstraint(obj, constraint)

        const uiConfig = constraint.uiConfig
        const constraintIndex = obj.userData.constraints?.indexOf(constraint) ?? -1
        if (uiConfig && constraintIndex >= 0) {
            const animObjectPlugin = this._viewer?.getPlugin<AnimationObjectPlugin>('AnimationObjectPlugin')
            if (animObjectPlugin) {
                const components = this._animatableComponents(constraint)
                // todo support uuid based deep access, and serialize constraint uuid
                // animObjectPlugin.setupUiConfigButtons(obj, components, 'userData.constraints.' + constraint.uuid + '.props.')

                // direct index for now
                if (components.length)
                    components.forEach(c=>animObjectPlugin.setupUiConfigButton(obj, c, 'userData.constraints.' + constraintIndex.toString() + '.props.')) // todo check if component is in props, right now its fine as only offset is used
            }
        }
    }
    private _unregisterConstraint(constraint: ObjectConstraint, obj: IObject3D) {
        if (!this._constraints.has(constraint)) return
        const data = this._constraints.get(constraint)
        if (data?.obj === obj) {
            this._removeTarget(data.target, constraint)
            const set = this._constraintObjects.get(obj)
            if (set) {
                set.delete(constraint)
                if (set.size === 0) {
                    this._constraintObjects.delete(obj)
                    // obj.removeEventListener('objectUpdate', this._constraintObjectUpdate)
                }
            }
            this._constraints.delete(constraint)
            constraint.refresh = undefined
            const uiConfig = constraint.uiConfig
            if (uiConfig) {
                const animObjectPlugin = this._viewer?.getPlugin<AnimationObjectPlugin>('AnimationObjectPlugin')
                if (animObjectPlugin) {
                    this._animatableComponents(constraint).forEach(c=>animObjectPlugin.cleanupUiConfigButton(c))
                }
            }

            // todo cleanupUiConfigButtons
            // todo remove any associated UI config
        }
    }


    private _animatableComponents(constraint: ObjectConstraint) {
        // only props.offset right now. todo add more
        return constraint?.uiConfig?.children?.flatMap(c=>getOrCall(c))
            .filter(c=>{
                return typeof c === 'object' && c.type === 'number' && c.property[1] === 'offset' && c.property[0] === constraint.props
            }) || []
    }

    private _addTarget(target: IObject3D | undefined, constraint: ObjectConstraint) {
        if (!target) return
        if (!this._constraintTargets.has(target)) {
            // target.addEventListener('objectUpdate', this._constraintTargetUpdate)
            this._constraintTargets.set(target, new Set())
        }
        const set = this._constraintTargets.get(target)
        if (!set!.has(constraint)) {
            set!.add(constraint)
            constraint.setDirty()
        }
    }

    private _removeTarget(lastTarget: IObject3D | undefined, constraint: ObjectConstraint) {
        if (!lastTarget) return
        const set = this._constraintTargets.get(lastTarget)
        if (!set) return
        if (set.has(constraint)) {
            set.delete(constraint)
            constraint.setDirty()
        }
        if (set.size === 0) {
            this._constraintTargets.delete(lastTarget)
            // lastTarget.removeEventListener('objectUpdate', this._constraintTargetUpdate)
        }
    }

    private _setupUiConfig(obj: IObject3D | IMaterial) {
        const type = (obj as IObject3D).isObject3D ? 'objects' : (obj as IMaterial).isMaterial ? 'materials' : undefined
        if (!type) return
        if (!obj.uiConfig) return
        const existing = obj.uiConfig?.children?.find(c => typeof c === 'object' && c.tags?.includes(ObjectConstraintsPlugin.PluginType))
        if (existing) return // todo regenerate?
        obj.uiConfig?.children?.push({
            type: 'folder',
            label: 'Constraints',
            tags: ['constraints', ObjectConstraintsPlugin.PluginType],
            children: [
                ()=>obj.userData.constraints?.map(c=>c.uiConfig),
                {
                    type: 'button',
                    label: 'Add Constraint',
                    onClick: () => {
                        const c = this.addConstraint(obj as any)
                        return ()=> this.removeConstraint(obj as any, c) // undo function
                    },
                },
            ],
        })
    }

    private _cleanUpUiConfig(obj: IObject3D | IMaterial) {
        if (!obj.uiConfig) return
        const existing = obj.uiConfig?.children?.findIndex(c => typeof c === 'object' && c.tags?.includes(ObjectConstraintsPlugin.PluginType))
        if (existing !== undefined && existing >= 0) {
            obj.uiConfig.children?.splice(existing, 1)
        }
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)

        viewer.object3dManager.getObjects().forEach(object=>this._objectAdd({object}))
        viewer.object3dManager.addEventListener('objectAdd', this._objectAdd)
        viewer.object3dManager.addEventListener('objectRemove', this._objectRemove)
        viewer.scene.addEventListener('objectUpdate', this._objectUpdate) // all events bubble to the scene

        // this._setupUiConfig(viewer.scene)
    }

    onRemove(viewer: ThreeViewer) {
        super.onRemove(viewer)

        viewer.object3dManager.removeEventListener('objectAdd', this._objectAdd)
        viewer.object3dManager.removeEventListener('objectRemove', this._objectRemove)
        viewer.scene.removeEventListener('objectUpdate', this._objectUpdate)
        viewer.object3dManager.getObjects().forEach(object=>this._objectRemove({object}))

        // this._cleanUpUiConfig(viewer.scene)
    }

    protected _viewerListeners = {
        preFrame: ()=>{
            if (this.isDisabled()) return
            // todo use time, deltaTime to see if we should progress
            // const delta = this._viewer?.timeline.delta || 0
            // console.log(delta, this._viewer?.timeline.running)
            if (this._viewer?.timeline.running && this._viewer.timeline.delta === 0) return

            const updated = this._constraints.keys().filter(c=>c.needsUpdate)
            let hasUpdate = false
            updated.forEach(u=>{
                const data = this._constraints.get(u)
                if (!data) return
                const res = u.update(data)
                hasUpdate = hasUpdate || res
            })
            if (hasUpdate) {
                // this.dispatchEvent({
                //     type: '',
                // })
                // console.log('constraints updated')
            }
        },
    }

    static ConstraintTypes = basicObjectConstraints

}


@serializable('ObjectConstraint')
// @uiFolderContainer('Constraint')
export class ObjectConstraint<T extends TConstraintPropsType = TConstraintPropsType> {
    uuid = generateUUID()

    @serialize()
    @uiToggle()
        enabled = true

    @serialize()
    @onChange('typeChanged')
    @uiDropdown(undefined, Object.keys(basicObjectConstraints).map(label => ({label})))
        type: T

    @serialize()
    @onChange('refresh2')
    @uiInput()
        target = ''

    @serialize()
    @uiSlider(undefined, [0, 1], 0.01)
        influence = 1

    @serialize()
        props: ConstraintPropsType<T> = {}

    constructor(type?: T) {
        this.type = type ?? 'copy_position' as T
        this.props = basicObjectConstraints[this.type]?.defaultProps || {}
        if (!this.props) {
            // console.warn(`No default props defined for constraint type: ${this.type}`)
            this.props = {}
        }
    }

    update(data: {obj: IObject3D, target?: IObject3D}) {
        const tp = basicObjectConstraints[this.type as keyof typeof basicObjectConstraints]
        const res = tp?.update(data.obj, data.target, this.props, this.influence)
        if (res?.changed && res.change) {
            data.obj.setDirty({change: res.change, source: this.uuid})
        }
        this.needsUpdate = !(res.end ?? true)
        return res?.changed || false
    }

    needsUpdate = false
    setDirty = (e?: IObject3DEventMap['objectUpdate'], isTarget?: boolean) => {
        if (this.needsUpdate || e?.source === this.uuid) return
        // console.warn(e?.key)
        if (typeof e !== 'object') e = undefined
        if (e) {
            const tp = basicObjectConstraints[this.type as keyof typeof basicObjectConstraints]
            if (e.key && /.props\..+$/.test(e.key)) // if some prop is updated. this check is specifically for AnimationObject right now.
                this._propsUi.forEach(p=>p?.uiRefresh?.())
            else if (tp?.setDirty) {
                if (!tp.setDirty(e, isTarget)) return false
            }
        }
        this.needsUpdate = true
        return true
    }
    // @uiButton()
    refresh?: () => void

    remove?: () => void

    refresh2 = () => {
        this.refresh && this.refresh()
        this.setDirty()
    }

    typeChanged() {
        const oldProps = this.props
        this.props = basicObjectConstraints[this.type]?.defaultProps || {}
        // todo improve merge. like it wont work with vectors right now. For that we need to check if primitive type is the same and/or call the .copy() function
        for (const key of Object.keys(this.props)) {
            if (oldProps[key] !== undefined) {
                const type1 = typeof this.props[key]
                const type2 = typeof oldProps[key]
                if (type1 === type2 && (typeof type1 !== 'object' || (type1 as any)?.type && (type1 as any).type === (type2 as any)?.type)) {
                    this.props[key] = oldProps[key]
                }
            }
        }
        this._propsUi = []
        this.setDirty()
        this.uiConfig?.uiRefresh?.(true, 'postFrame', 1)
    }

    private _propsUi: any[] = []

    uiConfig: UiObjectConfig = {
        type: 'folder',
        label: () => this.type || 'Constraint',
        tags: ['constraint', ObjectConstraintsPlugin.PluginType],
        onChange: this.setDirty,
        children: [
            ...generateUiConfig(this),
            () => {
                if (this._propsUi.length) {
                    this._propsUi.forEach(p=>p.uiRefresh?.(true))
                    return this._propsUi
                }
                const c = generateUiConfig(this.props)
                    .map(c1 => getOrCall(c1))
                this._propsUi = c
                return c
            },
            {
                type: 'button',
                property: [this, 'remove'],
            },
        ],
    }
}

declare module '../../assetmanager/IAssetImporter'{
    export interface IImportResultUserData{
        constraints?: ObjectConstraint[]
    }
}
