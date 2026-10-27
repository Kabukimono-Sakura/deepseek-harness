# Use project-local Node/npm when available; no global PATH changes.
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskNode = Join-Path $taskRoot '.tools\node\node.exe'
if (-not (Test-Path -LiteralPath $taskNode)) { $taskNode = (Get-Command node -ErrorAction Stop).Source }
$taskNpm = Join-Path (Split-Path -Parent $taskNode) 'node_modules\npm\bin\npm-cli.js'
if (-not (Test-Path -LiteralPath $taskNpm)) { throw 'npm is missing beside the selected Node runtime.' }
$env:PATH = (Split-Path -Parent $taskNode) + ';' + $env:PATH
$env:npm_config_cache = Join-Path $taskRoot '.cache\npm'
$env:TEMP = Join-Path $taskRoot 'tmp'
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Path $env:TEMP -Force | Out-Null
Push-Location -LiteralPath $taskRoot
try {
  & $taskNode $taskNpm @args
  $taskExit = $LASTEXITCODE
} finally { Pop-Location }
exit $taskExit
