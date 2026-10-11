import type { ConvertStats } from './convert.js';

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '-';
  const units = ['B', 'KB', 'MB', 'GB'] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

/** 输出前后体积对比报告（--report）。 */
export function printReport(stats: ConvertStats): void {
  const rows = stats.files.filter((f) => f.status === 'converted' && f.sourceBytes > 0);
  if (rows.length === 0) {
    console.log('本次没有新转换的文件，无体积对比。');
    return;
  }
  const MAX_ROWS = 50;
  for (const file of rows.slice(0, MAX_ROWS)) {
    const saved = ((file.sourceBytes - file.outputBytes) / file.sourceBytes) * 100;
    console.log(`  ${file.source}  ${formatBytes(file.sourceBytes)} → ${formatBytes(file.outputBytes)}  (-${saved.toFixed(1)}%)`);
  }
  if (rows.length > MAX_ROWS) {
    console.log(`  …（共 ${rows.length} 个文件，仅显示前 ${MAX_ROWS} 行）`);
  }
  const savedTotal = ((stats.sourceBytes - stats.outputBytes) / stats.sourceBytes) * 100;
  console.log(
    `合计 ${formatBytes(stats.sourceBytes)} → ${formatBytes(stats.outputBytes)}（节省 ${savedTotal.toFixed(1)}%）`,
  );
}
