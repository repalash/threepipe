import * as THREE from 'https://esm.sh/threepipe/dist';

const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 32, 32),
    new THREE.PhysicalMaterial({color: 0xffffff, roughness: 0.1, metalness: 1})
)
sphere.name = 'sphere'
const box = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.5, 1, 32),
    new THREE.PhysicalMaterial({color: 0xffffff, roughness: 0.05, metalness: 1})
)
box.name = 'box'
const colors = {
    box: {
        c: 0xffffff,
        e: 0x000000,
        h: 0xff4444,
        s: 0xaa0000,
    },
    sphere: {
        c: 0xffffff,
        e: 0x000000,
        h: 0x4444ff,
        s: 0x0000aa,
    },
    ground: {
        // c: 0xffffff,
        // h: 0x44ff44,
        // s: 0x00aa00,
    }
}

let intersectObjects = []
let hoveringObject = null
let selectedObject = null
function setHover(object, hover) {
    const color = colors[object.name]?.h
    if(color !== undefined) {
        if (hover) {
            object.material.emissive.set(color)
        } else {
            object.material.emissive.set(colors[object.name].e ?? 0x000000)
        }
    }
    object.material.setDirty()
    hoveringObject = hover ? object : null
}
function setSelect(object, select) {
    const color = colors[object.name]?.s
    if(color !== undefined) {
        if (select) {
            object.material.color.set(color)
        } else {
            object.material.color.set(colors[object.name].c ?? 0xffffff)
        }
    }
    object.material.setDirty()
    selectedObject = select ? object : null
}

const raycaster = new THREE.Raycaster()

function raycast(event, viewer) {
    const rect = viewer.canvas.getBoundingClientRect()
    const mouse = new THREE.Vector2()
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

    raycaster.setFromCamera(mouse, viewer.scene.mainCamera)

    const intersects = raycaster.intersectObjects(intersectObjects, false)
    return intersects;
}

function mouseMove(event, viewer) {
    const intersects = raycast(event, viewer);

    if (intersects.length > 0) {
        const intersectedObject = intersects[0].object
        if (hoveringObject !== intersectedObject) {
            if (hoveringObject) {
                setHover(hoveringObject, false)
            }
            setHover(intersectedObject, true)
        }
    }else {
        if(hoveringObject) {
            setHover(hoveringObject, false)
        }
    }
}

function mouseOut(event, viewer) {
    if(hoveringObject) {
        setHover(hoveringObject, false)
    }
    if(selectedObject) {
        setSelect(selectedObject, false)
    }
}

function mouseDown(event, viewer) {
    const intersects = raycast(event, viewer);

    if (intersects.length > 0) {
        const intersectedObject = intersects[0].object
        if (selectedObject !== intersectedObject) {
            if (selectedObject) {
                setSelect(selectedObject, false)
            }
            setSelect(intersectedObject, true)
        }
    }else {
        if(selectedObject) {
            setSelect(selectedObject, false)
        }
    }
}

function mouseUp(event, viewer) {
    if(selectedObject) {
        setSelect(selectedObject, false)
    }
}

export function setupAbstract(viewer){
    if(box.parent) return

    // remove watch, keep the lights
    // viewer.scene.modelRoot.children[0].dispose(true)

    box.position.set(0.65, 0, 0)
    sphere.position.set(-0.65, 0, 0)

    viewer.scene.addObject(box)
    viewer.scene.addObject(sphere)

    viewer.canvas.addEventListener('pointermove', (e) => mouseMove(e, viewer))
    viewer.canvas.addEventListener('pointerdown', (e) => mouseDown(e, viewer))
    viewer.canvas.addEventListener('pointerup', (e) => mouseUp(e, viewer))
    viewer.canvas.addEventListener('pointerout', (e) => mouseOut(e, viewer))

    const baseGround = viewer.getPlugin(THREE.ContactShadowGroundPlugin)
    if(baseGround) {
        baseGround.mesh.name = 'ground'
        // baseGround.mapMode = 'aoMap'
        // baseGround.size = 20
    }
    intersectObjects = [box, sphere, baseGround.mesh]

}

export function teardownAbstract(viewer ){
    intersectObjects = []
    box.removeFromParent()
    sphere.removeFromParent()

    // const baseGround = viewer.getPlugin(ContactShadowGroundPlugin)
    // if(baseGround) {
    //     baseGround.mapMode = 'alphaMap'
    // }

    viewer.canvas.removeEventListener('pointermove', (e) => mouseMove(e, viewer))
    viewer.canvas.removeEventListener('pointerdown', (e) => mouseDown(e, viewer))
    viewer.canvas.removeEventListener('pointerup', (e) => mouseUp(e, viewer))
    viewer.canvas.removeEventListener('pointerout', (e) => mouseOut(e, viewer))
}
