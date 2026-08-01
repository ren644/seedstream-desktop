# SeedStream 新手辅助与安装指引设计

## 目标

让没有 BitTorrent 使用经验的 macOS 与 Windows 用户，在下载完成后能够判断该打开哪个文件、顺利通过系统安装提示，并在应用中完成“导入 `.torrent` → 选择视频 → 在线播放或永久下载”。辅助内容必须离线可用，不能依赖用户先成功打开应用，也不能通过脚本关闭 Gatekeeper、SmartScreen 或杀毒软件。

## 方案

采用三层引导。第一层是分发目录和 macOS DMG 根目录中的 `SeedStream-使用指南.html` 与 `首次打开说明.txt`，负责解决应用尚未启动时的问题。指南按系统分栏，说明 Apple Silicon DMG、Windows x64 安装版与便携版的区别，并覆盖 Gatekeeper、SmartScreen、UAC、防火墙、无节点、编解码器和磁盘空间等常见状况。安全拦截只提供系统认可的人工确认路径，并要求用户先确认文件来源和 SHA-256；不提供 `xattr`、关闭 Defender 等绕过脚本。

第二层是应用首次启动的三步引导：打开或拖入 `.torrent`、点击视频旁“播放”、需要保留时选择永久下载。引导展示当前系统专属提醒，并明确“关闭播放器会删除临时视频缓存，永久下载不会被删除”。完成状态保存在渲染进程本地存储中，不新增隐私数据，也不影响任务状态。

第三层是顶部常驻“使用帮助”按钮，可重新打开引导或调用主进程打开随应用打包的完整离线指南。该调用没有路径参数，只能打开应用自带文件，并继续使用可信渲染来源校验。

Windows 安装版改为 one-click、per-machine：确认 UAC 后自动安装、创建快捷方式、注册 `.torrent` 并启动应用；不想安装或没有管理员权限的用户可直接使用 portable EXE。macOS 保留 DMG 拖入 Applications 的标准流程。真正消除 Gatekeeper/SmartScreen 警告仍需要 Apple 公证和 Windows 代码签名证书，文档会明确这一边界。

## 验证

新增纯函数测试覆盖平台提示和首次完成状态，IPC 测试覆盖帮助通道，UI 冒烟测试确认干净用户目录会显示首启引导且帮助入口存在。重建 DMG、ZIP、Windows setup 与 portable，并检查 DMG 内指南、应用内资源、Windows x64 架构和最终 SHA-256。
