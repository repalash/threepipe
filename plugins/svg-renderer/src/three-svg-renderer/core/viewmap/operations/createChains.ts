/*
 * Author: Axel Antoine
 * mail: ax.antoine@gmail.com
 * website: http://axantoine.com
 * Created on Tue Nov 22 2022
 *
 * Loki, Inria project-team with Université de Lille
 * within the Joint Research Unit UMR 9189
 * CNRS - Centrale Lille - Université de Lille, CRIStAL
 * https://loki.lille.inria.fr
 *
 * Licence: Licence.md
 */

import {SVGMesh} from "../../SVGMesh";
import {Chain} from "../Chain";
import {ViewEdge} from "../ViewEdge";
import {Viewmap} from "../Viewmap";
import {ViewVertex, ViewVertexSingularity} from "../ViewVertex";


// See chaining section of https://hal.inria.fr/hal-02189483
export function createChains(viewmap: Viewmap, maxChains = 10000) {

  const {viewEdges, chains} = viewmap;
  const remainingEdges = new Set(viewEdges);

  let chainId = 0;
  while(remainingEdges.size > 0 && chainId < maxChains) {
    const [startEdge] = remainingEdges;
    const currentObject = startEdge.meshes[0];
    const chain = new Chain(chainId, currentObject);

    remainingEdges.delete(startEdge);
    chain.addEdge(startEdge);

    // Search for connected edges from one direction
    for (const startViewVertex of startEdge.vertices) {
      let current = startViewVertex;
      let edge = nextChainEdge(startEdge, current, remainingEdges, currentObject);

      while (edge) {
        remainingEdges.delete(edge);
        chain.addEdge(edge);
        current = edge.otherVertex(current);
        edge = nextChainEdge(edge, current, remainingEdges, currentObject);
      }
    }
    chains.push(chain);
    chainId += 1;
  }
}

export function nextChainEdge(
    currentEdge: ViewEdge,
    viewVertex: ViewVertex,
    remainingEdges: Set<ViewEdge>,
    obj: SVGMesh) : ViewEdge | null {

  // If point is a singularity, chaining stops
  if (viewVertex.singularity !== ViewVertexSingularity.None) {
    return null;
  }

  // TODO: Taking into account the nature of the current segment and geometric
  // properties to build longer chains
  for (const viewEdge of viewVertex.viewEdges) {

    const takeEdge =
      // Take edge only if it has not been assigned yet
      remainingEdges.has(viewEdge) &&
      // Next edge must have the same nature of the current edge
      viewEdge.nature === currentEdge.nature &&
      // Next edge must be part of the same object
      viewEdge.meshes.includes(obj);

    if (takeEdge) {
      return viewEdge;
    }
  }
  return null;
}
