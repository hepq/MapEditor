interface JsonOutputViewerProps {
  data: unknown;
  fileName: string;
}

export function JsonOutputViewer({ data, fileName }: JsonOutputViewerProps) {
  const jsonText = JSON.stringify(data, null, 2);

  const handleDownload = () => {
    const blob = new Blob([jsonText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <button onClick={handleDownload}>ダウンロード</button>
      <pre
        style={{
          overflow: 'auto',
          maxHeight: '70vh',
          background: '#f5f5f5',
          color: '#222',
          padding: '1rem',
          borderRadius: 8,
          marginTop: '0.75rem',
        }}
      >
        {jsonText}
      </pre>
    </div>
  );
}
