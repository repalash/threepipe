/*
 * Author: Axel Antoine
 * mail: ax.antoine@gmail.com
 * website: http://axantoine.com
 * Created on Tue Nov 22 2022
 *
 * Loki, Inria project-team with Université de Lille
 * within the Joint Research Unit UMR 9189
 * CNRS - Centrale Lille - Université de Lille, CRIStAL
 * https://loki.lille.inria.fr
 *
 * Licence: Licence.md
 */

import { DoubleSide, Material, Mesh, PerspectiveCamera, Raycaster, Side, Vector3 } from "three";
import { Chain, ChainVisibility } from "../Chain";
import { Viewmap } from "../Viewmap";

const _raycaster = new Raycaster();
const _rayDirection = new Vector3();
const _rayOrigin = new Vector3();

export class ChainVisibilityInfo {
  nbTests = Infinity;
  nbRaycasts = Infinity;
}

export function computeChainsVisibility(
    viewmap: Viewmap,
    info = new ChainVisibilityInfo()) {

  const {chains, meshes, camera} = viewmap;
  const threeMeshes = meshes.map(obj => obj.threeMesh);

  info.nbRaycasts = 0;
  info.nbTests = 0;

  // As we cast rays from object to the camera, we want rays to intersect only
  // on the backside face. So we need to change material sideness
  const materialSidenessMap = new Map<Material, Side>();

  for (const mesh of meshes) {
    if (Array.isArray(mesh.material)) {
      for (const material of mesh.material) {
        materialSidenessMap.set(material, material.side);
        material.side = DoubleSide;
      }
    } else {
      materialSidenessMap.set(mesh.material, mesh.material.side);
      mesh.material.side = DoubleSide;
    }
  }

  // Compute chain visibility
  for (const chain of chains) {

    info.nbTests += 1;

    // if (!chainVisibilityWithGeometry(chain)) {
    chainVisibilityWithRaycasting(chain, camera, threeMeshes);
    info.nbRaycasts += 1;
    // }
  }

  // Restaure the sideness of material
  for (const mesh of meshes) {
    if (Array.isArray(mesh.material)) {
      for (const material of mesh.material) {
        material.side = materialSidenessMap.get(material) ?? material.side;
      }
    } else {
      mesh.material.side = materialSidenessMap.get(mesh.material) ?? mesh.material.side;
    }
  }

}


export function chainVisibilityWithGeometry(chain: Chain) {

  // Search for an edge that is not obvisouly hidden by geometry
  // (i.e. not back and not concave
  // see paper https://hal.inria.fr/hal-02189483)
  let i = 0;
  let hiddenByGeometry = false;
  do {
    hiddenByGeometry = chain.edges[i].isConcave || chain.edges[i].isBack;
    i += 1;
  } while(!hiddenByGeometry && i < chain.edges.length);

  for (const edge of chain.edges) {
    if (edge.isConcave || edge.isBack) {
      chain.visibility = ChainVisibility.Hidden;
      return true;
    }
  }

  return false;
}


/**
 * Determines chain visibility via casting a rayfrom the chain to the camera
 * @param contour
 * @param camera
 * @param objects
 * @param tolerance
 * @returns
 */
export function chainVisibilityWithRaycasting(
    chain: Chain,
    camera: PerspectiveCamera,
    objects: Array<Mesh>,
    tolerance = 1e-5) {

  const edge = chain.middleEdge();

  if (!edge) {
    console.error("Contour has no edges");
    chain.visibility = ChainVisibility.Visible;
    return;
  }

  // Cast a ray from the middle of the segment to the camera
  _rayOrigin.lerpVectors(edge.a.pos3d, edge.b.pos3d, 0.5);
  _rayDirection.subVectors(camera.position, _rayOrigin).normalize();
  // _raycaster.firstHitOnly = false; // todo?
  _raycaster.set(_rayOrigin, _rayDirection);

  // Get the projection of the origin of the ray cast
  chain.raycastPoint.lerpVectors(edge.a.pos2d, edge.b.pos2d, 0.5);

  // Compute total distance in case of mathematical imprecision
  const intersections = _raycaster.intersectObjects(objects, false);

  let totalDistance = 0;
  for (const intersection of intersections) {
    totalDistance += intersection.distance;
  }

  if (totalDistance < tolerance) {
    chain.visibility = ChainVisibility.Visible;
  } else {
    chain.visibility = ChainVisibility.Hidden;
  }

}
