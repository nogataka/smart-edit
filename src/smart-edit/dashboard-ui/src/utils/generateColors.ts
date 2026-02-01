const GRAYSCALE_PALETTE = [
  '#101010', '#1f1f1f', '#2e2e2e', '#3d3d3d', '#4c4c4c',
  '#5b5b5b', '#6a6a6a', '#797979', '#888888', '#979797',
  '#a6a6a6', '#b5b5b5', '#c4c4c4', '#d3d3d3', '#e2e2e2'
];

export function generateColors(count: number): string[] {
  return Array.from({ length: count }, (_, i) => GRAYSCALE_PALETTE[i % GRAYSCALE_PALETTE.length]);
}
