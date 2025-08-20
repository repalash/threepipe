import {EventListener2, Quaternion, Vector3} from 'three'
import {AViewerPluginSync, ThreeViewer} from '../../viewer'
import {UiObjectConfig} from 'uiconfig.js'
import {PopmotionPlugin} from './PopmotionPlugin'
import {IObject3D, IScene, ISceneEventMap} from '../../core'

// todo make a serializable object like CameraView for proper ui state management
export interface TSavedTransform {
    position: Vector3
    quaternion: Quaternion
    scale: Vector3
    name?: string
}

/**
 * Transform Animation Plugin
 *
 * Helper plugin to save, load and animate between different transforms(position, rotation, scale) on objects.
 * Also adds a UI to add and animate transforms on objects.
 * Requires the PopmotionPlugin to animate.
 *
 * @category Plugins
 */
export class TransformAnimationPlugin extends AViewerPluginSync {
    public static readonly PluginType = 'TransformAnimationPlugin'
    toJSON: any = undefined

    enabled = true
    dependencies = [PopmotionPlugin]

    constructor() {
        super()
    }

    onAdded(viewer: ThreeViewer): void {
        super.onAdded(viewer)
        // todo use object3dmanager here instead of addSceneObject
        viewer.scene.addEventListener('addSceneObject', this._addSceneObject)
    }
    onRemove(viewer: ThreeViewer): void {
        viewer.scene.removeEventListener('addSceneObject', this._addSceneObject)
        return super.onRemove(viewer)
    }
    private _addSceneObject: EventListener2<'addSceneObject', ISceneEventMap, IScene> = (e)=>{
        const object = e.object
        object?.traverse && !object.isWidget && object.traverse((o: IObject3D)=>{
            if (o.isWidget) return
            // if (!o.userData[TransformAnimationPlugin.PluginType].transforms) {
            //     o.userData[TransformAnimationPlugin.PluginType].transforms = []
            // }

            // for old files, todo remove later
            o.userData[TransformAnimationPlugin.PluginType]?.transforms?.forEach((t, i)=>{
                if (t.name === undefined) t.name = 'Transform ' + i
            })

            const uiConfig: UiObjectConfig = {
                type: 'folder',
                label: 'Transform Animation',
                children: [
                    {
                        type: 'button',
                        label: 'Add Current Transform',
                        value: ()=>{
                            this.addTransform(o)
                            uiConfig?.uiRefresh?.()
                        },
                    },
                    ()=>o.userData[TransformAnimationPlugin.PluginType]?.transforms.map((t: TSavedTransform, i: number)=>({
                        type: 'folder',
                        label: t.name || `Transform ${i}`,
                        children: [
                            {
                                type: 'input',
                                label: 'Name',
                                property: [t, 'name'],
                            },
                            {
                                type: 'vec3',
                                label: 'Position',
                                property: [t, 'position'],
                            },
                            {
                                type: 'vec3',
                                label: 'Quaternion',
                                property: [t, 'quaternion'],
                            },
                            {
                                type: 'vec3',
                                label: 'Scale',
                                property: [t, 'scale'],
                            },
                            {
                                type: 'button',
                                label: 'Set',
                                value: ()=>{
                                    this.setTransform(o, t)
                                },
                            },
                            {
                                type: 'button',
                                label: 'Animate',
                                value: ()=>{
                                    this.animateTransform(o, t)
                                },
                            }],
                    })),
                ],
            }
            o.uiConfig?.children?.push(uiConfig) // todo check if already exists
        })
    }

    addTransform(o: IObject3D, name?: string) {
        if (!o.userData[TransformAnimationPlugin.PluginType]) {
            o.userData[TransformAnimationPlugin.PluginType] = {
                transforms: [] as TSavedTransform[],
            }
        }
        const transform = {
            name: name || 'Transform ' + (o.userData[TransformAnimationPlugin.PluginType]!.transforms.length + 1),
            position: o.position.clone(),
            quaternion: o.quaternion.clone(),
            scale: o.scale.clone(),
        }
        o.userData[TransformAnimationPlugin.PluginType]!.transforms.push(transform)
        return transform
    }

    setTransform(o: IObject3D, tr: TSavedTransform|number|string) {
        const t = this.getSavedTransform(tr, o)
        if (!t) return
        o.position.copy(t.position)
        o.quaternion.copy(t.quaternion)
        o.scale.copy(t.scale)
        o.setDirty?.()
        o.uiConfig?.uiRefresh?.()
    }

    getSavedTransform(tr: TSavedTransform | number | string, o: IObject3D) {
        return typeof tr === 'number' ?
            o.userData[TransformAnimationPlugin.PluginType]?.transforms[tr] :
            typeof tr === 'string' ?
                o.userData[TransformAnimationPlugin.PluginType]?.transforms.find(t1 => t1.name === tr) :
                tr
    }

    animateTransform(o: IObject3D, tr: TSavedTransform|number|string, duration = 2000) {
        const popmotion = this._viewer?.getPlugin(PopmotionPlugin)
        if (!popmotion) {
            this._viewer?.console.error('PopmotionPlugin required for animation')
        }
        const t = this.getSavedTransform(tr, o)
        if (!t) return
        // todo stop all existing animations(for the current model) like CameraView?
        const pos = new Vector3()
        const q = new Quaternion()
        const s = new Vector3()
        const op = o.position.clone()
        const oq = o.quaternion.clone()
        const os = o.scale.clone()
        const ep = t.position
        const eq = t.quaternion
        const es = t.scale
        return popmotion?.animate({
            from: 0,
            to: 1,
            duration: duration,
            onUpdate: (v: number) => {
                pos.lerpVectors(op, ep, v)
                q.slerpQuaternions(oq, eq, v)
                s.lerpVectors(os, es, v)
                o.position.copy(pos)
                o.quaternion.copy(q)
                o.scale.copy(s)
                this._viewer?.setDirty()
                this._viewer?.renderManager.resetShadows()
                // o.setDirty?.()
                // o.uiConfig?.uiRefresh?.()
            },
            onStop: () => {
                o.position.copy(t.position)
                o.quaternion.copy(t.quaternion)
                o.scale.copy(t.scale)
                o.setDirty?.()
                o.uiConfig?.uiRefresh?.()
            },
        })
    }
}

declare module '../../core/IObject' {
    interface IObject3DUserData {
        [TransformAnimationPlugin.PluginType]?: {
            transforms: TSavedTransform[]
        }
    }
}
