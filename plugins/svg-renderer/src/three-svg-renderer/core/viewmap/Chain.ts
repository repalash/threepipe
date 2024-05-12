// Author: Axel Antoine
// mail: ax.antoine@gmail.com
// website: https://axantoine.com
// 23/02/2021

// Loki, Inria project-team with Université de Lille
// within the Joint Research Unit UMR 9189 CNRS-Centrale
// Lille-Université de Lille, CRIStAL.
// https://loki.lille.inria.fr

// LICENCE: Licence.md

import {Vector2} from 'three';
import {ViewEdge} from './ViewEdge';
import { SVGMesh } from '../SVGMesh';
import { ViewVertex } from './ViewVertex';

export enum ChainVisibility {
  Unknown = "Unknown",
  Hidden = "Hidden",
  Visible = "Visible",
}

export class Chain {
  id: number;
  object: SVGMesh;
  raycastPoint = new Vector2();
  edges = new Array<ViewEdge>();
  vertices = new Array<ViewVertex>();
  visibility: ChainVisibility = ChainVisibility.Unknown;

  constructor(id: number, object: SVGMesh) {
    this.id = id;
    this.object = object;
  }

  get head(): ViewVertex {
    return this.vertices[0];
  }

  get tail(): ViewVertex {
    return this.vertices[this.vertices.length -1];
  }

  get size() {
    return this.vertices.length;
  }

  get nature() {
    return this.edges[0].nature;
  }

  middlePoint(): ViewVertex {
    return this.vertices[Math.floor(this.vertices.length/2)];
  }

  middleEdge(): ViewEdge | null {
    if (this.edges.length === 0) {
      return null;
    } else {
      return this.edges[Math.floor(this.edges.length/2)]
    }
  }

  addEdge(edge: ViewEdge): void {
    if (this.edges.length == 0) {
      this.edges.push(edge);
      this.vertices.push(edge.a);
      this.vertices.push(edge.b);
    } else {
      if (edge.hasVertex(this.head)) {
        // Put vertex and segment in the head of the lists
        this.vertices.unshift(edge.otherVertex(this.head));
        this.edges.unshift(edge);
      } else if (edge.hasVertex(this.tail)) {
        // Put vertex and segment in the tail of the lists
        this.vertices.push(edge.otherVertex(this.tail));
        this.edges.push(edge);
      }
    }
  }
}