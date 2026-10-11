/** 预设定义：三档覆盖常见场景，--quality 可覆盖 quality 值。 */
export interface PresetDefinition {
  quality: number;
  /** libwebp method，sharp 里叫 effort：0 最快 6 最慢最好 */
  effort: number;
  lossless: boolean;
  nearLossless: boolean;
  smartSubsample: boolean;
}

export const PRESETS: Record<string, PresetDefinition> = {
  photo: { quality: 80, effort: 6, lossless: false, nearLossless: false, smartSubsample: true },
  graphics: { quality: 90, effort: 6, lossless: false, nearLossless: false, smartSubsample: true },
  icon: { quality: 100, effort: 6, lossless: false, nearLossless: true, smartSubsample: false },
};

export interface WebpOptions {
  quality: number;
  effort: number;
  lossless: boolean;
  nearLossless: boolean;
  smartSubsample: boolean;
}

/** 解析预设 + quality 覆盖为 sharp 的 webp 输出参数。 */
export function resolveWebpOptions(presetName: string, qualityOverride?: number): WebpOptions {
  const def = PRESETS[presetName];
  if (!def) {
    throw new Error(`未知预设 "${presetName}"，可选：${Object.keys(PRESETS).join(' / ')}`);
  }
  const quality = qualityOverride ?? def.quality;
  return {
    quality,
    effort: def.effort,
    lossless: def.lossless,
    // 手动指定 quality 时关闭 nearLossless，避免语义冲突
    nearLossless: def.nearLossless && qualityOverride == null,
    smartSubsample: def.smartSubsample && quality < 90,
  };
}

/** 参数签名：进入清单，预设/质量/宽度变化都会触发重转。 */
export function presetSignature(preset: string, quality?: number, widths: number[] | null = null): string {
  return [preset, quality ?? '-', widths ? widths.join(',') : '-'].join('|');
}
