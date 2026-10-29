$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$compilerPath = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compilerPath)) { throw 'Windows .NET Framework compiler is required.' }
$outputPath = Join-Path $projectDirectory 'Deepseek Harness.exe'
& $compilerPath /nologo /target:winexe /optimize+ /platform:anycpu /codepage:65001 "/out:$outputPath" "/win32manifest:$(Join-Path $projectDirectory 'src\panel\app.manifest')" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll (Join-Path $projectDirectory 'src\panel\ControlPanel.cs')
if ($LASTEXITCODE -ne 0) { throw 'Panel compilation failed.' }
Write-Output "Built: $outputPath"
