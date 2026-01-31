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
    passDepth: number; // Depth per pass for multi-pass cutting
    safeZ: number;
    toolDiameter: number;
    cutMode: 'on-line' | 'inside' | 'outside';
    plungeMode: 'vertical' | 'spiral';
    pathOrdering: 'natural' | 'inside-out'; // Order paths from smallest to largest
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

    const allFinalPaths: { X: number, Y: number }[][] = [];

    paths.forEach((d) => {
        const commands = makeAbsolute(parsePathData(d));
        let currentPos: Point = { x: 0, y: 0 };

        // Collection of all sub-paths from this single path element (which may be a compound path with multiple M commands)
        const subPaths: { X: number, Y: number }[][] = [];
        let currentSubPath: { X: number, Y: number }[] = [];

        // Convert SVG path to polyline for Clipper
        commands.forEach((cmd: Command) => {
            if (cmd.code === 'M') {
                // If we have an existing subpath with data, save it
                if (currentSubPath.length > 0) {
                    subPaths.push(currentSubPath);
                }
                // Start a new subpath
                currentSubPath = [];
                currentPos = { x: cmd.x, y: cmd.y };
                currentSubPath.push({ X: currentPos.x * SCALE, Y: currentPos.y * SCALE });
            } else if (['L', 'H', 'V'].includes(cmd.code)) {
                let target = { ...currentPos };
                if (cmd.code === 'L') target = { x: (cmd as any).x, y: (cmd as any).y };
                if (cmd.code === 'H') target.x = (cmd as any).x;
                if (cmd.code === 'V') target.y = (cmd as any).y;
                currentPos = target;
                currentSubPath.push({ X: currentPos.x * SCALE, Y: currentPos.y * SCALE });
            } else if (cmd.code === 'C') {
                const c = cmd as CommandC;
                const points = flattenCubicBezier(
                    currentPos,
                    { x: c.x1, y: c.y1 },
                    { x: c.x2, y: c.y2 },
                    { x: c.x, y: c.y }
                );
                points.forEach(p => currentSubPath.push({ X: p.x * SCALE, Y: p.y * SCALE }));
                currentPos = { x: c.x, y: c.y };
            } else if (cmd.code === 'Q') {
                const q = cmd as CommandQ;
                const points = flattenQuadraticBezier(
                    currentPos,
                    { x: q.x1, y: q.y1 },
                    { x: q.x, y: q.y }
                );
                points.forEach(p => currentSubPath.push({ X: p.x * SCALE, Y: p.y * SCALE }));
                currentPos = { x: q.x, y: q.y };
            } else if ('x' in cmd && 'y' in cmd) {
                const target = { x: (cmd as any).x, y: (cmd as any).y };
                currentPos = target;
                currentSubPath.push({ X: currentPos.x * SCALE, Y: currentPos.y * SCALE });
            }
        });

        // Don't forget the last subpath
        if (currentSubPath.length > 0) {
            subPaths.push(currentSubPath);
        }

        if (params.cutMode === 'on-line') {
            allFinalPaths.push(...subPaths);
        } else {
            // Offset logic
            const co = new ClipperLib.ClipperOffset();
            const offsetPaths = new ClipperLib.Paths();

            // Add ALL subpaths to Clipper
            subPaths.forEach(sub => {
                const subjPath = new ClipperLib.Path();
                sub.forEach(p => subjPath.push(p));
                co.AddPath(subjPath, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
            });

            const offset = (params.toolDiameter / 2.0) * SCALE;
            const delta = params.cutMode === 'outside' ? offset : -offset;

            co.Execute(offsetPaths, delta);

            // Convert back
            if (offsetPaths && offsetPaths.length > 0) {
                for (let i = 0; i < offsetPaths.length; i++) {
                    allFinalPaths.push(offsetPaths[i]);
                }
            } else {
                console.warn("Offset resulted in empty path (feature too small?)");
            }
        }
    });

    // Sort paths if requested
    if (params.pathOrdering === 'inside-out') {
        allFinalPaths.sort((a, b) => {
            const areaA = Math.abs(ClipperLib.Clipper.Area(a));
            const areaB = Math.abs(ClipperLib.Clipper.Area(b));
            return areaA - areaB;
        });
    }

    // Generate G-code for each resulting path (could be multiple if one shape splits)
    allFinalPaths.forEach(path => {
        if (path.length === 0) return;

        // Move to start
        const startIdx = 0;
        const p0 = { x: path[startIdx].X / SCALE, y: path[startIdx].Y / SCALE };

        // Calculate number of passes needed
        const numPasses = Math.ceil(params.depthOfCut / params.passDepth);

        // Multi-pass cutting loop
        for (let passIndex = 0; passIndex < numPasses; passIndex++) {
            // Calculate current pass depth (last pass might be shallower)
            const currentDepth = Math.min((passIndex + 1) * params.passDepth, params.depthOfCut);
            const isFirstPass = passIndex === 0;
            const isLastPass = passIndex === numPasses - 1;

            gcodeLines.push(`; Pass ${passIndex + 1}/${numPasses} - Depth: ${currentDepth.toFixed(3)}mm`);

            // Move to start position (only for first pass, otherwise already there)
            if (isFirstPass) {
                // G0 Rapid Move to Start (Green)
                visualizationSegments.push({ p1: { ...headPos }, p2: { ...p0 }, type: 'G0' });
                headPos = { ...p0 };

                gcodeLines.push(`G0 X${p0.x.toFixed(3)} Y${p0.y.toFixed(3)}`);
                gcodeLines.push(`G0 Z${params.safeZ} ; Najazd`);
            }

            // Plunge to current depth
            const plungeDepth = currentDepth;

            if (params.plungeMode === 'vertical' || !isFirstPass) {
                // Vertical plunge - straight down (always use vertical for subsequent passes)
                gcodeLines.push(`G1 Z-${plungeDepth.toFixed(3)} F${params.plungeRate} ; Wjazd ${isFirstPass ? 'pionowy' : 'do kolejnej głębokości'}`);
            } else {
                // Spiral plunge - only for first pass
                const spiralRadius = params.toolDiameter * 0.75;

                if (path.length > 1) {
                    const p1 = { x: path[1].X / SCALE, y: path[1].Y / SCALE };
                    const dx = p1.x - p0.x;
                    const dy = p1.y - p0.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);

                    if (dist > 0.001) {
                        // Perpendicular direction for spiral
                        const perpX = -dy / dist;
                        const perpY = dx / dist;

                        // Create a small arc
                        const arcX = p0.x + perpX * spiralRadius;
                        const arcY = p0.y + perpY * spiralRadius;

                        gcodeLines.push(`G1 X${arcX.toFixed(3)} Y${arcY.toFixed(3)} Z${(-plungeDepth / 2).toFixed(3)} F${params.plungeRate} ; Wjazd spiralny - część 1`);
                        gcodeLines.push(`G1 X${p0.x.toFixed(3)} Y${p0.y.toFixed(3)} Z-${plungeDepth.toFixed(3)} F${params.plungeRate} ; Wjazd spiralny - część 2`);

                        // Update head position for visualization
                        visualizationSegments.push({ p1: { ...headPos }, p2: { x: arcX, y: arcY }, type: 'G1' });
                        visualizationSegments.push({ p1: { x: arcX, y: arcY }, p2: { ...p0 }, type: 'G1' });
                        headPos = { ...p0 };
                    } else {
                        gcodeLines.push(`G1 Z-${plungeDepth.toFixed(3)} F${params.plungeRate} ; Wjazd pionowy (fallback)`);
                    }
                } else {
                    gcodeLines.push(`G1 Z-${plungeDepth.toFixed(3)} F${params.plungeRate} ; Wjazd pionowy (fallback)`);
                }
            }

            gcodeLines.push(`F${params.feedRate}`);

            // Cut the path at current depth
            for (let i = 1; i < path.length; i++) {
                const p = { x: path[i].X / SCALE, y: path[i].Y / SCALE };

                // G1 Cut Move (Red)
                visualizationSegments.push({ p1: { ...headPos }, p2: { ...p }, type: 'G1' });
                headPos = { ...p };

                gcodeLines.push(`G1 X${p.x.toFixed(3)} Y${p.y.toFixed(3)}`);
            }

            // Close loop logic check
            if (path.length > 2) {
                // G1 Close Cut (Red)
                visualizationSegments.push({ p1: { ...headPos }, p2: { ...p0 }, type: 'G1' });
                headPos = { ...p0 };

                gcodeLines.push(`G1 X${p0.x.toFixed(3)} Y${p0.y.toFixed(3)}`);
            }

            // Retract after last pass, or prepare for next pass
            if (isLastPass) {
                gcodeLines.push(`G0 Z${params.safeZ} ; Wyjazd`);
            } else {
                // Stay at current position for next pass
                gcodeLines.push(`; Preparing for next pass...`);
            }
        }
    });

    // Return to home
    visualizationSegments.push({ p1: { ...headPos }, p2: { x: 0, y: 0 }, type: 'G0' });

    gcodeLines.push('M5 ; Zatrzymaj wrzeciono');
    gcodeLines.push('G0 X0 Y0 ; Powrót do bazy');
    gcodeLines.push('M30 ; Koniec programu');

    return { gcode: gcodeLines.join('\n'), segments: visualizationSegments };
};
