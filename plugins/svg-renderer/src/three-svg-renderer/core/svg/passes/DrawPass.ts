// Author: Axel Antoine
// mail: ax.antoine@gmail.com
// website: https://axantoine.com
// 16/06/2022

// Loki, Inria project-team with Université de Lille
// within the Joint Research Unit UMR 9189 CNRS-Centrale
// Lille-Université de Lille, CRIStAL.
// https://loki.lille.inria.fr

// LICENCE: Licence.md 

import {Svg} from '@svgdotjs/svg.js';
import {Viewmap} from '../../viewmap/Viewmap';

export abstract class DrawPass {
  /**
   * Name of the draw pass
   */
  readonly name: string;
  /** 
   * Enables/Disables draw pass.
   * @defaultValue `true` 
  */
  enabled = true;

  constructor() {
    this.name = this.constructor.name;
  }
  
  /**
   * Function automatically called by the `SVGDrawHandler`
   * @param svg The svg tree being built
   * @param viewmap The viewmap data structure
   */
  abstract draw(svg: Svg, viewmap: Viewmap): Promise<void>;
}