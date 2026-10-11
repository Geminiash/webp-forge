# webp-forge 设计说明

> 把项目里所有 png/jpg/jpeg/avif/gif 一键批量转成 WebP 的开源 CLI。
> 目标是"一站式"：预设、响应式变体、增量清单、CI 检查、体积报告，一条命令全部覆盖。

## 目标与非目标

**目标**

1. 递归批量转换，产物落在源文件旁边，天然保持相对目录结构
2. 三档预设覆盖常见场景，`--quality` 可微调
3. `--width 512,128` 生成响应式变体（`-512w.webp` 后缀）
4. `--manifest` 增量转换：按源文件 sha256 + 参数签名跳过未变化文件
5. `--check` CI 门禁：发现未转换位图即退出码 1
6. `--report` 输出前后体积对比与节省百分比
7. gif → 动图 webp（保留帧）；alpha 通道保留
8. 默认剥离 EXIF/GPS（隐私纪律），`--keep-metadata` 显式保留

**非目标**

- 不做图片编辑（裁剪/水印/调色）
- 不做远程 URL 拉取，只处理本地文件
- 不做并行 worker 池（sharp 单进程已足够快，多进程留待后续版本）

## 架构

```
src/
  cli.ts       Commander 入口：参数解析、退出码约定
  convert.ts   核心：目录扫描 / 转换管线 / 变体 / 增量判断 / --check
  presets.ts   预设定义与 webp 参数解析
  manifest.ts  .webp-forge.json 读写
  report.ts    体积报告格式化与输出
```

### 转换管线

每个源文件的处理流程：

```
读源文件 → sha256 → 命中清单?(hash+签名一致且产物齐全) → 跳过
        ↓ 未命中
sharp(源, { animated: ext === 'gif' })
  ├─ clone → webp(预设参数) → <name>.webp        （全尺寸）
  └─ clone → resize(w) → webp → <name>-<w>w.webp （仅 w < 源宽度的变体）
成功后：可选 unlink 源文件 → 更新清单
```

- gif 用 `animated: true` 读取全部帧，libwebp 输出动图（delay/loop 由 libvips 自动保留）
- 除 `--keep-metadata` 外不调用 `withMetadata()`，sharp 默认输出即无 EXIF/GPS
- 单文件失败只记录不中断，最终汇总并令进程退出码为 1

### 预设

| 预设 | quality | effort | 其他 | 适用 |
|---|---|---|---|---|
| `photo`（默认） | 80 | 6 | smartSubsample | 照片、截图 |
| `graphics` | 90 | 6 | smartSubsample | 图表、插画 |
| `icon` | 100 | 6 | nearLossless | 图标、小图，接近无损 |

`--quality` 覆盖预设质量值，同时关闭 nearLossless（避免语义冲突）。

### 增量清单（.webp-forge.json）

```jsonc
{
  "version": 1,
  "tool": "webp-forge",
  "entries": {
    "assets/img/hero.png": {
      "hash": "sha256…",          // 源文件内容 hash
      "signature": "photo|-|-",   // 参数签名：preset|quality|widths
      "outputs": ["assets/img/hero.webp", "assets/img/hero-512w.webp"]
    }
  }
}
```

- 跳过条件：hash 相同 **且** 参数签名相同 **且** 全部产物仍存在 —— 改预设/加宽度会正确触发重转
- 路径键相对被转换的根目录（posix 分隔符），清单文件路径相对进程 CWD
- `--force` 完全忽略清单
- `--delete-source` 删除源文件后，同步清理对应清单条目

### CI 模式（--check）

只扫描不转换：对每个位图源文件检查同目录同名 `.webp` 是否存在，
缺失则逐行列出并使进程退出码为 1。判断依据是磁盘事实而非清单，杜绝"清单骗人"。

### 退出码约定

| 退出码 | 含义 |
|---|---|
| 0 | 成功（含 --check 全部已转换） |
| 1 | --check 发现未转换位图 / 有文件转换失败 / 致命错误 |

## 已知限制

- 源文件 `a.png` 与 `a-512w.png` 同名不同扩展名时，变体输出可能互相覆盖（罕见，文档提示）
- 转换单文件用整块内存读图，超大图（>200MB）未优化
- 非 png/jpg/jpeg/avif/gif 的位图（bmp/tiff）刻意不处理，保持工具聚焦

## 测试策略

- fixture 全部用 sharp 现场生成（纯色/带 alpha/带 EXIF/多帧 gif/噪声图），仓库不提交任何二进制图片
- 覆盖：格式与尺寸、alpha 保留、动图帧数、元数据剥离、增量跳过、force、变体与上采样跳过、删源、--check、CLI 退出码
- 测试临时目录放 `os.tmpdir()`，`afterAll` 统一删除；手工实测轮次放 `tests/tmp/`，测完删除
