[CmdletBinding()]
param([uri]$ResourceBaseURL, [uri]$RendererModuleURL)
$ErrorActionPreference = 'Stop'
$renderer = Join-Path $PSScriptRoot 'renderer/model-catalog'
$npm = if ($IsWindows) { 'npm.cmd' } else { 'npm' }
Push-Location $renderer
try {
    & $npm ci --no-audit --no-fund
    if ($LASTEXITCODE) { throw 'Renderer dependency installation failed' }
    & $npm run build
    if ($LASTEXITCODE) { throw 'Renderer build failed' }
} finally {
    Pop-Location
}
$destination = Join-Path $PSScriptRoot 'dist'
New-Item -ItemType Directory -Force -Path $destination | Out-Null
if ((Get-Item -LiteralPath $destination).Attributes -band [IO.FileAttributes]::ReparsePoint) {
    throw 'dist must be a directory inside the Catalog checkout'
}
# Start with an empty output directory so removed assets disappear on rebuild.
Get-ChildItem -LiteralPath $destination -Force | Remove-Item -Recurse -Force
Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'public') -Force |
    Copy-Item -Destination $destination -Recurse
Copy-Item -LiteralPath "$renderer/dist/eve-model-viewer.js", "$renderer/dist/vendor" -Destination $destination -Recurse
Copy-Item -LiteralPath "$renderer/dist/third-party-notices.txt" -Destination "$destination/renderer-notices.txt"
$configPath = Join-Path $destination 'site-config.json'
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json -AsHashtable
$config['frontendPublishedAt'] = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')
if ($ResourceBaseURL) { $config['resourceBaseURL'] = $ResourceBaseURL.AbsoluteUri }
if ($RendererModuleURL) { $config['rendererModuleURL'] = $RendererModuleURL.AbsoluteUri }
$config | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding utf8NoBOM
Get-Item -LiteralPath (Join-Path $destination 'index.html')
exit 0
