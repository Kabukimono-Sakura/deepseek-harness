# Windows control panel

On the configured Windows machine, double-click `D:\Deepseek Harness\Deepseek Harness.exe`.

| Control | Behavior |
|---|---|
| 启用 QQ | Starts NapCat if needed and enables the QQ conversation bridge |
| 停用 QQ | Gracefully stops automatic replies and proactive contact; preserves NapCat login |
| 扫码登录 | Opens a temporary local page showing NapCat's current login QR code |
| 打开桌宠 / 关闭桌宠 | Starts the display host as needed and switches the main pet's desktop visibility |
| 全部启用 / 全部停用 | Applies the QQ and pet controls together |
| 查看日志 / 项目文件夹 | Opens the relevant local folder |
| 退出面板 | Exits only the panel; background services keep their current state |

Closing the window with X hides it in the system tray. Double-click the tray icon to restore it. The panel reports verified QQ connection state separately from waiting for login/reconnect. It never fills in a password or confirms a phone login for the user.

QQ shutdown waits for the current reply generation to finish safely. Pending unsent output stays in the existing durable queue. Disabling desktop display keeps the DSH host in standby so it can be shown again quickly. The panel does not install a Windows startup service.

The executable is a small .NET Framework Windows Forms launcher. Keep it in the project root: it uses the existing portable Node, scripts, private configuration and runtimes next to it. Copying just this EXE to a different computer is not a complete installation. No additional model runtime or model weights are bundled into the EXE.

## Build and verification

```powershell
.\scripts\build-panel.ps1
```

The build uses the Windows .NET Framework compiler already installed on the machine and requests ordinary user privileges. The generated root EXE is ignored by Git; source and manifest are versioned under `src/panel`.

Windows CI compiles the panel and runs `--self-test`. Node tests cover service-state mapping, unsupported commands and recycled PID identity. On the development machine, real QQ disable/enable, desktop show/hide, and the local QR HTML/PNG endpoints were checked. A native Windows Forms render was inspected to correct text clipping. The external UI automation helper could not initialize in this session; automated physical button-click coverage was not claimed.

CLI equivalents, useful for diagnosis:

```powershell
.\.tools\node\node.exe scripts/dashboard.mjs status
.\.tools\node\node.exe scripts/dashboard.mjs qq-start
.\.tools\node\node.exe scripts/dashboard.mjs qq-stop
.\.tools\node\node.exe scripts/dashboard.mjs pet-start
.\.tools\node\node.exe scripts/dashboard.mjs pet-stop
```

Logs are private files in `tmp/`; they may contain local authentication URLs and should not be posted publicly without review.
