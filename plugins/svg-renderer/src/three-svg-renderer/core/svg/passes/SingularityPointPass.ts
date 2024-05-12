// Author: Axel Antoine
// mail: ax.antoine@gmail.com
// website: https://axantoine.com
// 16/06/2022

// Loki, Inria project-team with Université de Lille
// within the Joint Research Unit UMR 9189 CNRS-Centrale
// Lille-Université de Lille, CRIStAL.
// https://loki.lille.inria.fr

// LICENCE: Licence.md 

import {DrawPass} from './DrawPass';
import {Viewmap} from '../../viewmap/Viewmap';
import {Svg, G as SVGGroup} from '@svgdotjs/svg.js';
import {ChainVisibility} from '../../viewmap/Chain';
import {getSVGCircle, getSVGText} from '../svgutils';
import { ViewVertexSingularity } from '../../viewmap/ViewVertex';

const ViewVertexSingularities = Object.values(ViewVertexSingularity)
  .filter(singularity => singularity !== ViewVertexSingularity.None);

const ViewVertexSingularityColor = {
  [ViewVertexSingularity.None]: "",
  [ViewVertexSingularity.ImageIntersection]: "green",
  [ViewVertexSingularity.MeshIntersection]: "red",
  [ViewVertexSingularity.CurtainFold]: "blue",
  [ViewVertexSingularity.Bifurcation]: "orange",
}

export interface SingularityPointPassOptions {
  drawLegend?: boolean;
  pointSize?: number;
  drawVisiblePoints?: boolean;
  drawHiddenPoints?: boolean;
}

export class SingularityPointPass extends DrawPass {
  readonly options: Required<SingularityPointPassOptions> = {
    drawVisiblePoints: true,
    drawHiddenPoints: false,
    drawLegend: true,
    pointSize: 2,
  };

  constructor(options: SingularityPointPassOptions = {}) {
    super();
    Object.assign(this.options, options);
  }

  async draw(svg: Svg, viewmap: Viewmap) {
    // Update point visibility to avoid drawing point on hidden chains if only
    // visible chains are drawn

    for (const chain of viewmap.chains) {
      for (const p of chain.vertices) {
        p.visible = p.visible || chain.visibility === ChainVisibility.Visible;
      }
    }

    const visibilities = [];
    if (this.options.drawVisiblePoints) {
      visibilities.push(true);
    }
    if (this.options.drawHiddenPoints) {
      visibilities.push(false);
    }

    const group = new SVGGroup({id: "singularity-points"});
    svg.add(group);


    const strokeStyle = {
      color: 'black'
    };
    const fillStyle = {
      color: "",
    };

    const singularityPoints = Array.from(viewmap.viewVertexMap.values())
      .filter(p => p.singularity != ViewVertexSingularity.None);

    for (const visibility of visibilities) {

      const visibilityGroup = new SVGGroup({id: visibility? "visible" : "hidden"})
      group.add(visibilityGroup);

      for (const singularity of ViewVertexSingularities) {
        
        const points = singularityPoints
          .filter(p => p.singularity === singularity && p.visible === visibility);

        const singularityGroup = new SVGGroup({id: singularity});
        visibilityGroup.add(singularityGroup);

        fillStyle.color = ViewVertexSingularityColor[singularity];
        for (const p of points) {
          const svgPoint = getSVGCircle(p.pos2d.x, p.pos2d.y, this.options.pointSize, strokeStyle, fillStyle);
          singularityGroup.add(svgPoint);
        }
      }
    }

    if (this.options.drawLegend) {
      group.add(getLegend());
    }
  }
}

function getLegend() {
  const legend = new SVGGroup({id: "singularity-legend"});
  
  legend.add(getSVGText("Singularities", 10, 10, {size: 15, anchor: 'start'}))

  let y = 40;
  for (const singularity of ViewVertexSingularities) {
    const fillColor = ViewVertexSingularityColor[singularity];
    
    legend.add(getSVGCircle(15, y, 8, {color: "black"}, {color: fillColor}));
    legend.add(getSVGText(singularity, 30, y-10, {size: 15, anchor: 'start'}));

    y += 20;
  }

  return legend;
}
