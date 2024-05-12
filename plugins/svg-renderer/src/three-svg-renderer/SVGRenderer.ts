// Author: Axel Antoine
// mail: ax.antoine@gmail.com
// website: https://axantoine.com
// 14/06/2022

// Loki, Inria project-team with Université de Lille
// within the Joint Research Unit UMR 9189 CNRS-Centrale
// Lille-Université de Lille, CRIStAL.
// https://loki.lille.inria.fr

// LICENCE: Licence.md

import {PerspectiveCamera} from 'three';
import {DrawPass, SVGDrawHandler, SVGDrawInfo, SVGDrawOptions, Viewmap, ViewmapBuildInfo, ViewmapOptions} from './core';
import {SVGMesh} from './core/SVGMesh';
import {Svg} from '@svgdotjs/svg.js';

// import format from 'xml-formatter';

export interface ExportOptions {
  prettify?: boolean;
}

export class SVGRenderInfo {
  resolution = {w: Infinity, h: Infinity};
  renderingTime = Infinity;
  readonly svgDrawInfo = new SVGDrawInfo();
  readonly viewmapInfo = new ViewmapBuildInfo();
}

export interface ProgressInfo {
  currentStepName: string;
  currentStep: number;
  totalSteps: number;
}

/**
 *
 */
export class SVGRenderer {

  readonly viewmap;
  readonly drawHandler;


  constructor(vOptions?: ViewmapOptions, sOptions?: SVGDrawOptions) {
    this.viewmap = new Viewmap(vOptions);
    this.drawHandler = new SVGDrawHandler(sOptions);
  }


  /**
   * Render a SVG file from the given meshes and returns it.
   * @param meshes Mehses to render
   * @param camera Camera used to compute the perspective
   * @param size Size of the render (will be scaled by camera aspect ratio)
   * @param options Options to customize the render
   * @param info Object containing info (e.g. times) on the rendering process
   * @returns SVG object from the Svgdotjs lib
   */
  async generateSVG(
      meshes: Array<SVGMesh>,
      camera: PerspectiveCamera,
      size: {w: number, h: number},
      info = new SVGRenderInfo()): Promise<Svg> {

    const renderStartTime = Date.now();

    // Setup camera keeping
    const renderSize = {w: size.w, h: size.w/camera.aspect};
    info.resolution = renderSize;

    // Viewmap Build
    await this.viewmap.build(
      meshes, camera, renderSize, info.viewmapInfo
    );

    // SVG Buid
    const svg = await this.drawHandler.drawSVG(
      this.viewmap, renderSize, info.svgDrawInfo
    );

    info.renderingTime = Date.now() - renderStartTime;

    // console.log(JSON.parse(JSON.stringify(info)));

    return svg;
  }

  /**
   * Adds a pass to the SVG rendering pipeline.
   * @param pass
   */
  addPass(pass: DrawPass) {
    if (!this.drawHandler.passes.includes(pass)) {
      this.drawHandler.passes.push(pass);
    }
  }

  /**
   * Removes a pass from the SVG rendering pipeline
   * @param pass
   */
  removePass(pass: DrawPass) {
    this.drawHandler.passes.remove(pass);
  }

  /**
   * Removes all the passes from the SVG rendering pipeline.
   */
  clearPasses() {
    this.drawHandler.passes.clear();
  }


  // static exportSVG(svg: Svg, filename: string, options?: ExportOptions) {
  //
  //   const opt = {
  //     prettify: false,
  //     ...options,
  //   }
  //
  //   let text = svg.svg();
  //   if (opt.prettify) {
  //     text = (text, {});
  //   }
  //   const svgBlob = new Blob([text], {type:"image/svg+xml;charset=utf-8"});
  //   const svgUrl = URL.createObjectURL(svgBlob);
  //   const downloadLink = document.createElement("a");
  //   downloadLink.href = svgUrl;
  //   downloadLink.download = filename;
  //   document.body.appendChild(downloadLink);
  //   downloadLink.click();
  //   document.body.removeChild(downloadLink);
  // }





}
