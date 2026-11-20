$ErrorActionPreference = "Stop"
$PluginName = "opencode-free-pi"
$Uninstall = ($args -contains "-Uninstall") -or ($args -contains "--uninstall")
$Repo = if ($env:FREEPI_OPENCODE_REPO) { $env:FREEPI_OPENCODE_REPO } else { "eduardo191-star/opencode-free-pi" }
$Ref = if ($env:FREEPI_OPENCODE_REF) { $env:FREEPI_OPENCODE_REF } else { "main" }

function Get-ConfigDir {
  if ($env:OPENCODE_CONFIG_DIR) { return $env:OPENCODE_CONFIG_DIR }
  if ($env:XDG_CONFIG_HOME) { return (Join-Path $env:XDG_CONFIG_HOME "opencode") }
  return (Join-Path $HOME ".config\opencode")
}

function Write-Step([string]$Message) {
  Write-Host $Message
}

if ($Uninstall) {
  $pluginDir = Join-Path (Get-ConfigDir) "plugins"
  Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $pluginDir "$PluginName.ts")
  Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $pluginDir "$PluginName.js")
  Write-Step "Removed $PluginName from $pluginDir"
  Write-Step "Restart OpenCode to finish."
  return
}

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$configDir = Get-ConfigDir
$pluginDir = Join-Path $configDir "plugins"
$target = Join-Path $pluginDir "$PluginName.ts"
$rawBase = if ($env:FREEPI_OPENCODE_RAW_BASE) { $env:FREEPI_OPENCODE_RAW_BASE } else { "https://raw.githubusercontent.com/$Repo/$Ref" }
$temp = Join-Path ([System.IO.Path]::GetTempPath()) ("$PluginName-" + [guid]::NewGuid().ToString("N") + ".js")

try {
  $localBuild = $null
  if ($PSScriptRoot) {
    $candidate = Join-Path $PSScriptRoot "dist\index.js"
    if (Test-Path -LiteralPath $candidate) { $localBuild = $candidate }
  }

  if ($localBuild) {
    Copy-Item -LiteralPath $localBuild -Destination $temp -Force
    Write-Step "Using local build: $localBuild"
  } else {
    $url = "$rawBase/dist/index.js"
    Write-Step "Downloading $url"
    Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $temp
  }

  if (-not (Test-Path -LiteralPath $temp) -or (Get-Item -LiteralPath $temp).Length -eq 0) {
    throw "downloaded plugin is empty"
  }
  if (-not (Select-String -LiteralPath $temp -Pattern "FreePiPlugin" -Quiet)) {
    throw "downloaded file does not look like the free-pi plugin"
  }

  New-Item -ItemType Directory -Force -Path $pluginDir | Out-Null
  if (Test-Path -LiteralPath $target) {
    Copy-Item -LiteralPath $target -Destination "$target.bak" -Force
  }
  Copy-Item -LiteralPath $temp -Destination $target -Force
  Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $pluginDir "$PluginName.js")

  Write-Step "Installed $PluginName at $target"
  Write-Step ""
  Write-Step "Next steps:"
  Write-Step "  1. Run: opencode auth login -p free-pi"
  Write-Step "  2. Restart OpenCode."
  Write-Step ""
  $credentials = if ($env:FREEPI_CREDENTIALS_PATH) { $env:FREEPI_CREDENTIALS_PATH } else { "%USERPROFILE%\.free-pi\agent\credentials.json" }
  Write-Step "Credentials: $credentials"
} finally {
  Remove-Item -Force -ErrorAction SilentlyContinue $temp
}
