// Author: Axel Antoine
// mail: ax.antoine@gmail.com
// website: https://axantoine.com
// 16/06/2022

// Loki, Inria project-team with Université de Lille
// within the Joint Research Unit UMR 9189 CNRS-Centrale
// Lille-Université de Lille, CRIStAL.
// https://loki.lille.inria.fr

// LICENCE: Licence.md

// Modified by repalash <palash@shaders.app>. Added support for cropping and overlaying rendered image, added parameters and other small changes.

import {DrawPass} from './DrawPass';
import {Viewmap} from '../../viewmap/Viewmap';
import {Color as SVGColor, Element as SVGElement, G as SVGGroup, Image, Pattern, Svg} from '@svgdotjs/svg.js';
import {getSVGCircle, getSVGPath} from '../svgutils';
import {Polygon} from '../../viewmap/Polygon';
import {mergeOptions} from '../../../utils/objects';
import {Box2, Vector2} from 'three'

export interface FillPassOptions {
  drawRaycastPoint?: boolean;

  /**
   * Use a random color for each polygon in the svg. Overwrites
   * {@link useFixedStyle} if `true`.
   * @defaultValue `false`
   */
  useRandomColors?: boolean;
  /**
   * Use a fixed style ()`color` and/or `opacity`) provided by {@link fillStyle}
   * instead of mesh material.
   * @defaultValue `false`
   */
  useFixedStyle?: boolean;
  /**
   * Fixed style to apply to polygons
   */
  fillStyle?: FillStyle;
  strokeStyle?: FillStyle;
  fillImage?: string;
}

export interface FillStyle {
  /**
   * Color of the polygons.
   * @defaultValue `"#333333"`
   */
  color?: string;
  /**
   * Opacity of the polygons.
   * @defaultValue `1`
   */
  opacity?: number;
}

export class FillPass extends DrawPass {
  drawFills = true;
  drawStrokes = true;
  drawImageFills = false;

  readonly options: Required<FillPassOptions> = {
    drawRaycastPoint: false,
    useRandomColors: false,
    useFixedStyle: false,
    fillStyle: {
      color: "#333333",
      opacity: 1,
    },
    strokeStyle: {
      color: "#111111",
      opacity: 1,
    },
    fillImage: '',
  };

  constructor(options: FillPassOptions = {}) {
    super();
    mergeOptions(this.options, options);
  }

  async draw(svg: Svg, viewmap: Viewmap) {
    let img = this.options.fillImage && this.drawImageFills ? new window.Image() : undefined
    if(img) {
      await new Promise<void>((res, rej) => {
        img!.onload = () => {
          res()
        }
        img!.onerror = (e) => {
          console.error('error loading image', e)
          rej()
        }
        img!.src = this.options.fillImage!
      }).catch((e) => {
        img = undefined
        console.error('error loading image', e)
      })
    }
    // debugger
    const group = new SVGGroup({id: "fills"});
    svg.add(group);

    for (const mesh of viewmap.meshes) {

      if (mesh.drawFills) {
        const polygons = viewmap.polygons.filter(p => p.mesh === mesh);
        const objectGroup = new SVGGroup({id: mesh.name});
        group.add(objectGroup);

        for (const polygon of polygons) {

          let img1 = undefined
          if(this.options.fillImage && img){ // todo this can be optimized
            const polygonBounds = new Box2().setFromPoints(polygon.contour);
            const rootSize = new Vector2(svg.width() as number, svg.height() as number)
            const polygonSize = polygonBounds.getSize(new Vector2())
            const polygonCenter = polygonBounds.getCenter(new Vector2())
            if(polygonSize.length() > rootSize.length()){
              // use the full image directly.
              await new Promise<void>((res) => {
                img1 = svg.image(img!.src, () => {
                  // this._svgFillImage?.size(20, 20)
                  res();
                  // debugger
                });
              })
            }else {
              if (img.width !== rootSize.x || img.height !== rootSize.y) {
                console.error('image size does not match svg size')
              } else {
                const canvas = document.createElement('canvas')
                canvas.width = Math.floor(polygonSize.width)
                canvas.height = Math.floor(polygonSize.height)
                const context = canvas.getContext('2d')
                if (context && canvas.width > 0 && canvas.height > 0) {
                  context.drawImage(img,
                      Math.floor(polygonCenter.x - polygonSize.width / 2),
                      Math.floor(polygonCenter.y - polygonSize.height / 2),
                      Math.floor(polygonSize.width), Math.floor(polygonSize.height),
                      0, 0, Math.floor(polygonSize.width), Math.floor(polygonSize.height),
                  )
                  // canvas.style.position = 'absolute'
                  // canvas.style.top = '0'
                  // canvas.style.left = '0'
                  // document.body.appendChild(canvas)
                  const croppedImgData = canvas.toDataURL('image/png') // use jpeg if not transparent?
                  await new Promise<void>((res) => {
                    img1 = svg.image(croppedImgData, () => {
                      // this._svgFillImage?.size(20, 20)
                      res();
                      // debugger
                    });
                  })
                }
              }
            }

          }

          drawPolygon(group, polygon, this.options, img1, this.drawFills, this.drawStrokes);
        }
      }
    }

    if(img){
      // loop through defs
      // size w, h for all patterns.
      // move image out of the pattern
      // <use xlink:href="#SvgjsImage1000"/>

      const patternAndImages = svg.defs().children().filter(c=>c instanceof Pattern && c.children().length === 1).map(c=>[c,c.children()[0]])
      // console.log(patternAndImages)
      patternAndImages.forEach(([pattern, image])=>{
        pattern.x(0)
        pattern.y(0)
        pattern.width(1)
        pattern.height(1)
        pattern.attr('patternUnits', 'objectBoundingBox')
        svg.defs().add(image)
        pattern.add(svg.use(image))
      })
    }
    // this._svgFillImage = undefined
  }
}

function drawPolygon(
    parent: SVGElement,
    polygon: Polygon,
    options: FillPassOptions,
    fillImage?: Image, drawFills = true, drawStroke = true) {

  // Make a copy of the style so we can modify it
  const style = {...options.fillStyle};
  const strokeStyle = {...options.strokeStyle};

  // If not using fixed color through the style, use the object color
  if (!options.useFixedStyle) {
    style.color = '#'+polygon.color.getHexString();
    strokeStyle.color = '#'+polygon.color.getHexString();
  }

  if (options.useRandomColors) {
    style.color = SVGColor.random().toString();
    strokeStyle.color = SVGColor.random().toString();
  }

  const path = getSVGPath(polygon.contour, polygon.holes, true, drawStroke ? strokeStyle : undefined, drawFills ? style : undefined, fillImage, parent);
  path.id("fill-"+polygon.id);
  // parent.add(path);

  if (options.drawRaycastPoint) {
    drawPolygonRaycastPoint(parent, polygon);
  }
}

function drawPolygonRaycastPoint(parent: SVGElement, polygon: Polygon) {
  const strokeStyle = {color: "black"};
  const fillStyle = {color: "white"};
  const cx = polygon.insidePoint.x;
  const cy = polygon.insidePoint.y;
  const point = getSVGCircle(cx, cy, 2, strokeStyle, fillStyle);
  point.id('raycast-point');
  parent.add(point);
}
