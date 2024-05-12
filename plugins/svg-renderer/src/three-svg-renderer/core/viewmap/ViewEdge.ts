// Author: Axel Antoine
// mail: ax.antoine@gmail.com
// website: https://axantoine.com
// 09/12/2021

// Loki, Inria project-team with Université de Lille
// within the Joint Research Unit UMR 9189 CNRS-Centrale
// Lille-Université de Lille, CRIStAL.
// https://loki.lille.inria.fr

// LICENCE: Licence.md

import {Vector2} from 'three';
import {Face, Halfedge} from '../../../three-mesh-halfedge';
import {SVGMesh} from '../SVGMesh';
// import { ViewPoint } from './ViewPoint_';
import {ViewVertex} from './ViewVertex';

/**
 * Possible values for the edge nature in the viemap.
 */
export enum ViewEdgeNature {
  // /** Edge is standard */
  // None = "None",
  /** Edge is connected to front-facing and a back-facing face */
  Silhouette = "Silhouette",
  /** Edge is only connected to one face */
  Boundary = "Boundary",
  /** Edge is on the intersection between two meshes */
  MeshIntersection = "MeshIntersection",
  /** Edge is connected to two faces where the angle between normals is acute */
  Crease = "Crease",
  /** Edge is connected to two faces using a different material/vertex color */
  Material = "Material",
}

export const VisibilityIndicatingNatures = new Set([
  ViewEdgeNature.Silhouette,
  ViewEdgeNature.Boundary,
  ViewEdgeNature.MeshIntersection,
]);

export class ViewEdge {

  /**
   * Halfedge on which the edge is based on
   * @defaultValue null
   */
  halfedge?: Halfedge;

  /**
   * List of the meshes the Edge belongs to
   */
  readonly meshes = new Array<SVGMesh>();

  /**
   * Nature of the edge
   * @defautValue EdgeNature.None
   */
  nature: ViewEdgeNature;

  /**
   * Angle between to the connected faces.
   * @defaultValue Infinity */
  faceAngle = Infinity;

  /**
   * Indicates whether the edge is connected to back-facing faces only
   * *Note: this makes only sense with 2 connected faces.*
   * @defaultValue false
  */
  isBack = false;

  /**
   * Indicates wheter the edge is concave.
   * *Note: this makes only sense with 2 connected faces.*
   * @defaultValue false
   */
  isConcave = false;


  faces = new Array<Face>();

  a: ViewVertex;
  b: ViewVertex;

  constructor(a: ViewVertex, b: ViewVertex, nature: ViewEdgeNature, halfedge?: Halfedge) {
    this.a = a;
    this.b = b;
    this.nature = nature;
    this.halfedge = halfedge;
  }

  get vertices() {
    return [this.a, this.b];
  }

  get from(): Vector2 {
    return this.a.pos2d;
  }

  get to(): Vector2 {
    return this.b.pos2d;
  }

  toJSON() {

    return {
      id: [...this.a.vertices].map(v => v.id).join(',') + '-' +
          [...this.b.vertices].map(v => v.id).join(','),
    }
  }

  clone() {
    const edge =  new ViewEdge(this.a, this.b, this.nature, this.halfedge);
    edge.faceAngle = this.faceAngle;
    edge.isBack = this.isBack;
    edge.isConcave = this.isConcave;
    edge.meshes.push(...this.meshes);
    edge.faces.push(...this.faces);
    return edge;
  }

  otherVertex(vertex: ViewVertex) {
    if (vertex === this.a) {
      return this.b;
    } else {
      return this.a;
    }
  }

  hasVertex(vertex: ViewVertex) {
    return this.a === vertex || this.b === vertex;
  }

  isConnectedTo(edge: ViewEdge) {
    return this.hasVertex(edge.a) || this.hasVertex(edge.b);
  }

}



