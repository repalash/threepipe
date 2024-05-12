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
import {Svg, G as SVGGroup, Element as SVGElement, Color as SVGColor,
} from '@svgdotjs/svg.js';
import {Chain, ChainVisibility} from '../../viewmap/Chain';
import {ViewEdgeNature} from '../../viewmap/ViewEdge';
import {getSVGPath, getSVGCircle, getSVGText} from '../svgutils';
import { SVGMesh } from '../../SVGMesh';
import { mergeOptions } from '../../../utils/objects';

const ViewEdgesNatures = Object.values(ViewEdgeNature);

export interface StrokeNatureOptions {
  enable?: boolean;

  renderOrder?: number;
}

export interface ChainPassOptions {
  /** 
   * Draw each chains in the svg with random colors. 
   * @defaultValue `false`
   */
  useRandomColors?: boolean;
  
  /**
   * Draw the raycasting point used to determine visibility in the svg.
   * @defaultValue `false`
   */
  drawRaycastPoint?: boolean;
  
  /**
   * Draw the legend showing the mapping between color and nature for chains.
   * Useful only if {@link colorByNature} is true.
   */
  drawLegend?: boolean;

  /**
   * Default style applied to strokes
   */
  defaultStyle?: StrokeStyle,

  /**
   * Customize stroke styles depending on their nature, if value are set, 
   * they overide default style
   */
  styles?: {
    [ViewEdgeNature.Silhouette]: PassStrokeStyle,
    [ViewEdgeNature.MeshIntersection]: PassStrokeStyle,
    [ViewEdgeNature.Crease]: PassStrokeStyle,
    [ViewEdgeNature.Boundary]: PassStrokeStyle,
    [ViewEdgeNature.Material]: PassStrokeStyle,
  };
}

export interface StrokeStyle {
  /**
   * Color of the stroke in hex format.
   * @defaultValue `"#000000"'
   */
  color?: string;
  /**
   * Width of the stroke
   * @defaultValue `1`
   */
  width?: number;
  /**
   * Opacity of the stroke
   * @defaultValue `1`
   */
  opacity?: number;
  /**
   * Pattern of dashes and gaps used for the stroke e.g. `"2,2"`
   * @defaultValue `""`
   */
  dasharray?: string;
  /**
   * Shape to be used at the ends of stroke
   * @defaultValue `"butt"`
   */
  linecap?: 'butt' | 'round' | 'square';
  /**
   * Shape to use at the corners of stroke
   * @defaultValue `"miter"`
   */
  linejoin?: 'arcs' | 'bevel' | 'miter' | 'miter-clip' | 'round';
  /**
   * Offset to use before starting dash-array
   * @defaultValue `0`
   */
  dashoffset?: number;
}

/**
 * Stroke Style interface with options specific to the Chain Pass
 */
export interface PassStrokeStyle extends StrokeStyle {
  /**
   * Draw order of the stroke in the svg. High order are drawn on top
   * @defaultValue Silhouette 5, Boundary 4, MeshIntersection 3, Crease 2, Material 1
   * 
   */
  drawOrder?: number;
  /**
   * Enable the edge nature type to be drawn in the svg
   */
  enabled?: boolean;
}



export abstract class ChainPass extends DrawPass {
  /** Options of the draw pass */
  readonly options : Required<ChainPassOptions> = {
    drawRaycastPoint: false,
    useRandomColors: false,
    drawLegend: false,

    defaultStyle: {
      color: "#000000",
      width: 1,
      dasharray: "",
      linecap: "butt",
      linejoin: "miter",
      opacity: 1,
      dashoffset: 0,
    },  
    styles: {
      [ViewEdgeNature.Silhouette]: {enabled: true, drawOrder: 5},
      [ViewEdgeNature.Boundary]: {enabled: true, drawOrder: 4},
      [ViewEdgeNature.MeshIntersection]: {enabled: true, drawOrder: 3},
      [ViewEdgeNature.Crease]: {enabled: true, drawOrder: 2},
      [ViewEdgeNature.Material]: {enabled: true, drawOrder: 1}
    }
  }

  /**
   * 
   * @param strokeStyle Default style applied to the strokes
   * @param options 
   */
  constructor(options: ChainPassOptions = {}) {
    super();
    
    mergeOptions(this.options, options);
  }
}

export class VisibleChainPass extends ChainPass {

  constructor(options: Partial<ChainPassOptions> = {}) {
    super(options);
  }

  async draw(svg: Svg, viewmap: Viewmap) {

    const chains = viewmap.chains
      .filter(c => c.visibility === ChainVisibility.Visible);

    const meshes = Array.from(viewmap.meshes).filter(m => m.drawVisibleContours);

    const group = new SVGGroup({id: "visible-contours"});
    drawChains(group, meshes, chains, this.options);
    svg.add(group);
  }
}

export class HiddenChainPass extends ChainPass {

  constructor(options: Partial<ChainPassOptions> = {}) {

    const {defaultStyle, ...otherOptions} = options;

    options = {
      defaultStyle: {
        color: "#FF0000",
        dasharray: "2,2",
        ...defaultStyle,
      },
      ...otherOptions
    }

    super(options);
  }

  async draw(svg: Svg, viewmap: Viewmap) {
 
    const chains = viewmap.chains.filter(
      c => c.visibility === ChainVisibility.Hidden
    );

    const meshes = Array.from(viewmap.meshes).filter(m => m.drawHiddenContours);

    const group = new SVGGroup({id: "hidden-contours"});
    svg.add(group);

    drawChains(group, meshes, chains, this.options);
  }
}

function drawChains(
    parent: SVGElement,
    meshes: SVGMesh[],
    chains: Chain[],
    options: Required<ChainPassOptions>) {

  const {defaultStyle, styles} = options;

  // Order natures depending on the draw order
  ViewEdgesNatures.sort(
    (n1, n2) => (styles[n1].drawOrder ?? 0) - (styles[n2].drawOrder ?? 0)
  );

  // Group the contours by mesh
  for (const mesh of meshes) {
    const objectChains = chains.filter(c => c.object === mesh);
    const objectGroup = new SVGGroup({id: mesh.name});
    parent.add(objectGroup);

    for (const nature of ViewEdgesNatures) {

      if (styles[nature]?.enabled) {

        const strokeStyle = {...defaultStyle, ...styles[nature]};

        const natureChains = objectChains.filter(c => c.nature === nature);
        const natureGroup = new SVGGroup({id: nature});
        objectGroup.add(natureGroup);

        for (const chain of natureChains) {
          drawChain(natureGroup, chain, options, strokeStyle);
        }
      }
    }
  }

  if (options.drawLegend) {
    parent.add(getLegend(options));
  }

}

function drawChain(
    parent: SVGElement, 
    chain: Chain,
    options: Required<ChainPassOptions>,
    style: StrokeStyle = {}
) {

  // Make a copy of the style so we can modify it
  style = {...style};

  if (options.useRandomColors) {
    style.color = SVGColor.random().toString();
  }

  const path = getSVGPath(chain.vertices, [], false, style);
  parent.add(path);

  if (options.drawRaycastPoint) {
    drawContourRaycastPoint(parent, chain);
  }
}

function drawContourRaycastPoint(parent: SVGElement, chain: Chain) {
  const strokeStyle = {color: "black"};
  const fillStyle = {color: "white"};
  const cx = chain.raycastPoint.x;
  const cy = chain.raycastPoint.y;
  const point = getSVGCircle(cx, cy, 2, strokeStyle, fillStyle);
  point.id('raycast-point');
  parent.add(point);
}

function getLegend(options: Required<ChainPassOptions>) {
  const legend = new SVGGroup({id: "edges-nature-legend"});
  
  legend.add(getSVGText("Natures", 10, 140, {size: 15, anchor: 'start'}))

  let y = 170;
  for (const nature of ViewEdgesNatures) {
    const fillColor = options.styles[nature].color ?? 'black';
    
    legend.add(getSVGCircle(15, y, 8, {color: "black"}, {color: fillColor}));
    legend.add(getSVGText(nature, 30, y-10, {size: 15, anchor: 'start'}));

    y += 20;
  }

  return legend;
}