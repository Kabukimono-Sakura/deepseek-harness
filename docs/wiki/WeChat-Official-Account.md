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

## 正文配图与文风

作者可以使用轻松口语、场景、比喻和适度夸张；保留事实边界，不能编造已实现能力。正文中以 `## ` 开头的段落显示为小标题。配图放在具体段落之后，避免无关插图。文章 JSON 的 `images` 数组包含 `file`（如 figure-cat.jpg）、`afterParagraph`（从零起的段落位置）、`caption`。只接受文章目录下的 figure- PNG/JPEG 文件名，禁止路径跳转。

正文图片通过[官方图文图片上传接口](https://developers.weixin.qq.com/doc/subscription/api/material/permanent/api_uploadimage.html)上传，必须小于 1MB；保留原图和 AI 标识，适配后的发送副本使用独立文件。收到微信图片地址后才拼入正文。审核指纹同时绑定所有正文图片，换图或改图说明都需要重新审核。封面与正文图片使用不同接口；任何结果未知的上传都暂停待后台核对，不自动重发。

## 真实验收补充（2026-11-04）

已通过永久封面、三张正文图片上传和新建草稿的真实验收；随后读取草稿核对标题、作者、封面、图片数、桌宠段落和 AI 声明均匹配。未发表或群发。

本次微信对长作者名返回 45110，尽管文档描述为 16 字。实现保守按英文字符 1、非 ASCII 字符 2，总计不超过 16 校验微信作者栏。`author` 保存完整公开署名，`wechatAuthor` 保存用户另行确认的短署名；不自动截断或改名。正文和封面可保留完整名字。素材回执按账号和图片内容绑定，修改文字或短署名后可复用已成功上传的图片。失败回执保留供核查，绝不把失败当成功。

## 从 QQ 私聊投稿

启用 QQ 和公众号配置，用配置中的主人账号私聊大肥鱼。可以直接说「鱼鱼，帮我写篇推文」，等她问选题，再回「就写春天读过的三本书」。看完直接说「开头太像报告了，换成聊天的语气」，满意就说「这版放进草稿箱吧」。她会沿用刚预览的版本；指代不清时会列出最近几版供选择。超过一天后请先重新查看稿件。也可以继续使用带稿号的指令。发送 `公众号写稿：选题和可以公开的资料`，或 `帮我写一篇关于春日阅读的公众号文章`。她会把全文、通用粉鱼封面和稿号发回 QQ。本入口生成文字稿并使用项目自带封面。

- `查看稿件 稿号` 重新查看原稿。
- `公众号改稿 稿号 修改意见` 生成新版和新稿号。
- `确认入草稿箱 稿号` 审核指定版本，上传到配置的公众号并返回结果。

稿号绑定文章、封面、主人和目标公众号。普通白名单联系人、群聊和主动唤醒无法调用此入口。微信回执保存在本机，最后的发表由你在微信后台操作。
