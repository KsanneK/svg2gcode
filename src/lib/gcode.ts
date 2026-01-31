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
interface Point {
    x: number;
    y: number;
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
export const generateGCode = (svgContent: string, params: GCodeParams): { gcode: string, paths: Point[][] } => {
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
    const visualizationPaths: Point[][] = [];

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
            // Assuming paths are closed for offset to make sense usually, but user might have open paths.
            // ClipperOffset works on both.
            // jtRound = 2, etClosedPolygon = 0
            co.AddPath(subjPath, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);

            // Delta: -ve = inside (holes shrink), +ve = outside (expand)
            // But for "Inside" cut of a hole, we want to shrink the hole?
            // Or does user mean "Inside the shape"?
            // If I have a Circle R=50.
            // Inside cut -> R=47.5 (if tool dia=5). Delta = -2.5.
            // Outside cut -> R=52.5. Delta = +2.5.

            const offset = (params.toolDiameter / 2.0) * SCALE;
            const delta = params.cutMode === 'outside' ? offset : -offset;

            co.Execute(offsetPaths, delta);

            // Convert back
            if (offsetPaths && offsetPaths.length > 0) {
                finalPaths = offsetPaths;
            } else {
                // Fallback or error? If offset collapses the shape (too small), result is empty.
                console.warn("Offset resulted in empty path (feature too small?)");
                finalPaths = [];
            }
        }

        // Generate G-code for each resulting path (could be multiple if one shape splits)
        finalPaths.forEach(path => {
            if (path.length === 0) return;

            // Convert back to normal units for visualization
            const vizPath: Point[] = path.map(p => ({ x: p.X / SCALE, y: p.Y / SCALE }));
            visualizationPaths.push(vizPath);

            // Move to start
            const startIdx = 0;
            const p0 = path[startIdx];
            gcodeLines.push(`G0 X${(p0.X / SCALE).toFixed(3)} Y${(p0.Y / SCALE).toFixed(3)}`);
            gcodeLines.push(`G0 Z${params.safeZ} ; Najazd`);
            gcodeLines.push(`G1 Z-${params.depthOfCut} F${params.plungeRate} ; Wjazd`);
            gcodeLines.push(`F${params.feedRate}`);

            for (let i = 1; i < path.length; i++) {
                const p = path[i];
                gcodeLines.push(`G1 X${(p.X / SCALE).toFixed(3)} Y${(p.Y / SCALE).toFixed(3)}`);
            }

            // Close loop if it was closed source
            // Clipper usually returns closed paths for closed inputs
            if (path.length > 2) { // Determine if we should close strictly? 
                // Let's go back to start to ensure full cut
                gcodeLines.push(`G1 X${(p0.X / SCALE).toFixed(3)} Y${(p0.Y / SCALE).toFixed(3)}`);
                // Also close visualization path
                vizPath.push(vizPath[0]);
            }

            gcodeLines.push(`G0 Z${params.safeZ} ; Wyjazd`);
        });
    });

    gcodeLines.push('M5 ; Zatrzymaj wrzeciono');
    gcodeLines.push('M30 ; Koniec programu');

    return { gcode: gcodeLines.join('\n'), paths: visualizationPaths };
};


