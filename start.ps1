[CmdletBinding()]
param(
    [int]$Port = 8795,
    [string]$Renderer = (Join-Path (Split-Path $PSScriptRoot) 'EVE-Carbon-Renderer'),
    [string]$Cache = $env:EVE_SHARED_CACHE,
    [string]$Published,
    [string]$Addon
)
$ErrorActionPreference = 'Stop'
if (!$Cache -and (Test-Path 'E:/EVE/SharedCache')) { $Cache = 'E:/EVE/SharedCache' }
if (!$Cache) { throw 'Supply -Cache pointing to EVE SharedCache.' }
if (!$Published) { $Published = Join-Path $Renderer '.work/published' }
if (!(Test-Path (Join-Path $Published 'data/catalog-index.json'))) { throw 'Supply -Published pointing to the published resource directory (assets/ and data/).' }
if (!$Addon) {
    $Addon = Join-Path $Renderer 'tools/model_export/.deps/tools-blender'
    if (!(Test-Path $Addon)) { $Addon = Join-Path (Split-Path $Renderer) 'upstream/carbonenginejs/tools-blender' }
}
& py -3 (Join-Path $Renderer 'model-catalog/scripts/serve_dna_hulls.py') --cache $Cache --published $Published --frontend $PSScriptRoot --addon $Addon --port $Port
exit $LASTEXITCODE
