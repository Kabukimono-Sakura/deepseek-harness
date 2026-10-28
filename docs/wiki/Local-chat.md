# 本地对话

本页描述已实现的 CLI 链路。真实 DSH 的回复与进程重启恢复已通过本机模拟模型服务验收；真实 DeepSeek 账号调用尚待配置 API Key 后验收。

1. 安装依赖和运行时：`npm ci`、`npm run runtime:install`。
2. 将 `.env.example` 复制为 `.env`，只在本机编辑 `DEEPSEEK_API_KEY`。
3. 运行 `npm run chat`。Windows 便携环境可运行 `.\scripts\dev.ps1 run chat`。
4. 输入 `/exit` 退出。下次启动恢复 `local` 会话；独立会话可用 `node scripts/chat.mjs another-name`。

`DEEPSEEK_MODEL` 默认 `deepseek-flash`，以实际账号可用模型为准。模型调用按服务商计费。

CLI 使用 DSH `sdk-minimal` 配合 `config/companion.patch.yml`，关闭文件、工作目录和命令执行工具。DSH Web 使用上游自己的配置，不能直接当成已受限的消息渠道后端。

DSH 在 `.dsh/sessions` 保留历史；`data/conversations.sqlite` 保存本地会话名和运行时会话 ID 的映射。映射在首个成功回复后建立；首轮异常或崩溃可能留下未映射日志。恢复失败会停止，不会悄悄创建新会话冒充历史已恢复。同名会话不应同时在两个进程打开。

同会话输入依次执行，不同会话分别收集输出。JSON-RPC 的 `session/prompt` 只是入队回执，只有等待结束且观察到成功的 `turn/end` 才返回文本。模型思考内容、其他会话输出和不完整回答不作为回复发送。

运行时无单轮取消 API。请求超过 180 秒时桥接终止整个子进程，拒绝后续请求；CLI 退出，不自动重发。完整渠道路由器的持久去重、发送队列和恢复策略仍在后续任务中。

`npm run test:runtime` 验证真实 DSH Web 启动、本地认证和页面响应，不消耗模型额度。`npm test` 中的会话测试使用协议替身，不证明真实模型或平台已经接通。
