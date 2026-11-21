$ErrorActionPreference = "Stop"
$Package = "@eduardo191labs/opencode-free-pi"
$PluginName = "opencode-free-pi"
$Uninstall = ($args -contains "-Uninstall") -or ($args -contains "--uninstall")

function Get-ConfigDir {
  if ($env:OPENCODE_CONFIG_DIR) { return $env:OPENCODE_CONFIG_DIR }
  if ($env:XDG_CONFIG_HOME) { return (Join-Path $env:XDG_CONFIG_HOME "opencode") }
  return (Join-Path $HOME ".config\opencode")
}

function Write-Step([string]$Message) {
  Write-Host $Message
}

function Get-ConfigFile([string]$Dir) {
  foreach ($name in @("opencode.json", "opencode.jsonc", "opencode.json5")) {
    $candidate = Join-Path $Dir $name
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  return (Join-Path $Dir "opencode.json")
}

function Update-Config([string]$Dir, [bool]$Remove) {
  New-Item -ItemType Directory -Force -Path $Dir | Out-Null
  $file = Get-ConfigFile $Dir
  $config = $null
  if (Test-Path -LiteralPath $file) {
    try {
      $config = Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
    } catch {
      Write-Step "free-pi: no se pudo editar $file automáticamente."
      Write-Step "free-pi: edita `"plugins`" y quita o añade `"$Package`"."
      return
    }
  }
  if ($null -eq $config) {
    $config = [pscustomobject]@{ '$schema' = "https://opencode.ai/config.json" }
  }

  $plugins = @()
  if ($null -ne $config.plugins) { $plugins = @($config.plugins) }

  if ($Remove) {
    $plugins = @($plugins | Where-Object {
      if ($_ -is [string]) { return -not ($_ -eq $Package -or $_.StartsWith("$Package@")) }
      return ($null -eq $_ -or $_.package -ne $Package)
    })
  } else {
    $present = $plugins | Where-Object {
      if ($_ -is [string]) { return ($_ -eq $Package -or $_.StartsWith("$Package@")) }
      return ($null -ne $_ -and $_.package -eq $Package)
    }
    if (-not $present) { $plugins += $Package }
  }

  if ($null -eq $config.PSObject.Properties["plugins"]) {
    $config | Add-Member -NotePropertyName "plugins" -NotePropertyValue $plugins -Force
  } else {
    $config.plugins = $plugins
  }

  $config | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $file -Encoding UTF8
  if ($Remove) {
    Write-Step "free-pi: eliminado de $file."
  } else {
    Write-Step "free-pi: registrado en $file."
  }
}

$configDir = Get-ConfigDir

if ($Uninstall) {
  Update-Config $configDir $true
  $pluginDir = Join-Path $configDir "plugins"
  Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $pluginDir "$PluginName.ts")
  Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $pluginDir "$PluginName.js")
  & npm uninstall -g $Package 2>$null | Out-Null
  Write-Step "Removed $Package."
  Write-Step "Restart OpenCode to finish."
  return
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js 20+ is required"
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "npm is required"
}

Write-Step "Installing $Package..."
& npm install -g "$Package@latest"
if ($LASTEXITCODE -ne 0) { throw "npm install failed" }

if (Get-Command opencode -ErrorAction SilentlyContinue) {
  & opencode plugin add "$Package@latest" 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) {
    & opencode plugin --global "$Package@latest" 2>$null | Out-Null
  }
}

Update-Config $configDir $false

Write-Step ""
Write-Step "Next steps:"
Write-Step "  1. Run: opencode auth login free-pi"
Write-Step "  2. Restart OpenCode (or run /reload)."
Write-Step ""
$credentials = if ($env:FREEPI_CREDENTIALS_PATH) { $env:FREEPI_CREDENTIALS_PATH } else { "%USERPROFILE%\.free-pi\agent\credentials.json" }
Write-Step "Credentials: $credentials"
