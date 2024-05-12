import {BufferAttribute, BufferGeometry, Material, Mesh} from 'three';
import {computeMorphedAttributes} from 'threepipe';

/**
 * Types definitions are not up to date
 */
declare module 'threepipe' {
  export function computeMorphedAttributes(object: Mesh): {
    positionAttribute: BufferAttribute,
    normalAttribute: BufferAttribute,
    morphedPositionAttribute: BufferAttribute,
    morphedNormalAttribute: BufferAttribute
  }
}

export function triangleGeometry(size: number) {
  const vertices = new Float32Array([
    -size, 0,  -size,
    size, 0,  -size,
    0, 0, size
  ]);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(vertices, 3));
  return geometry;
}

export function disposeMesh(mesh: Mesh) {
  mesh.geometry.dispose();
  if (mesh.material instanceof Array) {
    const materials = mesh.material as Array<Material>;
    for (const material of materials) {
      material.dispose();
    }
  } else {
    mesh.material.dispose();
  }
}

export function disposeGeometry(geometry: BufferGeometry) {
  geometry.dispose();
  for (const attribute in geometry.attributes) {
    geometry.deleteAttribute(attribute);
  }
}

export function computeMorphedGeometry(source: Mesh, target: BufferGeometry) {

  if (!source.geometry.hasAttribute("normal")) {
    source.geometry.computeVertexNormals();
  }

  const {
    morphedPositionAttribute,
    morphedNormalAttribute
  } = computeMorphedAttributes(source);

  target.groups = [...source.geometry.groups];
  if (source.geometry.index) {
    target.index = source.geometry.index.clone();
  }

  target.deleteAttribute('position');
  target.deleteAttribute('normal');
  target.setAttribute('position', morphedPositionAttribute);
  target.setAttribute('normal', morphedNormalAttribute);
}
