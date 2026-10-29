$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
& (Join-Path $projectPath '.tools\node\node.exe') (Join-Path $PSScriptRoot 'napcat-start.mjs')
exit $LASTEXITCODE
