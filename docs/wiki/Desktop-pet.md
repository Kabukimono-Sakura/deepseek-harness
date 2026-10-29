# Windows 桌宠

项目使用 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 0.3.8，与 DSH 0.2.1-rc.2 配套；桌面运行时固定 Electron 43.3.0。首次安装会下载动画素材和 Electron，不需要模型 API Key。

```powershell
.\scripts\dev.ps1 run pet:install
.\scripts\dev.ps1 run pet
```

保留宿主进程运行，在另一个终端运行 `.\scripts\dev.ps1 run pet:demo`，可以检查思考状态与回复气泡。这个演示不调用模型。`Ctrl+C` 停止宿主后，桌宠随之退出；当前没有配置开机自启。

用户选定的桌宠名为“Elysia的粉色大肥鱼”，位于屏幕右下方。目前沿用上游默认外观，命名不代表已经制作粉色鱼造型。自动碎碎念、余额查询和系统通知默认关闭。外观与位置可以在上游桌宠设置中调整；本机配置位于 `.dsh/dsh-pet/main-config.jsonc`，重复安装不会覆盖它。

要显示统一 CLI 对话，在本机 `.env` 设置：

```dotenv
DSH_PET_ENABLED=1
DSH_PET_URL=http://127.0.0.1:3847
```

启动桌宠宿主，再运行 `npm run chat`。CLI 等待模型时显示思考状态，完成后将已有回复投递到气泡，不再次调用模型。正文始终完整保留在 CLI；桌宠不可用、被隐藏或显示锁丢失时，文字对话继续。

适配器只允许明确的回环 HTTP 地址，禁止跳转。它按[上游 HTTP 契约](https://github.com/PC2005-cloud/dsh-pet/blob/main/API.md)取得短期显示锁后投递文字，最多显示 10 秒后释放；不会使用强制释放或自动抢回锁。工作状态接口只有一个外部槽，当前只支持一个本地 CLI 写入者。

**上游右键菜单的“对话”仍属于 dsh-pet 自己的对话链路和记忆，不是本项目统一 CLI。** 本阶段请从 CLI 输入统一会话，桌宠负责状态和输出显示。统一桌面输入界面属于后续工作。

运行数据、Electron、下载缓存均位于项目内。安装器对固定版本的 Electron helper 应用一个经过 SHA256 校验的存储路径补丁，防止 Chromium 数据落到系统用户目录；补丁详情见 [存储决策](../decisions/0002-pet-storage.md)。插件升级前需要重新审查补丁。

2026-10-28 本机验证：桌宠窗口可见；真实接口接受状态与气泡；气泡已视觉检查；数据目录确认为项目内。自动化工具无法可靠拖拽点击穿透窗口，因此用户拖拽接管的真人验收仍待进行。协议测试已覆盖锁丢失时不重试、不抢占。
