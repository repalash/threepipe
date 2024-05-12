// Author: Axel Antoine
// mail: ax.antoine@gmail.com
// website: https://axantoine.com
// 23/02/2021

// Loki, Inria project-team with Université de Lille
// within the Joint Research Unit UMR 9189 CNRS-Centrale
// Lille-Université de Lille, CRIStAL.
// https://loki.lille.inria.fr

// LICENCE: Licence.md

// Modified by repalash <palash@shaders.app>. Minor changes, added parameters and error handling.

import {ColorRepresentation, PerspectiveCamera} from 'three';
import {SizeLike} from '../../utils';
import {SVGMesh} from '../SVGMesh';
import {Chain, ChainVisibility} from './Chain';
import {ViewEdge} from './ViewEdge';
import {computePolygons, PolygonsInfo} from './operations/computePolygons';
import {setupEdges} from './operations/setupEdges'; // import { ViewPoint } from './ViewPoint_';
import {Polygon} from './Polygon';
import {AssignPolygonInfo, assignPolygons} from './operations/assignPolygons';
import {ChainVisibilityInfo, computeChainsVisibility} from './operations/computeChainsVisibility'; // import { setupPoints } from './operations/setupPoints_';
import {computeMeshIntersections, MeshIntersectionInfo} from './operations/computeMeshIntersections';
import {ViewVertex} from './ViewVertex';
import {createChains} from './operations/createChains'
import {find2dSingularities} from './operations/find2dSingularities'
import {find3dSingularities} from './operations/find3dSingularities'

declare module '../../../three-mesh-halfedge' {

  export interface Face {
    viewEdges: ViewEdge[];
  }

  export interface Vertex {
    viewVertex: ViewVertex;
  }

}

export interface ViewmapOptions {
  updateMeshes?: boolean;
  ignoreVisibility?: boolean;
  defaultMeshColor?: ColorRepresentation;
  creaseAngle?: {
    min: number,
    max: number,
  }
}

export class ViewmapBuildInfo {
  totalTime = Infinity;

  /** Record or times in ms */
  times = {
    updateGeometries: Infinity,
    updateBVH: Infinity,
    updateHES: Infinity,
    setupEdges: Infinity,
    find3dSingularities: Infinity,
    find2dSingularities: Infinity,
    computeChains: Infinity,
    visibility: Infinity,
    computePolygons: Infinity,
    assignPolygons: Infinity,
    worldTransform: Infinity,
    meshIntersections: Infinity,
    setupPoints: Infinity,
    setupFaceMap: Infinity,
  };

  intersections = new MeshIntersectionInfo();
  visibility =  {
    nbTests: Infinity,
    nbRaycasts: Infinity,
  };
  polygons = {
    smallAreaIgnored: Infinity,
    insidePointErrors: Infinity,
    assigned: Infinity,
    nonAssigned: Infinity,
  };
}

export interface ProgressInfo {
  currentStepName: string;
  currentStep: number;
  totalSteps: number;
}

interface ViewmapAction {
  name: string;
  process: () => Promise<void>;
}

export class Viewmap {

  readonly meshes = new Array<SVGMesh>();

  readonly viewEdges = new Array<ViewEdge>();
  // readonly viewPointMap = new Map<string, ViewPoint>();
  readonly viewVertexMap = new Map<string, ViewVertex>();

  readonly chains = new Array<Chain>();
  readonly polygons = new Array<Polygon>();
  readonly camera = new PerspectiveCamera();
  readonly renderSize = {w: 500, h: 500};
  readonly options: Required<ViewmapOptions> = {
    updateMeshes: true,
    ignoreVisibility: false,
    defaultMeshColor: 0x555555,
    creaseAngle: {
      min: 80,
      max: 100,
    }
  }

  constructor(options?: ViewmapOptions) {
    Object.assign(this.options, options);
  }

  clear() {
    this.meshes.clear();
    this.viewEdges.clear();
    // this.viewPointMap.clear();
    this.viewVertexMap.clear();
    this.chains.clear();
    this.polygons.clear();
  }

  build(
      meshes: SVGMesh[],
      camera: PerspectiveCamera,
      renderSize: SizeLike,
      info = new ViewmapBuildInfo(),
      progressCallback?: (progress: ProgressInfo) => void) {

    this.clear();

    this.meshes.push(...meshes);

    const ud = camera.userData
    camera.userData = {};
    this.camera.copy(camera);
    camera.userData = ud;
    this.camera.getWorldPosition(camera.position);

    this.renderSize.w = renderSize.w;
    this.renderSize.h = renderSize.h;


    const actions = this.setupActions(info);

    info.totalTime = Date.now();

    return this.buildAsync(0, actions, info, progressCallback);

  }

  skipActions = false

  private buildAsync(
      idx: number,
      actions: ViewmapAction[],
      info: ViewmapBuildInfo,
      progressCallback?: (progress: ProgressInfo) => void) {

    info.totalTime = Date.now();

    return new Promise<void>((resolve) => {

      if (idx < actions.length) {
        progressCallback && progressCallback({
          totalSteps: actions.length,
          currentStep: idx+1,
          currentStepName: actions[idx].name
        });
        const res = () => {
          resolve(this.buildAsync(idx+1, actions, info, progressCallback));
        }
        if(this.skipActions) res()
        else {
          // console.info(`Viewmap step ${idx+1}/${actions.length} : ${actions[idx].name}`);
          actions[idx].process().catch(_ => {
            // todo handle errors properly depending on the step.
            // console.error(`Viewmap step ${idx+1}/${actions.length} : ${actions[idx].name} failed`, e);
          }).then(res)
        }
      } else {
        info.totalTime = Date.now() - info.totalTime;
        resolve();
      }
    });

  }


  private setupActions(info = new ViewmapBuildInfo()): Array<ViewmapAction> {

    const actions = new Array<ViewmapAction>();

    if (this.options.updateMeshes) {

      /**
       * Update Morphed Geometries
       */
      actions.push({
        name: "Update Morphed Geometries",
        process: async() => {
          const startTime = Date.now();
          for (const mesh of this.meshes) {
            mesh.updateMorphGeometry();
          }
          info.times.updateGeometries = Date.now() - startTime;
        }
      });

      /**
       * Update BVH structs
       */
      actions.push({
        name: "Update BVH Structures",
        process: async() => {
          const startTime = Date.now();
          for (const mesh of this.meshes) {
            mesh.updateBVH(false);
          }
          info.times.updateBVH = Date.now() - startTime;
        }
      });

      /**
       * Update Halfedge structs
       */
      actions.push({
        name: "Update Halfedge Structures",
        process: async() => {
          const startTime = Date.now();
          for (const mesh of this.meshes) {
            mesh.updateHES(false);
          }
          info.times.updateHES = Date.now() - startTime;
        }
      });

      /**
       * Update Halfedge structures to world positions
       */
      actions.push({
        name: "Transform local 3d points into world",
        process: async() => {
          const startTime = Date.now();
          for (const mesh of this.meshes) {
            for (const vertex of mesh.hes.vertices) {
              vertex.position.applyMatrix4(mesh.matrixWorld);
            }
          }
          info.times.worldTransform = Date.now() - startTime;
        }
      });
    }

    /**
     * Setup edges
     */
    actions.push({
      name: "Setup viewmap edges",
      process: async() => {
        const startTime = Date.now();
        setupEdges(this, this.options);
        info.times.setupEdges = Date.now() - startTime;
      }
    });

    /**
     * Compute Meshes Intersections
     */
    actions.push({
      name: "Compute meshes intersections",
      process: async() => {
        const startTime = Date.now();
        computeMeshIntersections(this, info.intersections);
        info.times.meshIntersections = Date.now() - startTime;
      }
    });

    /**
     * Find singularities in the 3D space
     */
    actions.push({
      name: "Find singularities in the 3d space",
      process: async() => {
        const startTime = Date.now();
        // this.singularityPoints =
        find3dSingularities(this);
        info.times.find3dSingularities = Date.now() - startTime;
      }
    });

    /**
     * Find singularity points in the 2d space (image place intersections)
     * This step creates new points and segments on-the-fly
     */
    actions.push({
      name: "Find singularities in the 2d space",
      process: async() => {
        const startTime = Date.now();
        find2dSingularities(this);
        info.times.find2dSingularities = Date.now() - startTime;
      }
    });

    /**
     * Compute chains from the set of segments: link segments depending
     * of their connexity and nature
     */
    actions.push({
      name: "Create chains",
      process: async() => {
        const startTime = Date.now();
        createChains(this);
        info.times.computeChains = Date.now() - startTime;
      }
    });

    /**
     * Compute contours visibility using geometry's topology or raycasting if
     * need.
     * If ignore visibility is set, set all contours to be visible
     */
    actions.push({
      name: "Compute chains visibility",
      process: async() => {
        if (!this.options.ignoreVisibility)  {
          const startTime = Date.now();
          const visInfo = new ChainVisibilityInfo();
          computeChainsVisibility(this, visInfo);
          info.visibility.nbRaycasts = visInfo.nbRaycasts;
          info.visibility.nbTests = visInfo.nbTests;
          info.times.visibility = Date.now() - startTime;
        } else {
          this.chains.map(chain => chain.visibility = ChainVisibility.Visible);
        }
      }
    });

    /**
     * Compute the polygons formed by the visible subset of contours
     */
    actions.push({
      name: "Compute polygons",
      process: async() => {
        const startTime = Date.now();
        const polyInfo = new PolygonsInfo();
        await computePolygons(this, polyInfo);
        info.polygons.smallAreaIgnored = polyInfo.smallAreaIgnored;
        info.polygons.insidePointErrors = polyInfo.insidePointErrors;
        info.times.computePolygons = Date.now() - startTime;
      }
    });

    /**
     * Assign polygons to their corresponding object with raycasting
     */
    actions.push({
      name: "Assign Polygons",
      process: async() => {
        const startTime = Date.now();
        const assignInfo = new AssignPolygonInfo();
        assignPolygons(this, this.options, assignInfo);
        info.polygons.assigned = assignInfo.assigned;
        info.polygons.nonAssigned = assignInfo.nonAssigned;
        info.times.assignPolygons = Date.now() - startTime;
      }
    });

    return actions;
  }

  visibleChains() {
    return this.chains.filter(c => c.visibility === ChainVisibility.Visible);
  }

  hiddenChains() {
    return this.chains.filter(c => c.visibility === ChainVisibility.Hidden);
  }
}
