$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$archivePath = Join-Path $projectPath '.cache\downloads\NapCat.Node-v4.18.41.zip'
$runtimePath = Join-Path $projectPath '.runtime\napcat-node-v4.18.41'
$expectedHash = '51fbb10e7bcd56b0c2a6de86c37811e7518330e48a137ac689ab1e4d8627d3f0'
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $archivePath) | Out-Null
if (!(Test-Path -LiteralPath $archivePath)) {
    & curl.exe --fail --location --retry 3 --connect-timeout 20 --max-time 1800 --output $archivePath 'https://github.com/NapNeko/NapCatQQ/releases/download/v4.18.41/NapCat.Shell.Windows.Node.zip'
    if ($LASTEXITCODE -ne 0) { throw 'Download failed. Do not run an incomplete archive.' }
}
if ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHash) {
    throw 'NapCat archive SHA256 mismatch. Review the cached download before retrying.'
}
if (Test-Path -LiteralPath $runtimePath) {
    Write-Output 'Runtime directory already exists; preserved without overwriting. Archive SHA256 verified.'
} else {
    Expand-Archive -LiteralPath $archivePath -DestinationPath $runtimePath
    Write-Output 'Pinned NapCat Windows Node runtime installed.'
}
