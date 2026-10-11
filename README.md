# webp-forge

一站式把项目里的 png / jpg / jpeg / avif / gif 批量转成 WebP 的命令行工具。

预设、响应式变体、增量清单、CI 门禁、体积报告——一条命令全覆盖。

```text
webp-forge：转换 128，跳过 0，失败 0
  gallery/cover.jpg  1.8 MB → 412.0 KB  (-77.6%)
  合计 18.4 MB → 4.1 MB（节省 77.7%）
```

## 特性

- **递归批量转换**：产物落在源文件旁边，天然保持相对目录结构
- **三档预设**：`photo`（照片）/ `art`（插画与渐变）/ `graphics`（图标与截图），`--quality` 可微调
- **响应式变体**：`--width 512,128` 生成 `<name>-512w.webp` 等，只生成小于源图宽度的变体
- **增量清单**：`--manifest` 按 sha256 + 参数签名跳过未变化的文件，二次运行近乎瞬时
- **CI 门禁**：`--check` 发现未转换的位图即以退出码 1 失败，可作提交前检查
- **体积报告**：`--report` 在控制台输出逐文件前后对比与总节省百分比
- **动图与透明**：gif → 动图 webp 保留帧数；alpha 通道原样保留
- **隐私默认**：默认剥离 EXIF / GPS，`--keep-metadata` 显式保留

## 安装

需要 Node.js ≥ 20。

```bash
pnpm add -D webp-forge
# 或全局安装
npm i -g webp-forge
```

## 快速开始

```bash
# 转换指定目录（递归）
webp-forge convert ./public

# 照片预设 + 生成 512/128 两档响应式变体 + 增量清单
webp-forge convert ./public --preset photo --width 512,128 --manifest

# CI：只检查是否有未转换的位图，不转换
webp-forge convert ./public --check
```

## 命令与选项

```
webp-forge convert <path>

位置：
  path  要转换的文件或目录（必填，递归处理目录）

选项：
  -p, --preset <name>      预设：photo（默认）/ graphics / icon
  -q, --quality <n>        覆盖预设质量（1-100 整数）
  -w, --width <sizes>      逗号分隔的响应式变体宽度，如 512,128
  -m, --manifest [file]    增量清单（缺省文件名 .webp-forge.json）
  -f, --force              忽略清单，全量重转
  --keep-metadata          保留 EXIF/GPS（默认剥离，隐私优先）
  --delete-source          转换成功后删除源文件（不可逆，慎用）
  -r, --report             输出前后体积对比报告
  --check                  只检查未转换位图：存在则退出码 1
```

### 预设

| 预设 | 适用 | 质量 | 说明 |
|---|---|---|---|
| `photo` | 照片、封面图 | 80 | 有损 + smartSubsample，体积与观感均衡 |
| `graphics` | 插画、海报、UI 截图 | 90 | 更高质量，细节保留更好 |
| `icon` | 图标、小尺寸图形 | 100 | nearLossless，锐利优先 |

### 增量清单

`--manifest` 后首次运行全量转换，并在 `.webp-forge.json` 记录每个源文件的
sha256、参数签名与产物列表。之后运行时：

- 源文件未变、参数未变、产物齐全 → 跳过
- 换了预设或质量 → 签名变化 → 全部重转
- 源文件被删除 → 清单条目同步清理

配合 `--force` 可强制忽略清单全量重转。

## CI 集成

`.github/workflows/ci.yml` 片段：

```yaml
- name: 检查位图是否已全部转为 WebP
  run: |
    npm i -g webp-forge
    webp-forge convert ./public --check
```

仓库内自带同款工作流（`.github/workflows/ci.yml`）。

## 本地开发

```bash
pnpm install
pnpm test        # vitest 单元测试
pnpm typecheck   # tsc --noEmit
pnpm dev -- convert ./fixtures --preset art   # 直接跑 CLI
```

## 设计说明

见 [docs/design.md](docs/design.md)：转换管线、增量签名、预设参数依据。

## License

[MIT](LICENSE)
