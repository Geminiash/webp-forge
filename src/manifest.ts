import { promises as fs } from 'node:fs';

export interface ManifestEntry {
  /** 源文件内容的 sha256 */
  hash: string;
  /** 转换参数签名（preset|quality|widths），参数变了即使 hash 相同也要重转 */
  signature: string;
  /** 相对转换根目录的产物路径（posix） */
  outputs: string[];
}

export interface ForgeManifest {
  version: 1;
  tool: 'webp-forge';
  entries: Record<string, ManifestEntry>;
}

export function emptyManifest(): ForgeManifest {
  return { version: 1, tool: 'webp-forge', entries: {} };
}

/**
 * 读取清单。文件缺失、损坏或格式不符时返回空清单——
 * 清单只是加速缓存，宁可全量重转也不能因坏清单而中断。
 */
export async function loadManifest(file: string): Promise<ForgeManifest> {
  try {
    const raw = JSON.parse(await fs.readFile(file, 'utf8')) as Partial<ForgeManifest> | null;
    if (raw && raw.tool === 'webp-forge' && raw.version === 1 && typeof raw.entries === 'object' && raw.entries !== null) {
      return { version: 1, tool: 'webp-forge', entries: raw.entries as Record<string, ManifestEntry> };
    }
  } catch {
    // 文件不存在或 JSON 损坏：按空清单处理
  }
  return emptyManifest();
}

export async function saveManifest(file: string, manifest: ForgeManifest): Promise<void> {
  const body = JSON.stringify(manifest, null, 2) + '\n';
  await fs.writeFile(file, body, 'utf8');
}
