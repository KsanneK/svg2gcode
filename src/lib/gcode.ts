import { parse } from 'svg-parser';
import { makeAbsolute, Command, parseSVG as parsePathData } from 'svg-path-parser';
import ClipperLib from 'clipper-lib';




interface SvgNode {
    type: string;
    tagName?: string;
    properties?: Record<string, any>;
    children?: SvgNode[];
    value?: string;
}

interface CommandC {
    code: 'C';
    x1: number; y1: number;
    x2: number; y2: number;
    x: number; y: number;
}

interface CommandQ {
    code: 'Q';
    x1: number; y1: number;
    x: number; y: number;
}


export interface GCodeParams {
    spindleSpeed: number;
    feedRate: number;
    plungeRate: number;
    depthOfCut: number;
    safeZ: number;
    toolDiameter: number;
    cutMode: 'on-line' | 'inside' | 'outside';
}

// Simple point interface
export interface Point {
    x: number;
    y: number;
}

export interface Segment {
    p1: Point;
    p2: Point;
    type: 'G0' | 'G1';
}

// Convert Cubic Bezier to lines
function flattenCubicBezier(
    p0: Point,
    p1: Point,
    p2: Point,
    p3: Point,
    segments: number = 10
): Point[] {
    const points: Point[] = [];
    for (let i = 1; i <= segments; i++) {
        const t = i / segments;
        const invT = 1 - t;
        const x =
            invT * invT * invT * p0.x +
            3 * invT * invT * t * p1.x +
            3 * invT * t * t * p2.x +
            t * t * t * p3.x;
        const y =
            invT * invT * invT * p0.y +
            3 * invT * invT * t * p1.y +
            3 * invT * t * t * p2.y +
            t * t * t * p3.y;
        points.push({ x, y });
    }
    return points;
}

// Convert Quadratic Bezier to lines
function flattenQuadraticBezier(
    p0: Point,
    p1: Point,
    p2: Point,
    segments: number = 10
): Point[] {
    const points: Point[] = [];
    for (let i = 1; i <= segments; i++) {
        const t = i / segments;
        const invT = 1 - t;
        const x = invT * invT * p0.x + 2 * invT * t * p1.x + t * t * p2.x;
        const y = invT * invT * p0.y + 2 * invT * t * p1.y + t * t * p2.y;
        points.push({ x, y });
    }
    return points;
}

// Main generation function
export const generateGCode = (svgContent: string, params: GCodeParams): { gcode: string, segments: Segment[] } => {
    const parsed = parse(svgContent);
    const paths: string[] = [];

    const extractPaths = (nodes: SvgNode[]) => {
        nodes.forEach((node) => {
            if (node.type === 'element') {
                const element = node;
                if (element.tagName === 'path') {
                    const d = element.properties?.d;
                    if (typeof d === 'string') {
                        paths.push(d);
                    }
                } else if (['g', 'svg'].includes(element.tagName || '')) {
                    if (element.children) extractPaths(element.children);
                }
            }
        });
    };

    if (parsed.children) {
        extractPaths(parsed.children as SvgNode[]);
    }

    const gcodeLines: string[] = [
        '; G-Code wygenerowany z SVG',
        `G21 ; Jednostki w mm`,
        `G90 ; Pozycjonowanie absolutne`,
        `M3 S${params.spindleSpeed} ; Start wrzeciona`,
        `G0 Z${params.safeZ} ; Powrót na bezpieczne Z`,
        `F${params.feedRate} ; Ustaw posuw`
    ];

    // Scale factor for Clipper (integer math)
    const SCALE = 1000;
    const visualizationSegments: Segment[] = [];
    let headPos: Point = { x: 0, y: 0 }; // Track current head position (assumed 0,0 at start)

    paths.forEach((d) => {
        const commands = makeAbsolute(parsePathData(d));
        let currentPos: Point = { x: 0, y: 0 };
        const rawPath: { X: number, Y: number }[] = [];

        // Convert SVG path to polyline for Clipper
        commands.forEach((cmd: Command) => {
            if (cmd.code === 'M') {
                currentPos = { x: cmd.x, y: cmd.y };
                rawPath.push({ X: currentPos.x * SCALE, Y: currentPos.y * SCALE });
            } else if (['L', 'H', 'V'].includes(cmd.code)) {
                let target = { ...currentPos };
                if (cmd.code === 'L') target = { x: (cmd as any).x, y: (cmd as any).y };
                if (cmd.code === 'H') target.x = (cmd as any).x;
                if (cmd.code === 'V') target.y = (cmd as any).y;
                currentPos = target;
                rawPath.push({ X: currentPos.x * SCALE, Y: currentPos.y * SCALE });
            } else if (cmd.code === 'C') {
                const c = cmd as CommandC;
                const points = flattenCubicBezier(
                    currentPos,
                    { x: c.x1, y: c.y1 },
                    { x: c.x2, y: c.y2 },
                    { x: c.x, y: c.y }
                );
                points.forEach(p => rawPath.push({ X: p.x * SCALE, Y: p.y * SCALE }));
                currentPos = { x: c.x, y: c.y };
            } else if (cmd.code === 'Q') {
                const q = cmd as CommandQ;
                const points = flattenQuadraticBezier(
                    currentPos,
                    { x: q.x1, y: q.y1 },
                    { x: q.x, y: q.y }
                );
                points.forEach(p => rawPath.push({ X: p.x * SCALE, Y: p.y * SCALE }));
                currentPos = { x: q.x, y: q.y };
            } else if ('x' in cmd && 'y' in cmd) {
                const target = { x: (cmd as any).x, y: (cmd as any).y };
                currentPos = target;
                rawPath.push({ X: currentPos.x * SCALE, Y: currentPos.y * SCALE });
            }
            // For Z we assume close path, handled by Clipper or just ignored for open path logic
        });

        let finalPaths: { X: number, Y: number }[][] = [];

        if (params.cutMode === 'on-line') {
            finalPaths = [rawPath];
        } else {
            // Offset logic
            const co = new ClipperLib.ClipperOffset();
            const offsetPaths = new ClipperLib.Paths();

            // Setup Clipper paths
            const subjPath = new ClipperLib.Path();
            rawPath.forEach(p => subjPath.push(p));

            // Add path, JoinType (Round=2), EndType (ClosedPolygon=0 or Open=?)
            co.AddPath(subjPath, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);

            const offset = (params.toolDiameter / 2.0) * SCALE;
            const delta = params.cutMode === 'outside' ? offset : -offset;

            co.Execute(offsetPaths, delta);

            // Convert back
            if (offsetPaths && offsetPaths.length > 0) {
                finalPaths = offsetPaths;
            } else {
                console.warn("Offset resulted in empty path (feature too small?)");
                finalPaths = [];
            }
        }

        // Generate G-code for each resulting path (could be multiple if one shape splits)
        finalPaths.forEach(path => {
            if (path.length === 0) return;

            // Move to start
            const startIdx = 0;
            const p0 = { x: path[startIdx].X / SCALE, y: path[startIdx].Y / SCALE };

            // G0 Rapid Move to Start (Green)
            visualizationSegments.push({ p1: { ...headPos }, p2: { ...p0 }, type: 'G0' });
            headPos = { ...p0 };

            gcodeLines.push(`G0 X${p0.x.toFixed(3)} Y${p0.y.toFixed(3)}`);
            gcodeLines.push(`G0 Z${params.safeZ} ; Najazd`);
            gcodeLines.push(`G1 Z-${params.depthOfCut} F${params.plungeRate} ; Wjazd`);
            gcodeLines.push(`F${params.feedRate}`);

            for (let i = 1; i < path.length; i++) {
                const p = { x: path[i].X / SCALE, y: path[i].Y / SCALE };

                // G1 Cut Move (Red)
                visualizationSegments.push({ p1: { ...headPos }, p2: { ...p }, type: 'G1' });
                headPos = { ...p };

                gcodeLines.push(`G1 X${p.x.toFixed(3)} Y${p.y.toFixed(3)}`);
            }

            // Close loop if it was closed source
            if (path.length > 2) {
                // G1 Close Cut (Red)
                visualizationSegments.push({ p1: { ...headPos }, p2: { ...p0 }, type: 'G1' });
                headPos = { ...p0 };

                gcodeLines.push(`G1 X${p0.x.toFixed(3)} Y${p0.y.toFixed(3)}`);
            }

            gcodeLines.push(`G0 Z${params.safeZ} ; Wyjazd`);
        });
    });

    // Return to home
    visualizationSegments.push({ p1: { ...headPos }, p2: { x: 0, y: 0 }, type: 'G0' });

    gcodeLines.push('M5 ; Zatrzymaj wrzeciono');
    gcodeLines.push('G0 X0 Y0 ; Powrót do bazy');
    gcodeLines.push('M30 ; Koniec programu');

    return { gcode: gcodeLines.join('\n'), segments: visualizationSegments };
};
