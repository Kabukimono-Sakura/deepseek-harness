# Local development

Use Node >=24.9 and npm. On the initial Windows machine, portable Node/npm are stored in `.tools/node/`.

```powershell
.\scripts\dev.ps1 ci
.\scripts\dev.ps1 run check
.\scripts\dev.ps1 run doctor
.\scripts\dev.ps1 run runtime:install
.\scripts\dev.ps1 run dsh
.\.tools\node\node.exe scripts/dsh.mjs web --no-open --host 127.0.0.1 --port 3847
```

On another machine with a supported Node, use the corresponding `npm` commands directly. DSH is a separate optional runtime in `.runtime/dsh`, so unit-test CI does not install the entire agent host.

Runtime storage stays in the project: `.dsh/` for DSH settings/sessions, `.cache/npm/` for package cache, `tmp/` for temporary files, `data/` for companion data. These paths and `.env` are ignored by Git. OS credential stores remain managed by their respective official login clients.

Copy `.env.example` to `.env` and configure the DeepSeek key locally when testing a real model. Never paste a key into an issue or commit it. No public service is deployed by these commands.
