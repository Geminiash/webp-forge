# Changelog

本项目的所有显著变更都记录在此文件中。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [0.1.0] - 2026-10-11

### Added

- `convert <path>` 命令：递归批量 png/jpg/jpeg/avif/gif → webp，产物保持相对目录结构
- 预设 `--preset photo|graphics|icon`（photo q80 method6 / graphics q90 / icon 接近无损），`--quality` 覆盖
- `--width 512,128` 多宽度响应式变体，`-512w.webp` 后缀，跳过大于源图宽度的变体
- `--manifest [file]` 增量清单：源文件 sha256 + 参数签名，未变化自动跳过；`--force` 忽略
- `--check` CI 模式：列出未转换位图并退出码 1，不做任何转换
- `--report` 前后总字节对比与节省百分比
- gif → 动图 webp（保留全部帧）；alpha 通道保留
- 默认剥离 EXIF/GPS 元数据，`--keep-metadata` 保留
