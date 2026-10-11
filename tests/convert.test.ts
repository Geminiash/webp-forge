import { spawnSync } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import { checkUnconverted, convertPath } from '../src/convert.js';
import { loadManifest } from '../src/manifest.js';

const tmpRoots: string[] = [];

async function tmpDir(label: string): Promise<string> {
  const dir = path.join(os.tmpdir(), `webp-forge-${label}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
  await fs.mkdir(dir, { recursive: true });
  tmpRoots.push(dir);
  return dir;
}

afterAll(async () => {
  // Windows 上句柄释放滞后于 destroy：整体重试几轮，仍占用则放弃（OS 临时目录，无碍）
  for (const dir of tmpRoots) {
    for (let round = 0; round < 3; round++) {
      try {
        await fs.rm(dir, { recursive: true, force: true });
        break;
      } catch {
        if (round < 2) await new Promise((resolve) => setTimeout(resolve, 400));
      }
    }
  }
});

/** 读完即销毁：未 destroy 的 sharp 实例会占住文件句柄直到 GC，Windows 上导致后续写/删 EBUSY */
async function readMeta(file: string, animated = false) {
  const inst = sharp(file, { animated });
  try {
    return await inst.metadata();
  } finally {
    inst.destroy();
  }
}

async function makePng(file: string, opts: { width?: number; height?: number; alpha?: boolean } = {}): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await sharp({
    create: {
      width: opts.width ?? 100,
      height: opts.height ?? 80,
      channels: opts.alpha ? 4 : 3,
      background: opts.alpha ? { r: 20, g: 120, b: 200, alpha: 0.4 } : { r: 30, g: 60, b: 90 },
    },
  })
    .png()
    .toFile(file);
}

async function makeJpeg(file: string, opts: { exif?: boolean; width?: number; height?: number } = {}): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  let pipe = sharp({
    create: {
      width: opts.width ?? 64,
      height: opts.height ?? 48,
      channels: 3,
      background: { r: 200, g: 100, b: 40 },
    },
  });
  if (opts.exif) pipe = pipe.withMetadata({ exif: { IFD0: { Copyright: 'webp-forge-test' } } });
  await pipe.jpeg().toFile(file);
}

async function makeAnimatedGif(file: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  // create+pages 的 GIF 会被编码器合并为单帧，须以独立帧 join 成动图
  const frame = (r: number, g: number, b: number) =>
    sharp({ create: { width: 32, height: 32, channels: 3, background: { r, g, b } } }).png().toBuffer();
  const [first, second] = await Promise.all([frame(180, 40, 60), frame(40, 60, 180)]);
  await sharp([first, second], { join: { animated: true } }).gif().toFile(file);
}

async function makeNoisyPng(file: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await sharp({
    create: { width: 128, height: 128, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 30 } },
  })
    .png()
    .toFile(file);
}

describe('convertPath', () => {
  it('递归转换 png/jpg/avif 为 webp，保持目录结构与 alpha', async () => {
    const root = await tmpDir('conv');
    await makePng(path.join(root, 'a.png'));
    await makePng(path.join(root, 'alpha.png'), { alpha: true });
    await makePng(path.join(root, 'nested/deep/b.png'), { width: 61, height: 33 });
    await makeJpeg(path.join(root, 'c.jpg'));
    await sharp({
      create: { width: 48, height: 48, channels: 3, background: { r: 10, g: 200, b: 90 } },
    })
      .avif()
      .toFile(path.join(root, 'd.avif'));
    await fs.writeFile(path.join(root, 'notes.txt'), 'ignore me');

    const stats = await convertPath(root, { preset: 'photo' });
    expect(stats.converted).toBe(5);
    expect(stats.failed).toBe(0);

    const metaA = await readMeta(path.join(root, 'a.webp'));
    expect(metaA.format).toBe('webp');
    expect(metaA.width).toBe(100);
    expect(metaA.height).toBe(80);
    expect(metaA.hasAlpha).toBe(false);

    const metaAlpha = await readMeta(path.join(root, 'alpha.webp'));
    expect(metaAlpha.hasAlpha).toBe(true);

    expect(existsSync(path.join(root, 'nested/deep/b.webp'))).toBe(true);
    expect(existsSync(path.join(root, 'c.webp'))).toBe(true);
    expect(existsSync(path.join(root, 'd.webp'))).toBe(true);
    expect(existsSync(path.join(root, 'notes.webp'))).toBe(false);
    expect(stats.outputBytes).toBeLessThan(stats.sourceBytes);
  });

  it('gif 转为动图 webp 并保留帧数', async () => {
    const root = await tmpDir('anim');
    const gif = path.join(root, 'anim.gif');
    await makeAnimatedGif(gif);
    const srcMeta = await readMeta(gif, true);
    expect(srcMeta.pages).toBe(2);

    const stats = await convertPath(root, {});
    expect(stats.converted).toBe(1);

    const outMeta = await readMeta(path.join(root, 'anim.webp'), true);
    expect(outMeta.format).toBe('webp');
    expect(outMeta.pages).toBe(2);
  });

  it('默认剥离 EXIF，--keep-metadata 保留', async () => {
    // 剥离与保留分目录验证：同路径先写后覆盖在 Windows 上有句柄竞态
    const stripRoot = await tmpDir('meta-strip');
    const keepRoot = await tmpDir('meta-keep');
    await makeJpeg(path.join(stripRoot, 'exif.jpg'), { exif: true });
    await makeJpeg(path.join(keepRoot, 'exif.jpg'), { exif: true });

    const stripRun = await convertPath(stripRoot, {});
    expect(stripRun.failed).toBe(0);
    const stripped = await readMeta(path.join(stripRoot, 'exif.webp'));
    expect(stripped.exif).toBeUndefined();

    const keepRun = await convertPath(keepRoot, { keepMetadata: true });
    expect(keepRun.failed).toBe(0);
    const kept = await readMeta(path.join(keepRoot, 'exif.webp'));
    expect(kept.exif?.toString('latin1')).toContain('webp-forge-test');
  });

  it('清单增量：二次运行跳过，源文件变化才重转，force 全量重转', async () => {
    const root = await tmpDir('incr');
    await makePng(path.join(root, 'a.png'));
    await makePng(path.join(root, 'b.png'), { width: 40, height: 40 });
    const manifestPath = path.join(root, '.webp-forge.json');

    const r1 = await convertPath(root, { manifestPath });
    expect(r1.converted).toBe(2);
    const r2 = await convertPath(root, { manifestPath });
    expect(r2.converted).toBe(0);
    expect(r2.skipped).toBe(2);

    await makePng(path.join(root, 'a.png'), { width: 100, height: 80, alpha: true });
    const r3 = await convertPath(root, { manifestPath });
    expect(r3.converted).toBe(1);
    expect(r3.skipped).toBe(1);

    const r4 = await convertPath(root, { manifestPath, force: true });
    expect(r4.converted).toBe(2);
    expect(r4.skipped).toBe(0);

    const manifest = await loadManifest(manifestPath);
    expect(Object.keys(manifest.entries).sort()).toEqual(['a.png', 'b.png']);
  });

  it('换预设触发重转（参数签名变化）', async () => {
    const root = await tmpDir('sig');
    await makePng(path.join(root, 'a.png'));
    const manifestPath = path.join(root, '.webp-forge.json');

    await convertPath(root, { manifestPath, preset: 'photo' });
    const r2 = await convertPath(root, { manifestPath, preset: 'graphics' });
    expect(r2.converted).toBe(1);
    expect(r2.skipped).toBe(0);
  });

  it('--width 生成变体并跳过上采样', async () => {
    const root = await tmpDir('widths');
    await makePng(path.join(root, 'big.png'), { width: 200, height: 100 });

    const stats = await convertPath(root, { widths: [128, 300] });
    expect(stats.variantsSkipped).toBe(1);

    expect(existsSync(path.join(root, 'big.webp'))).toBe(true);
    expect(existsSync(path.join(root, 'big-128w.webp'))).toBe(true);
    expect(existsSync(path.join(root, 'big-300w.webp'))).toBe(false);

    const variantMeta = await readMeta(path.join(root, 'big-128w.webp'));
    expect(variantMeta.width).toBe(128);
    expect(variantMeta.height).toBe(64);
  });

  it('quality 覆盖生效：低质量产物更小', async () => {
    const root = await tmpDir('quality');
    await makeNoisyPng(path.join(root, 'n.png'));

    await convertPath(root, { quality: 50 });
    const lowSize = (await fs.stat(path.join(root, 'n.webp'))).size;
    await convertPath(root, { quality: 100 });
    const highSize = (await fs.stat(path.join(root, 'n.webp'))).size;
    expect(highSize).toBeGreaterThan(lowSize);
  });

  it('--delete-source 删除源文件且产物存在', async () => {
    const root = await tmpDir('delete');
    await makePng(path.join(root, 'gone.png'));
    await makeJpeg(path.join(root, 'keep.jpg'));

    const stats = await convertPath(root, { deleteSource: true, manifestPath: true });
    expect(stats.converted).toBe(2);
    expect(existsSync(path.join(root, 'gone.png'))).toBe(false);
    expect(existsSync(path.join(root, 'gone.webp'))).toBe(true);

    const manifest = await loadManifest(path.resolve('.webp-forge.json'));
    // 删源后条目同步清理
    expect(Object.keys(manifest.entries)).toEqual([]);
  });
});

describe('checkUnconverted', () => {
  it('列出未转换位图，转换后清零', async () => {
    const root = await tmpDir('check');
    await makePng(path.join(root, 'a.png'));
    await makeJpeg(path.join(root, 'sub/c.jpg'));

    expect((await checkUnconverted(root)).sort()).toEqual(['a.png', 'sub/c.jpg']);

    await convertPath(root, {});
    expect(await checkUnconverted(root)).toEqual([]);
  });

  it('CLI --check 退出码：未转换 1，已转换 0', async () => {
    const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
    const cliEntry = path.join(projectRoot, 'src', 'cli.ts');
    const tsxEntry = path.join(projectRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    if (!existsSync(tsxEntry)) {
      console.warn('skip: tsx cli.mjs not found');
      return;
    }
    const root = await tmpDir('cli');
    await makePng(path.join(root, 'x.png'));

    const before = spawnSync(process.execPath, [tsxEntry, cliEntry, 'convert', root, '--check'], { encoding: 'utf8' });
    expect(before.status).toBe(1);
    expect(before.stderr).toContain('x.png');

    await convertPath(root, {});
    const after = spawnSync(process.execPath, [tsxEntry, cliEntry, 'convert', root, '--check'], { encoding: 'utf8' });
    expect(after.status).toBe(0);
  });
});
