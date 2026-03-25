/**
 * Minimal graph visualizer — renders a GraphDef as an SVG overlay.
 * For comparing the graph structure with Blender's node editor.
 */

import type {GraphDef, NodeDef, Connection} from './graph'

const NODE_W = 180
const NODE_H = 36
const GAP_X = 80
const GAP_Y = 20
const PAD = 40

/** Create a fullscreen SVG overlay showing the graph structure. */
export function createGraphOverlay(graphs: {graph: GraphDef, label?: string}[]): HTMLDivElement {
    const container = document.createElement('div')
    container.style.cssText = 'position:fixed;inset:0;background:rgba(15,15,15,0.95);overflow:auto;z-index:9999;font:12px/1.4 monospace;color:#ccc;'

    // Close button
    const close = document.createElement('div')
    close.textContent = '✕ Close'
    close.style.cssText = 'position:fixed;top:16px;right:24px;cursor:pointer;font-size:14px;color:#999;z-index:10000;padding:8px 16px;background:rgba(40,40,40,0.9);border-radius:6px;border:1px solid #555;'
    close.onclick = () => container.remove()
    container.appendChild(close)

    for (const {graph, label} of graphs) {
        const section = renderGraph(graph, label)
        container.appendChild(section)
    }

    return container
}

function renderGraph(graph: GraphDef, label?: string): HTMLElement {
    const wrap = document.createElement('div')
    wrap.style.cssText = 'padding:20px 30px 40px;'

    if (label) {
        const h = document.createElement('div')
        h.textContent = label
        h.style.cssText = 'font-size:16px;font-weight:bold;color:#fff;padding:12px 0 8px;border-bottom:1px solid #444;margin-bottom:12px;'
        wrap.appendChild(h)
    }

    // Compute depth per node (longest path from root)
    const depth = new Map<NodeDef, number>()
    for (const n of graph.order) depth.set(n, 0)
    for (const n of graph.order) {
        for (const c of graph.connections) {
            if (c.from === n) {
                depth.set(c.to, Math.max(depth.get(c.to) ?? 0, (depth.get(n) ?? 0) + 1))
            }
        }
    }

    // Group by depth
    const columns = new Map<number, NodeDef[]>()
    for (const n of graph.order) {
        const d = depth.get(n) ?? 0
        if (!columns.has(d)) columns.set(d, [])
        columns.get(d)!.push(n)
    }

    const maxDepth = Math.max(...[...depth.values()], 0)
    const maxCol = Math.max(...[...columns.values()].map(c => c.length), 1)

    const svgW = (maxDepth + 1) * (NODE_W + GAP_X) + PAD * 2
    const svgH = maxCol * (NODE_H + GAP_Y) + PAD * 2

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('width', String(svgW))
    svg.setAttribute('height', String(svgH))
    svg.setAttribute('viewBox', `0 0 ${svgW} ${svgH}`)
    svg.style.cssText = 'display:block;'

    // Node positions
    const pos = new Map<NodeDef, {x: number, y: number}>()
    for (const [d, nodes] of columns) {
        for (let i = 0; i < nodes.length; i++) {
            pos.set(nodes[i], {
                x: PAD + d * (NODE_W + GAP_X),
                y: PAD + i * (NODE_H + GAP_Y),
            })
        }
    }

    // Draw connections
    for (const c of graph.connections) {
        const from = pos.get(c.from)
        const to = pos.get(c.to)
        if (!from || !to) continue

        const x1 = from.x + NODE_W
        const y1 = from.y + NODE_H / 2
        const x2 = to.x
        const y2 = to.y + NODE_H / 2
        const mx = (x1 + x2) / 2

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        path.setAttribute('d', `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`)
        path.setAttribute('fill', 'none')
        path.setAttribute('stroke', '#556')
        path.setAttribute('stroke-width', '1.5')
        svg.appendChild(path)
    }

    // Draw nodes
    for (const node of graph.order) {
        const p = pos.get(node)
        if (!p) continue

        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')

        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
        rect.setAttribute('x', String(p.x))
        rect.setAttribute('y', String(p.y))
        rect.setAttribute('width', String(NODE_W))
        rect.setAttribute('height', String(NODE_H))
        rect.setAttribute('rx', '4')
        rect.setAttribute('fill', '#2a2a2a')
        rect.setAttribute('stroke', '#666')
        rect.setAttribute('stroke-width', '1')
        g.appendChild(rect)

        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text')
        text.setAttribute('x', String(p.x + 8))
        text.setAttribute('y', String(p.y + NODE_H / 2 + 4))
        text.setAttribute('fill', '#ddd')
        text.setAttribute('font-size', '12')
        text.textContent = node.name
        g.appendChild(text)

        svg.appendChild(g)
    }

    wrap.appendChild(svg)
    return wrap
}
