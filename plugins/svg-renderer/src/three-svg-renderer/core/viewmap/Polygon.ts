// Author: Axel Antoine
// mail: ax.antoine@gmail.com
// website: https://axantoine.com
// 23/02/2021

// Loki, Inria project-team with Université de Lille
// within the Joint Research Unit UMR 9189 CNRS-Centrale
// Lille-Université de Lille, CRIStAL.
// https://loki.lille.inria.fr

// LICENCE: Licence.md

import {Vector2, Color} from 'three';
import { SVGMesh } from '../SVGMesh';

export class Polygon {
  id: number;
  mesh?: SVGMesh;
  color = new Color();
  insidePoint: Vector2 = new Vector2();
  contour: Vector2[];
  holes: Vector2[][];

  constructor(
      id: number,
      contour: Vector2[],
      holes: Vector2[][]) {

    this.id = id;
    this.contour = contour;
    this.holes = holes;
  }

}