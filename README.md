# Deepseek Harness · 多端 AI 伙伴

以 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 为底座，逐步接入个人 QQ、微信公众号、Windows 桌宠、Bilibili 内容和直播弹幕。这是独立集成项目，不是 DeepSeek 官方仓库。

默认使用 DeepSeek 官方 API；Codex ChatGPT 登录与 GitHub Copilot 登录作为后续可切换后端。模型在云端运行，本机无需下载模型权重。

## 当前进度

- 已实现 OneBot 11 文本消息校验、白名单、群聊提及检查、会话隔离和安全回复构造。
- 已提供 DSH 独立安装、项目内数据目录、环境诊断，以及 Windows/Linux CI。
- 已实现本地 CLI 会话桥接、同会话串行处理和 DSH 历史恢复入口，见[本地对话说明](docs/wiki/Local-chat.md)。
- 已用真实 DSH + 本机模拟模型验证对话和重启恢复；已接入桌宠状态与回复显示，见[桌宠说明](docs/wiki/Desktop-pet.md)。
- 真实 DeepSeek 账号对话、QQ/微信/B站收发和登录后端切换尚未完成。测试通过不代表平台已连接。

## 开发

需要 Node.js >=24.9 和 npm。普通测试无需安装 DSH，也无需账号凭据。

```sh
npm ci
npm run check
npm run doctor
```

Windows 开发机在 `D:\Deepseek Harness` 中提供便携 Node，可使用：

```powershell
.\scripts\dev.ps1 ci
.\scripts\dev.ps1 run check
.\scripts\dev.ps1 run doctor
```

安装并启动 DSH Web：

```sh
npm run runtime:install
npm run dsh
```

本机 Windows 可直接运行 `.\.tools\node\node.exe scripts/dsh.mjs web --no-open --host 127.0.0.1 --port 3847`。首次启动可能较慢。API Key 只放在本机 `.env`，格式见 [.env.example](.env.example)，不要放入 Issue 或提交到 Git。

项目运行数据分别位于 `.dsh/`、`.runtime/`、`data/`、`.cache/`、`tmp/`；便携 Node 位于 `.tools/`。这些目录不上传 GitHub。参考 PDF 和早期机器环境调研也只保留在本机。

## 项目管理

- [实施计划与验收条件](plan.md)
- [Wiki 文档入口](docs/wiki/Home.md)
- [架构](docs/wiki/Architecture.md) · [开发](docs/wiki/Development.md) · [测试](docs/wiki/Testing.md)
- [配置草案](config/prototype.example.json) · [贡献说明](CONTRIBUTING.md)

使用 GitHub Issues、Milestones 和状态标签跟踪迭代。CI 自动检查代码；部署目标与账号尚未配置，因此没有自动部署线上服务。
