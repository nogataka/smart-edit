import { useCallback } from 'react';

interface ExportButtonProps {
  getData: () => string;
  filename: string;
  label?: string;
  className?: string;
}

export function ExportButton({
  getData,
  filename,
  label = 'Export All',
  className = ''
}: ExportButtonProps) {
  const handleExport = useCallback(() => {
    const data = getData();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);
  }, [getData, filename]);

  return (
    <button type="button" className={`btn export-btn ${className}`} onClick={handleExport}>
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        style={{ marginRight: '6px' }}
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      {label}
    </button>
  );
}
