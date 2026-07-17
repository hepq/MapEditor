import { useCallback, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';

interface FileUploaderProps {
  onFileLoaded: (content: string, fileName: string) => void;
}

export function FileUploader({ onFileLoaded }: FileUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const readFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          onFileLoaded(reader.result, file.name);
        }
      };
      reader.readAsText(file);
    },
    [onFileLoaded],
  );

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) readFile(file);
    event.target.value = '';
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) readFile(file);
  };

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      style={{
        border: `2px dashed ${isDragging ? '#4a90d9' : '#999'}`,
        borderRadius: 8,
        padding: '2rem',
        textAlign: 'center',
        cursor: 'pointer',
        background: isDragging ? '#eef6ff' : 'transparent',
      }}
    >
      <p>Sparebeat譜面JSONファイルをドラッグ&ドロップ、またはクリックして選択してください</p>
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        onChange={handleInputChange}
        style={{ display: 'none' }}
      />
    </div>
  );
}
