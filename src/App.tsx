import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { FileUploader } from './components/FileUploader';
import { JsonOutputViewer } from './components/JsonOutputViewer';
import { parseSparebeatChart } from './parser/parseSparebeatChart';
import { serializeChartProject } from './serializer/serializeChartProject';
import type { ChartProject } from './types/chartProject';
import type { SparebeatChartJSON } from './types/sparebeat';

type ViewMode = 'internal' | 'sparebeat';

export default function App() {
  const [result, setResult] = useState<ChartProject | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [baseName, setBaseName] = useState('chart');
  const [view, setView] = useState<ViewMode>('internal');

  const exported = useMemo(() => {
    if (!result) return null;
    try {
      return { data: serializeChartProject(result), error: null as string | null };
    } catch (e) {
      return {
        data: null,
        error: `Sparebeat形式への変換に失敗しました: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }, [result]);

  const handleFileLoaded = (content: string, fileName: string) => {
    setError(null);
    setResult(null);
    setView('internal');

    let json: SparebeatChartJSON;
    try {
      json = JSON.parse(content);
    } catch (e) {
      setError(`JSONの読み込みに失敗しました: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    try {
      const project = parseSparebeatChart(json);
      setResult(project);
      setBaseName(fileName.replace(/\.json$/i, ''));
    } catch (e) {
      setError(`譜面の変換に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const tabStyle = (active: boolean): CSSProperties => ({
    padding: '0.4rem 1rem',
    borderRadius: 6,
    border: `1px solid ${active ? '#4a90d9' : '#ccc'}`,
    background: active ? '#4a90d9' : 'transparent',
    color: active ? '#fff' : 'inherit',
    cursor: 'pointer',
  });

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>Sparebeat Editor</h1>
      <FileUploader onFileLoaded={handleFileLoaded} />
      {error && <p style={{ color: '#c0392b', marginTop: '1rem', whiteSpace: 'pre-wrap' }}>{error}</p>}
      {result && (
        <div style={{ marginTop: '1.5rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button style={tabStyle(view === 'internal')} onClick={() => setView('internal')}>
              内部モデル
            </button>
            <button style={tabStyle(view === 'sparebeat')} onClick={() => setView('sparebeat')}>
              Sparebeat形式（エクスポート）
            </button>
          </div>
          <div style={{ marginTop: '0.75rem' }}>
            {view === 'internal' ? (
              <JsonOutputViewer data={result} fileName={`${baseName}.chart.json`} />
            ) : exported?.data ? (
              <JsonOutputViewer data={exported.data} fileName={`${baseName}.sparebeat.json`} />
            ) : (
              <p style={{ color: '#c0392b', whiteSpace: 'pre-wrap' }}>{exported?.error}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
