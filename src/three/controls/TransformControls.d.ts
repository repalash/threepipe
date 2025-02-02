/* eslint-disable */
import {
    Camera,
    LineBasicMaterial,
    Mesh,
    MeshBasicMaterial,
    MOUSE,
    Object3D,
    Quaternion,
    Raycaster,
    Vector3
} from 'three';


export type TransformControlsMode = "translate" | "rotate" | "scale";

export interface TransformControlsEventMap {
    /**
     * Fires if any type of change (object or property change) is performed. Property changes are separate events you
     * can add event listeners to. The event type is "propertyname-changed".
     */
    change: {};

    /**
     * Fires if a pointer (mouse/touch) becomes active.
     */
    mouseDown: { mode: TransformControlsMode };

    /**
     * Fires if a pointer (mouse/touch) is no longer active.
     */
    mouseUp: { mode: TransformControlsMode };

    /**
     * Fires if the controlled 3D object is changed.
     */
    objectChange: {};

    "camera-changed": { value: unknown };
    "object-changed": { value: unknown };
    "enabled-changed": { value: unknown };
    "axis-changed": { value: unknown };
    "mode-changed": { value: unknown };
    "translationSnap-changed": { value: unknown };
    "rotationSnap-changed": { value: unknown };
    "scaleSnap-changed": { value: unknown };
    "space-changed": { value: unknown };
    "size-changed": { value: unknown };
    "dragging-changed": { value: unknown };
    "showX-changed": { value: unknown };
    "showY-changed": { value: unknown };
    "showZ-changed": { value: unknown };
    "minX-changed": { value: unknown };
    "maxX-changed": { value: unknown };
    "minY-changed": { value: unknown };
    "maxY-changed": { value: unknown };
    "minZ-changed": { value: unknown };
    "maxZ-changed": { value: unknown };
    "worldPosition-changed": { value: unknown };
    "worldPositionStart-changed": { value: unknown };
    "worldQuaternion-changed": { value: unknown };
    "worldQuaternionStart-changed": { value: unknown };
    "cameraPosition-changed": { value: unknown };
    "cameraQuaternion-changed": { value: unknown };
    "pointStart-changed": { value: unknown };
    "pointEnd-changed": { value: unknown };
    "rotationAxis-changed": { value: unknown };
    "rotationAngle-changed": { value: unknown };
    "eye-changed": { value: unknown };
}

export class TransformControls extends Object3D<TransformControlsEventMap> {
    constructor(object: Camera, domElement?: HTMLElement);

    domElement: HTMLElement;

    // API

    camera: Camera;
    object: Object3D | undefined;
    enabled: boolean;
    axis: 'X' | 'Y' | 'Z' | 'E' | 'XY' | 'YZ' | 'XZ' | 'XYZ' | 'XYZE' | null;
    mode: 'translate' | 'rotate' | 'scale';
    translationSnap: number | null;
    rotationSnap: number | null;
    space: 'world' | 'local';
    size: number;
    dragging: boolean;
    showX: boolean;
    showY: boolean;
    showZ: boolean;
    readonly isTransformControls: true;
    mouseButtons: { LEFT: MOUSE; MIDDLE: MOUSE; RIGHT: MOUSE };

    attach(object: Object3D): this;
    detach(): this;
    getMode(): 'translate' | 'rotate' | 'scale';
    getRaycaster(): Raycaster;
    setMode(mode: 'translate' | 'rotate' | 'scale'): void;
    setTranslationSnap(translationSnap: number | null): void;
    setRotationSnap(rotationSnap: number | null): void;
    setScaleSnap(scaleSnap: number | null): void;
    setSize(size: number): void;
    setSpace(space: 'world' | 'local'): void;
    reset(): void;
    dispose(): void;


    static ObjectConstructors: {
        MeshBasicMaterial: typeof MeshBasicMaterial;
        LineBasicMaterial: typeof LineBasicMaterial;
    }
}

export class TransformControlsGizmo extends Object3D {
    type: 'TransformControlsGizmo';
    isTransformControlsGizmo: true;

    gizmo: {
        translate: Object3D;
        rotate: Object3D;
        scale: Object3D;
    };
    helper: {
        translate: Object3D;
        rotate: Object3D;
        scale: Object3D;
    };
    picker: {
        translate: Object3D;
        rotate: Object3D;
        scale: Object3D;
    };

    constructor();
}

export class TransformControlsPlane extends Mesh {
    type: 'TransformControlsPlane';
    isTransformControlsPlane: true;

    constructor();

    mode: 'translate' | 'scale' | 'rotate';

    axis: 'X' | 'Y' | 'Z' | 'XY' | 'YZ' | 'XZ' | 'XYZ' | 'E';

    space: 'local' | 'world';

    eye: Vector3;
    worldPosition: Vector3;
    worldQuaternion: Quaternion;
}
