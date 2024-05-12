// Author: Axel Antoine
// mail: ax.antoine@gmail.com
// website: https://axantoine.com
// 23/02/2021

// Loki, Inria project-team with Université de Lille
// within the Joint Research Unit UMR 9189 CNRS-Centrale
// Lille-Université de Lille, CRIStAL.
// https://loki.lille.inria.fr

// LICENCE: Licence.md

import {Viewmap} from '../viewmap/Viewmap';
import {SizeLike} from '../../utils/geometry';
import {Svg} from '@svgdotjs/svg.js';
import '@svgdotjs/svg.topath.js';
import {DrawPass} from './passes/DrawPass';

export interface SVGDrawPassInfo {
  name: string;
  order: number;
  time: number;
}

export class SVGDrawInfo {
  totalTime = Infinity;
  passesInfo = new Array<SVGDrawPassInfo>();
}

export interface SVGDrawOptions {
  prettifySVG?: boolean;
}

export class SVGDrawHandler {
  readonly options: Required<SVGDrawOptions> = {
    prettifySVG: false,
  };
  readonly passes = new Array<DrawPass>();

  constructor(options?: SVGDrawOptions) {
    Object.assign(this.options, options);
  }

  async drawSVG(
      viewmap: Viewmap,
      size: SizeLike,
      info = new SVGDrawInfo()
  ): Promise<Svg> {

    const buildStartTime = Date.now();

    const svg = new Svg();
    svg.width(size.w);
    svg.height(size.h);

    // Call the draw passes
    for (let i=0; i<this.passes.length; i++) {
      const pass = this.passes[i];
      if (pass.enabled) {
        const passStartTime = Date.now();
        await pass.draw(svg, viewmap);

        info.passesInfo.push({
          name: pass.name,
          order: i,
          time: Date.now() - passStartTime,
        });
      }
    }

    info.totalTime = Date.now() - buildStartTime;
    return svg;
  }
}




