#!/usr/bin/env node
import { createRequire } from 'node:module';
import { Command, InvalidArgumentError } from 'commander';
import { checkUnconverted, convertPath, SOURCE_EXTENSIONS } from './convert.js';
import { printReport } from './report.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

function parseQuality(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 100) {
    throw new InvalidArgumentError('quality 必须是 1-100 的整数');
  }
  return n;
}

function parseWidths(value: string): number[] {
  const widths = value
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((n) => Number.isInteger(n) && n > 0);
  if (widths.length === 0) {
    throw new InvalidArgumentError('width 至少需要一个正整数，例如 --width 512,128');
  }
  return [...new Set(widths)].sort((a, b) => b - a);
}

const program = new Command();
program
  .name('webp-forge')
  .description('把项目里的 png/jpg/jpeg/avif/gif 批量转成 WebP：预设、响应式变体、增量清单、CI 检查一条龙')
  .version(version, '-V, --version', '显示版本号');

program
  .command('convert')
  .argument('<path>', '要转换的文件或目录')
  .option('--preset <name>', '预设：photo（默认）| graphics | icon', 'photo')
  .option('--quality <n>', '覆盖预设的质量值（1-100 整数）', parseQuality)
  .option('--width <sizes>', '额外生成指定宽度的响应式变体，如 --width 512,128', parseWidths)
  .option('--manifest [file]', '启用增量清单（缺省文件名 .webp-forge.json），未变化的源文件自动跳过')
  .option('--force', '忽略清单，全部重新转换')
  .option('--delete-source', '转换成功后删除源文件')
  .option('--keep-metadata', '保留 EXIF/GPS 元数据（默认剥离，隐私优先）')
  .option('--check', 'CI 模式：只列出未转换的位图并返回退出码 1，不做转换')
  .option('--report', '输出前后体积对比报告')
  .action(async (target: string, opts: {
    preset: string;
    quality?: number;
    width?: number[];
    manifest?: string | boolean;
    force?: boolean;
    deleteSource?: boolean;
    keepMetadata?: boolean;
    check?: boolean;
    report?: boolean;
  }) => {
    try {
      if (opts.check) {
        const unconverted = await checkUnconverted(target);
        if (unconverted.length === 0) {
          console.log('OK：所有位图均已转换为 WebP。');
          return;
        }
        console.error(`发现 ${unconverted.length} 个未转换的位图：`);
        for (const file of unconverted) console.error(`  ${file}`);
        process.exitCode = 1;
        return;
      }

      const stats = await convertPath(target, {
        preset: opts.preset,
        quality: opts.quality,
        widths: opts.width,
        manifestPath: opts.manifest,
        force: opts.force,
        deleteSource: opts.deleteSource,
        keepMetadata: opts.keepMetadata,
      });

      console.log(
        `webp-forge：转换 ${stats.converted}，跳过 ${stats.skipped}，失败 ${stats.failed}` +
          (stats.variantsSkipped > 0 ? `，跳过上采样变体 ${stats.variantsSkipped}` : ''),
      );
      for (const file of stats.files) {
        if (file.status === 'failed') console.error(`  失败 ${file.source}：${file.error}`);
      }
      if (opts.report) printReport(stats);
      if (stats.failed > 0) process.exitCode = 1;
    } catch (err) {
      console.error(`webp-forge：${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
  });

program.addHelpText('after', `\n支持的源格式：${[...SOURCE_EXTENSIONS].map((e) => e.slice(1)).join(' / ')} → webp`);

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(`webp-forge：${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
