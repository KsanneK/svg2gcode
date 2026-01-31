import { useState, useRef, useEffect } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { Upload, Cog, Play, Eye, X } from 'lucide-react';
import './App.css';
import { generateGCode, GCodeParams, Segment } from './lib/gcode';

function App() {
  const [svgContent, setSvgContent] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [params, setParams] = useState<GCodeParams>({
    spindleSpeed: 12000,
    feedRate: 800,
    plungeRate: 300,
    depthOfCut: 1.0,
    safeZ: 5.0,
    toolDiameter: 3.175,
    cutMode: 'on-line',
  });
  const [showPreview, setShowPreview] = useState(false);
  const [previewSegments, setPreviewSegments] = useState<Segment[]>([]);
  const [playedIndex, setPlayedIndex] = useState(0);
  const animationInterval = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (animationInterval.current) clearInterval(animationInterval.current);
    };
  }, []);

  const runAnimation = (segments: Segment[]) => {
    if (animationInterval.current) clearInterval(animationInterval.current);
    setPlayedIndex(0);

    let idx = 0;
    animationInterval.current = window.setInterval(() => {
      idx += 5;
      if (idx > segments.length) {
        idx = segments.length;
        if (animationInterval.current) {
          clearInterval(animationInterval.current);
          animationInterval.current = null;
        }
      }
      setPlayedIndex(idx);
    }, 16);
  };

  const handleFileSelect = async () => {
    // In a web/tauri context, we can use a hidden input or drag/drop
    // For simplicity, let's use a hidden file input triggered by button
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.svg';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        setFileName(file.name);
        const text = await file.text();
        setSvgContent(text);
      }
    };
    input.click();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setParams((prev) => ({ ...prev, [name]: parseFloat(value) }));
  };

  const handleConvert = async () => {
    if (!svgContent) return;

    try {
      const { gcode } = generateGCode(svgContent, params);
      const path = await save({
        filters: [{
          name: 'G-Code',
          extensions: ['gcode', 'nc']
        }],
        defaultPath: fileName ? fileName.replace('.svg', '.gcode') : 'output.gcode'
      });

      if (path) {
        await writeTextFile(path, gcode);
        alert('Plik G-code został pomyślnie zapisany!');
      }
    } catch (err: any) {
      console.error(err);
      if (err.toString().includes("reading 'invoke'")) {
        alert("Błąd: Ta funkcja działa tylko w aplikacji desktopowej Tauri, a nie w przeglądarce internetowej.");
      } else {
        alert('Nie udało się zapisać pliku: ' + err);
      }
    }
  };

  const handlePreview = () => {
    if (!svgContent) return;
    const { segments } = generateGCode(svgContent, params);
    setPreviewSegments(segments);
    setShowPreview(true);
    runAnimation(segments);
  };

  return (
    <div className="container">
      <div className="sidebar">
        <h1>SVG 2 GCode</h1>

        <div className="card">
          <div className="form-group">
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: 0 }}>
              <Cog size={20} /> Parametry
            </h2>
          </div>

          <div className="form-group">
            <label>Prędkość wrzeciona (RPM)</label>
            <input
              type="number"
              className="form-input"
              name="spindleSpeed"
              value={params.spindleSpeed}
              onChange={handleChange}
            />
          </div>

          <div className="form-group">
            <label>Posuw (mm/min)</label>
            <input
              type="number"
              className="form-input"
              name="feedRate"
              value={params.feedRate}
              onChange={handleChange}
            />
          </div>

          <div className="form-group">
            <label>Prędkość zagłębiania (mm/min)</label>
            <input
              type="number"
              className="form-input"
              name="plungeRate"
              value={params.plungeRate}
              onChange={handleChange}
            />
          </div>

          <div className="form-group">
            <label>Głębokość frezowania (mm)</label>
            <input
              type="number"
              className="form-input"
              name="depthOfCut"
              value={params.depthOfCut}
              step="0.1"
              onChange={handleChange}
            />
          </div>

          <div className="form-group">
            <label>Bezpieczne Z (mm)</label>
            <input
              type="number"
              className="form-input"
              name="safeZ"
              value={params.safeZ}
              step="1"
              onChange={handleChange}
            />
          </div>

          <div className="form-group">
            <label>Średnica narzędzia (mm)</label>
            <input
              type="number"
              className="form-input"
              name="toolDiameter"
              value={params.toolDiameter}
              step="0.1"
              onChange={handleChange}
            />
          </div>

          <div className="form-group">
            <label>Tryb cięcia</label>
            <select
              className="form-input"
              name="cutMode"
              value={params.cutMode}
              // @ts-ignore
              onChange={(e) => setParams(prev => ({ ...prev, cutMode: e.target.value }))}
            >
              <option value="on-line">Po linii (Brak kompensacji)</option>
              <option value="outside">Na zewnątrz (Outside)</option>
              <option value="inside">Wewnątrz (Inside)</option>
            </select>
          </div>
        </div>
      </div>

      <div className="main-content">
        <div className="card" style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div
            className="dropzone"
            onClick={handleFileSelect}
            onDragOver={(e) => e.preventDefault()}
            onDrop={async (e) => {
              e.preventDefault();
              const file = e.dataTransfer.files[0];
              if (file && file.name.endsWith('.svg')) {
                setFileName(file.name);
                const text = await file.text();
                setSvgContent(text);
              }
            }}
          >
            <Upload size={48} color="var(--accent-primary)" />
            <div>
              <h3>{fileName || 'Prześlij plik SVG'}</h3>
              <p style={{ color: 'var(--text-secondary)' }}>Kliknij lub przeciągnij plik SVG tutaj</p>
            </div>
          </div>

          <div className="preview-area">
            {svgContent ? (
              <div
                className="preview-svg"
                dangerouslySetInnerHTML={{ __html: svgContent }}
                style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              />
            ) : (
              <p>Podgląd pojawi się tutaj</p>
            )}
          </div>

          <div style={{ marginTop: 'auto', textAlign: 'right', display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
            <button
              className="btn"
              style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
              onClick={handlePreview}
              disabled={!svgContent}
            >
              <Eye size={20} /> Podgląd wycinania
            </button>
            <button
              className="btn btn-primary"
              onClick={handleConvert}
              disabled={!svgContent}
            >
              <Play size={20} /> Generuj G-Code
            </button>
          </div>
        </div>
      </div>

      {showPreview && (
        <div className="modal-overlay">
          <div className="modal-content">
            <button className="close-button" onClick={() => setShowPreview(false)}>
              <X size={24} />
            </button>
            <h2>Podgląd ścieżki narzędzia</h2>

            {(() => {
              if (previewSegments.length === 0) return <p>Brak ścieżek do wyświetlenia</p>;

              // Find bounds
              let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
              previewSegments.forEach(s => {
                minX = Math.min(minX, s.p1.x, s.p2.x);
                minY = Math.min(minY, s.p1.y, s.p2.y);
                maxX = Math.max(maxX, s.p1.x, s.p2.x);
                maxY = Math.max(maxY, s.p1.y, s.p2.y);
              });

              if (minX === Infinity) { minX = 0; minY = 0; maxX = 100; maxY = 100; }

              const padding = 10;
              const vb = `${minX - padding} ${minY - padding} ${maxX - minX + padding * 2} ${maxY - minY + padding * 2}`;

              const visibleSegments = previewSegments.slice(0, playedIndex);
              const lastSegment = visibleSegments[visibleSegments.length - 1];

              return (
                <div className="preview-container">
                  <svg viewBox={vb} style={{ width: '100%', height: '100%', background: '#fff' }}>
                    <g transform="scale(1, 1)">
                      {/* Grid / Origin */}
                      <line x1={minX - padding} y1="0" x2={maxX + padding} y2="0" stroke="#eee" strokeWidth="0.5" />
                      <line x1="0" y1={minY - padding} x2="0" y2={maxY + padding} stroke="#eee" strokeWidth="0.5" />

                      {/* Dimensions Lines */}
                      {/* Width */}
                      <line x1={minX} y1={maxY + 5} x2={maxX} y2={maxY + 5} stroke="#666" strokeWidth="0.5" />
                      <line x1={minX} y1={maxY + 2} x2={minX} y2={maxY + 8} stroke="#666" strokeWidth="0.5" />
                      <line x1={maxX} y1={maxY + 2} x2={maxX} y2={maxY + 8} stroke="#666" strokeWidth="0.5" />
                      <text x={(minX + maxX) / 2} y={maxY + 12} fontSize="4" textAnchor="middle" fill="#666">
                        {(maxX - minX).toFixed(1)} mm
                      </text>

                      {/* Height */}
                      <line x1={minX - 5} y1={minY} x2={minX - 5} y2={maxY} stroke="#666" strokeWidth="0.5" />
                      <line x1={minX - 8} y1={minY} x2={minX - 2} y2={minY} stroke="#666" strokeWidth="0.5" />
                      <line x1={minX - 8} y1={maxY} x2={minX - 2} y2={maxY} stroke="#666" strokeWidth="0.5" />
                      <text x={minX - 10} y={(minY + maxY) / 2} fontSize="4" textAnchor="middle" fill="#666" transform={`rotate(-90 ${minX - 10} ${(minY + maxY) / 2})`}>
                        {(maxY - minY).toFixed(1)} mm
                      </text>

                      {visibleSegments.map((seg, i) => (
                        <line
                          key={i}
                          x1={seg.p1.x}
                          y1={seg.p1.y}
                          x2={seg.p2.x}
                          y2={seg.p2.y}
                          stroke={seg.type === 'G0' ? '#22c55e' : '#ef4444'}
                          strokeWidth={seg.type === 'G0' ? 0.5 : 1.5}
                          strokeDasharray={seg.type === 'G0' ? "4 2" : "none"}
                          opacity={seg.type === 'G0' ? 0.6 : 1}
                          vectorEffect="non-scaling-stroke"
                        />
                      ))}

                      {/* Tool Head Position */}
                      {lastSegment && (
                        <circle
                          cx={lastSegment.p2.x}
                          cy={lastSegment.p2.y}
                          r={Math.max(1, (maxX - minX) / 100)}
                          fill="blue"
                          fillOpacity="0.5"
                        />
                      )}
                    </g>
                  </svg>
                </div>
              );
            })()}

            <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ color: 'var(--text-secondary)', display: 'flex', gap: '1rem', fontSize: '0.9rem' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                  <span style={{ width: 10, height: 10, background: '#ef4444', borderRadius: 2 }}></span> Cięcie (G1)
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                  <span style={{ width: 10, height: 10, background: '#22c55e', borderRadius: 2 }}></span> Ruch jałowy (G0)
                </span>
              </div>
              <button
                className="btn"
                style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', padding: '0.5rem 1rem' }}
                onClick={() => runAnimation(previewSegments)}
              >
                Ponów animację
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
