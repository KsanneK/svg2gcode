import { useState } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { Upload, Cog, Play } from 'lucide-react';
import './App.css';
import { generateGCode, GCodeParams } from './lib/gcode';

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
      const gcode = generateGCode(svgContent, params);
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
    } catch (err) {
      console.error(err);
      alert('Nie udało się zapisać pliku: ' + err);
    }
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

          <div style={{ marginTop: 'auto', textAlign: 'right' }}>
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
    </div>
  );
}

export default App;
