# SeedStream

SeedStream 是一个面向 macOS 和 Windows 的本地桌面种子播放器与下载器。它只接受本地 `.torrent` 文件，支持先解析文件清单，再选择边下边播或永久下载。

> 请只下载或分享你有权获取的内容。BitTorrent 会同时连接其他节点并上传已经取得的分片。

## 下载

前往 [GitHub Releases](https://github.com/ren644/seedstream-desktop/releases/latest) 下载最新版本：

- macOS Apple Silicon：DMG 安装包或 ZIP 备用包
- Windows x64：Setup 一键安装版或 Portable 便携版
- 每个版本同时提供离线使用指南、首次打开说明和 SHA-256 校验文件

## 核心功能

- 导入、拖放或从 Finder / Windows 文件关联打开 `.torrent`
- 在应用内播放 Chromium 可解码的视频，支持 HTTP Range 拖动进度
- 无节点或节点无数据时自动结束“假缓冲”提示，并可一键重新连接
- 完整下载、暂停、继续、断点校验和下载完成通知
- 单文件和多文件种子、中文文件名、重复任务检测
- 播放缓存与永久下载严格隔离
- macOS DMG/ZIP 与 Windows NSIS/portable EXE 打包配置
- 首次启动三步引导、常驻帮助入口和随安装包提供的离线指南

## 缓存与文件

- 默认永久下载目录：系统“下载”目录中的 `SeedStream`
- 播放缓存：系统临时目录中的 `seedstream-player-cache`
- 任务和种子元数据：系统应用数据目录中的 `SeedStream`

纯播放任务关闭播放器或退出应用后会清理缓存；异常退出遗留的缓存会在下次启动时清除。永久下载文件不会被“移除记录”操作删除。

如果正在播放临时缓存时点击“转为永久下载”，应用会先停止播放并清除临时缓存，再从永久目录重新开始。这个边界可以避免临时文件与用户文件混在一起，但已经缓冲的少量分片可能需要重新下载。

## 开发

要求 Node.js 22 或更高版本，推荐 pnpm 11。

```bash
pnpm install
pnpm start
pnpm test
pnpm smoke
```

`pnpm smoke` 使用本机生成的合法测试数据，建立两个仅限回环地址的 WebTorrent 客户端，验证字节范围播放，并启动一次隔离用户目录的隐藏 Electron 窗口。它不会访问公共种子。

## 打包

在 macOS 上：

```bash
pnpm pack:mac
```

在 Windows 上：

```powershell
pnpm pack:win
```

输出位于 `dist/`。`pack:win` 固定生成 Windows x64 版本，并分别输出 `-setup.exe` 安装版和 `-portable.exe` 便携版。Windows 的 `.torrent` 文件关联由 NSIS 安装版注册，因此安装器使用 per-machine 模式并需要管理员权限；portable EXE 不注册文件关联。

Windows 安装版使用一键模式：确认 UAC 后自动安装、创建快捷方式并启动。没有管理员权限或不想安装时，直接使用 portable EXE。macOS DMG 内含 `SeedStream-使用指南.html` 和 `首次打开说明.txt`，安装包输出目录也会自动附带这两份离线说明。

本项目当前附带的 macOS arm64 成品已在 Apple Silicon Mac 上完成启动、回环字节范围播放和 DMG 校验；Windows x64 成品已完成跨平台构建、PE 架构与包内容检查，但仍应在 Windows 真机完成安装/卸载、文件关联和视频播放验收。

当前配置生成未签名构建。正式分发前需要配置 Apple Developer ID 签名/公证和 Windows 代码签名证书，否则 Gatekeeper 或 SmartScreen 可能警告用户。

遇到 macOS 或 Windows 安全提示时，应先确认文件来源并核对 `SHA256SUMS.txt`。项目不会提供关闭 Gatekeeper、Defender 或杀毒软件的脚本；安全、可持续的无警告安装需要正式代码签名。

## 播放兼容性

播放器依赖 Electron/Chromium 的容器和编解码器支持。MP4、WebM、MOV、M4V，以及编码兼容的 MKV 通常可以播放；AVI、DTS、AC3、H.265 等组合可能无法解码。遇到不兼容格式时仍可完整下载，然后使用 VLC、IINA 或其他播放器打开。

播放开始后会先寻找该种子原有 Tracker、DHT 或局域网能够发现的节点。如果约 10–12 秒仍没有节点，界面会明确显示原因并提供“重新连接”。重新连接会清理当前临时播放缓存并重新执行节点发现，但客户端无法替代不存在的做种者，也不会为私有种子擅自追加公共 Tracker。

## 安全边界

- 渲染进程启用 sandbox 和 context isolation，禁用 Node.js integration
- 所有 IPC 都验证调用来源和参数，不暴露原始 `ipcRenderer`
- 视频服务只绑定 `127.0.0.1`、使用随机路径并限制 Host
- 拒绝绝对路径、父目录穿越、Windows 保留名称和备用数据流路径
- 缓存删除只能发生在应用拥有的缓存根目录内
- 不加载远程网页，不允许新窗口和页面导航，不请求浏览器权限
