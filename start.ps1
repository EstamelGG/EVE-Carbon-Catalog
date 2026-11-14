[CmdletBinding()]
param([int]$Port = 8795, [uri]$ResourceBaseURL, [uri]$RendererModuleURL)
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'build.ps1') -ResourceBaseURL $ResourceBaseURL -RendererModuleURL $RendererModuleURL
& py -3 -m http.server $Port --bind 127.0.0.1 --directory (Join-Path $PSScriptRoot 'dist')
exit $LASTEXITCODE
