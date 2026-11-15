[CmdletBinding()]
param([uri]$ResourceBaseURL, [uri]$RendererModuleURL)
$ErrorActionPreference = 'Stop'
if ($ResourceBaseURL) { $env:RESOURCE_BASE_URL = $ResourceBaseURL.AbsoluteUri }
if ($RendererModuleURL) { $env:RENDERER_MODULE_URL = $RendererModuleURL.AbsoluteUri }
$npm = if ($IsWindows) { 'npm.cmd' } else { 'npm' }
Push-Location $PSScriptRoot
try {
    & $npm run build
    if ($LASTEXITCODE) { throw 'Catalog build failed' }
} finally {
    Pop-Location
}
