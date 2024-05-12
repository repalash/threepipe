// Author: Axel Antoine
// mail: ax.antoine@gmail.com
// website: https://axantoine.com
// 16/06/2022

// Loki, Inria project-team with Université de Lille
// within the Joint Research Unit UMR 9189 CNRS-Centrale
// Lille-Université de Lille, CRIStAL.
// https://loki.lille.inria.fr

// LICENCE: Licence.md

import {
  Circle as SVGCircle,
  Dom,
  Ellipse as SVGEllipse,
  FillData,
  FontData,
  Image,
  Image as SVGImage,
  Number as SVGNumber,
  NumberAlias as SVGNumberAlias,
  Path as SVGPath,
  PathArray as SVGPathArray,
  PathCommand as SVGPathCommand,
  Polygon as SVGPolygon,
  Rect as SVGRect,
  StrokeData,
  Text as SVGText
} from '@svgdotjs/svg.js';
import {PointLike, RectLike, round} from '../../utils';

export function getSVGImage(url: string, rect: RectLike) {
  const svgImage = new SVGImage();
  svgImage.load(url);
  svgImage.x(rect.x);
  svgImage.y(rect.y);
  svgImage.width(rect.w);
  svgImage.height(rect.h)
  return svgImage;
}

export function getSVGText(
    text: string,
    x: number,
    y: number,
    fontStyle: FontData = {},
    strokeStyle: StrokeData = {},
    fillStyle: FillData = {},
): SVGText {
  const svgText = new SVGText();
  svgText.text(text);
  svgText.x(x);
  svgText.y(y);
  svgText.font(fontStyle);
  svgText.stroke(strokeStyle);
  svgText.fill(fillStyle);
  return svgText;
}

export function getSVGPath(
    contour: PointLike[],
    holes: PointLike[][],
    closed: boolean,
    strokeStyle?: StrokeData,
    fillStyle?: FillData,
    fillImage?: Image,
    parent?: Dom,
): SVGPath {
  const path = new SVGPath();
  let cmds = getSVGPathCommands(contour, closed);
  for (const hole of holes) {
    cmds = cmds.concat(getSVGPathCommands(hole, closed));
  }

  path.plot(new SVGPathArray(cmds));
  if (strokeStyle) {
    path.stroke(strokeStyle);
  } else {
    path.stroke('none');
  }
  if(parent){
    parent.add(path); // required for fillImage
  }
  if(fillImage){
    path.fill(fillImage);
  } else if (fillStyle) {
    path.fill({...fillStyle, rule: "evenodd"});
  } else {
    path.fill('none');
  }
  return path;
}

function getSVGPathCommands(points: PointLike[], closed = true): SVGPathCommand[] {
  const cmds = new Array<SVGPathCommand>();
  let p;
  if (points.length > 0) {
    p = points[0];
    cmds.push(['M', round(p.x), round(p.y)])
    for (let i=1; i<points.length; i++) {
      p = points[i];
      cmds.push(['L', round(p.x), round(p.y)]);
    }
    if (closed) {
      cmds.push(['Z']);
    }
  }
  return cmds;
}

export function getSVGCircle(
    cx: number,
    cy: number,
    radius: number,
    strokeStyle: StrokeData = {},
    fillStyle: FillData = {}
) {
  const circle = new SVGCircle();
  circle.center(cx, cy);
  circle.radius(radius);
  circle.stroke(strokeStyle);
  circle.fill(fillStyle);
  return circle;
}

const _ignoredAttributes = ["x","y","width","height","viewbox","cx","cy","rw","rx","points"];
export function replaceShapeByPath(
    shape: SVGPolygon | SVGRect | SVGEllipse | SVGCircle
): SVGPath {

  const path = shape.toPath(true);
  const attributes = shape.attr();
  for(const attribute in attributes) {
    if(!_ignoredAttributes.includes(attribute)) {
      path.attr(attribute, attributes[attribute]);
    }
  }
  return path;
}

export function NumberAliasToNumber(n: SVGNumberAlias): number {
  switch (typeof n) {
  case "number":
    return n as number;
  case "string":
    return Number(n);
  case typeof SVGNumber:
    return (n as SVGNumber).value;
  }
  return 0;
}
