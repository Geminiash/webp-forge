import { createHash } from 'node:crypto';
import { createReadStream, existsSync, statSync, promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { presetSignature, resolveWebpOptions } from './presets.js';
import { emptyManifest, loadManifest, saveManifest, type ForgeManifest } from './manifest.js';

export const SOURCE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.avif', '.gif']);

export type FileStatus = 'converted' | 'skipped' | 'failed';

export interface FileResult {
  /** 相对转换根目录的源文件路径（posix） */
  source: string;
  status: FileStatus;
  sourceBytes: number;
  /** 所有 webp 产物（全尺寸 + 变体）的总字节数 */
  outputBytes: number;
  outputs: string[];
  error?: string;
}

export interface ConvertStats {
  converted: number;
  skipped: number;
  failed: number;
  /** 因宽度 >= 源图宽度而被跳过的变体数（避免上采样） */
  variantsSkipped: number;
  /** 仅统计本次转换成功的文件 */
  sourceBytes: number;
  outputBytes: number;
  files: FileResult[];
}

export interface ConvertOptions {
  preset?: string;
  quality?: number;
  widths?: number[];
  /** true → CWD 下 `.webp-forge.json`；string → 指定路径；缺省 → 不用清单 */
  manifestPath?: string | boolean;
  force?: boolean;
  deleteSource?: boolean;
  keepMetadata?: boolean;
}

async function hashFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/** 递归收集源文件；跳过 node_modules 和所有点开头目录/文件。 */
export async function collectSources(root: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        await walk(full);
      } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        found.push(full);
      }
    }
  };
  const stat = await fs.stat(root);
  if (stat.isDirectory()) {
    await walk(root);
  } else if (SOURCE_EXTENSIONS.has(path.extname(root).toLowerCase())) {
    found.push(root);
  }
  return found.sort();
}

function baseOutPath(src: string): string {
  const ext = path.extname(src);
  return src.slice(0, src.length - ext.length) + '.webp';
}

function variantOutPath(src: string, width: number): string {
  const ext = path.extname(src);
  const base = path.basename(src, ext);
  return path.join(path.dirname(src), `${base}-${width}w.webp`);
}

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

function resolveRoot(target: string): string {
  // 单文件输入时以所在目录为根，保证清单/报告里的相对路径有意义
  const abs = path.resolve(target);
  if (existsSync(abs) && statSync(abs).isFile()) return path.dirname(abs);
  return abs;
}

/** 依次解析清单选项：boolean true → CWD/.webp-forge.json，string → 指定路径。 */
function resolveManifestPath(manifest: string | boolean | undefined): string | null {
  if (manifest === true) return path.resolve('.webp-forge.json');
  if (typeof manifest === 'string' && manifest.length > 0) return path.resolve(manifest);
  return null;
}

export async function convertPath(target: string, opts: ConvertOptions = {}): Promise<ConvertStats> {
  const root = resolveRoot(target);
  const presetName = opts.preset ?? 'photo';
  const webpOptions = resolveWebpOptions(presetName, opts.quality);
  const signature = presetSignature(presetName, opts.quality, opts.widths ?? null);

  const stats: ConvertStats = {
    converted: 0,
    skipped: 0,
    failed: 0,
    variantsSkipped: 0,
    sourceBytes: 0,
    outputBytes: 0,
    files: [],
  };

  const sources = await collectSources(root);
  const manifestPath = resolveManifestPath(opts.manifestPath);
  let manifest: ForgeManifest | null = manifestPath ? await loadManifest(manifestPath) : null;
  const hashes = new Map<string, string>();
  const deletedSources: string[] = [];

  for (const src of sources) {
    const rel = toPosix(path.relative(root, src));
    const result: FileResult = { source: rel, status: 'converted', sourceBytes: 0, outputBytes: 0, outputs: [] };
    try {
      const stat = await fs.stat(src);
      result.sourceBytes = stat.size;
      const hash = await hashFile(src);
      hashes.set(rel, hash);

      // 增量跳过：hash + 参数签名 + 产物齐全，三者缺一不可
      if (manifest && !opts.force) {
        const prev = manifest.entries[rel];
        const outputsIntact = prev !== undefined && prev.outputs.every((out) => existsSync(path.join(root, out)));
        if (prev && outputsIntact && prev.hash === hash && prev.signature === signature) {
          result.status = 'skipped';
          stats.skipped += 1;
          stats.files.push(result);
          continue;
        }
      }

      const animated = path.extname(src).toLowerCase() === '.gif';
      const base = sharp(src, { animated });
      const meta = await base.metadata();
      const requested = opts.widths ?? [];
      // 只保留小于源图宽度的变体，拒绝上采样
      const widths = requested.filter((w) => meta.width != null && w < meta.width);
      stats.variantsSkipped += requested.length - widths.length;

      const wrap = (pipe: sharp.Sharp): sharp.Sharp => (opts.keepMetadata ? pipe.withMetadata() : pipe);
      const tasks = [
        { outAbs: baseOutPath(src), pipe: wrap(base.clone()) },
        ...widths.map((w) => ({ outAbs: variantOutPath(src, w), pipe: wrap(base.clone().resize({ width: w })) })),
      ];

      for (const task of tasks) {
        const info = await task.pipe.webp(webpOptions).toFile(task.outAbs);
        result.outputBytes += info.size;
      }
      base.destroy();
      result.outputs = tasks.map((t) => toPosix(path.relative(root, t.outAbs)));
      stats.converted += 1;
      stats.sourceBytes += stat.size;
      stats.outputBytes += result.outputBytes;

      if (opts.deleteSource) {
        await fs.unlink(src);
        deletedSources.push(rel);
      }
    } catch (err) {
      result.status = 'failed';
      result.error = err instanceof Error ? err.message : String(err);
      stats.failed += 1;
    }
    stats.files.push(result);
  }

  if (manifest && manifestPath) {
    for (const file of stats.files) {
      const hash = hashes.get(file.source);
      if (file.status === 'converted' && hash !== undefined) {
        manifest.entries[file.source] = { hash, signature, outputs: file.outputs };
      }
    }
    // 清理已不存在源的条目（含 --delete-source 删掉的）
    for (const key of Object.keys(manifest.entries)) {
      if (deletedSources.includes(key) || !existsSync(path.join(root, key))) {
        delete manifest.entries[key];
      }
    }
    await saveManifest(manifestPath, manifest);
  }

  return stats;
}

/** CI 模式：只扫描不转换，返回尚未有同名 .webp 的位图列表（相对路径，已排序）。 */
export async function checkUnconverted(target: string): Promise<string[]> {
  const root = resolveRoot(target);
  const sources = await collectSources(root);
  return sources
    .filter((src) => !existsSync(baseOutPath(src)))
    .map((src) => toPosix(path.relative(root, src)));
}

export { emptyManifest };
