# 微信公众号：写稿、审核与官方草稿箱

当前流程是本地写稿 → 预览并人工审核 → 官方草稿箱 → 在微信后台声明 AI 辅助创作并发表。没有自动发表、定时群发或模拟网页登录接口。官方接口降低非官方协议风险，但不能保证账号永不受限。

## 凭证配置

登录 https://mp.weixin.qq.com ，确认选中目标公众号。在“设置与开发 → 开发接口管理／基本配置”查找 AppID、AppSecret 和 IP 白名单。如果页面显示迁移通知，沿页面官方入口进入微信开发者平台。AppSecret 的生成或重置可能需要管理员扫码；重置会影响使用旧密钥的应用。

在项目根目录 `.env` 中填写 `WECHAT_MP_APP_ID` 和 `WECHAT_MP_APP_SECRET`，不要发到公开仓库、Issue 或截图。IP 白名单填写实际调用微信接口的公网出口 IP，不能填 127.0.0.1 或局域网地址；网络或代理变化后可能需要更新。只有草稿上传时不需要启用公网消息回调服务器。

```powershell
.\.tools\node\node.exe scripts/wechat.mjs status
.\.tools\node\node.exe scripts/wechat.mjs probe
```

`probe` 只获取稳定凭证并读取草稿数量，不新增、不发表。40164 表示 IP 不在白名单；40125 表示 AppSecret 无效；48001 表示接口未授权；45009/45011 表示限额或调用频率限制。遇到这些错误先处理原因，不循环重试。

## 操作

在 `config/local.json` 的 `wechatMp.author` 配置用户确认的公开署名。`data/wechat/` 保存本机任务和审核记录，均被 Git 忽略。写稿只读取你指定的公开简报 JSON（topic、facts、sources），不读取 QQ 聊天库或私有人设。

```powershell
.\.tools\node\node.exe scripts/wechat.mjs generate article-id data/wechat/brief.json
.\.tools\node\node.exe scripts/wechat.mjs preview article-id
```

生成 `data/wechat/articles/article-id/article.json` 和 `preview.html`。修改 JSON 后重新 preview。正文为转义后的纯文本段落，保留 AI 辅助创作说明；不执行 HTML/脚本，不抓取陌生链接或自动转载图片。将有使用权的 PNG/JPEG 封面放到文章目录的 `cover.png`（本机约定文件名，内容类型按文件签名检查）。

人工检查标题、正文事实、来源、署名、封面版权和 AI 声明，核对目标公众号 AppID 后，把 preview 输出的 SHA256 指纹作为审核参数：

```powershell
.\.tools\node\node.exe scripts/wechat.mjs approve article-id HASH_FROM_PREVIEW
.\.tools\node\node.exe scripts/wechat.mjs upload article-id
```

审核绑定文章内容、封面内容和目标 AppID，任何一项变化需重新审核。先上传永久封面素材，再新增独立草稿，不修改已有草稿。操作开始前记录 pending，完成后保存 media_id 回执；结果未知或失败会停止，不能自动重复提交。需在后台核对后人工处理本机回执文件，不盲目删除后重发。成功进入草稿箱不等于已经发表或向粉丝群发。

在微信后台检查排版、封面裁切、所有事实及链接，并使用平台提供的 AI 内容声明功能。正文中的说明不替代平台声明。不可把私聊或个人资料直接写入公开文章；不要把第三方网络图片或表情包默认视为可商用素材。

## 官方依据与边界（2026-11-04 核查）

- [新增草稿](https://developers.weixin.qq.com/doc/subscription/api/draftbox/draftmanage/api_draft_add.html)：标题 32 字、作者 16 字、摘要 120 字；图文封面使用永久素材 ID。
- [官方发表接口](https://developers.weixin.qq.com/doc/subscription/api/public/api_freepublish_submit.html)：公众号“仅认证”的说明明确指企业主体已认证账号，不能把个人认证当作该接口授权。本原型未开放发表命令。
- [稳定 access_token](https://developers.weixin.qq.com/doc/subscription/api/base/api_getstableaccesstoken.html)：使用普通模式，不强制刷新其他应用正在使用的凭证。
- [永久素材](https://developers.weixin.qq.com/doc/subscription/api/material/permanent/api_addmaterial.html) / [草稿数量](https://developers.weixin.qq.com/doc/subscription/api/draftbox/draftmanage/api_draft_count.html)。
- [腾讯 CloudBase 凭证与 IP 白名单说明](https://docs.cloudbase.net/integration/wechat-official-oauth)。
- [网信办关于 AI 内容标识的说明](https://www.cac.gov.cn/2025-03/14/c_1743654685896173.htm)：公开传播时主动声明，不恶意删除或隐藏生成标识。

接口凭证不能证明文章内容合规。人工核实事实与授权仍不可省略。草稿创建及浏览器预览均需分别验收，离线测试不代表真实上传成功。
