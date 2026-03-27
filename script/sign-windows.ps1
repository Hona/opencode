param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $Path
)

$ErrorActionPreference = "Stop"

if (-not $Path -or $Path.Count -eq 0) {
  throw "At least one path is required"
}

$vars = @{
  endpoint = $env:AZURE_TRUSTED_SIGNING_ENDPOINT
  account = $env:AZURE_TRUSTED_SIGNING_ACCOUNT_NAME
  profile = $env:AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE
}

if ($vars.Values | Where-Object { -not $_ }) {
  Write-Host "Skipping Windows signing because Azure Artifact Signing is not configured"
  exit 0
}

if (-not (Get-Command sign -ErrorAction SilentlyContinue)) {
  Write-Host "Skipping Windows signing because sign was not found on PATH"
  exit 0
}

$files = @($Path | ForEach-Object { Resolve-Path $_ -ErrorAction SilentlyContinue } | Select-Object -ExpandProperty Path -Unique)

if (-not $files -or $files.Count -eq 0) {
  throw "No files matched the requested paths"
}

$groups = $files | Group-Object { Split-Path $_ -Parent }

foreach ($group in $groups) {
  $dir = $group.Name
  $names = @($group.Group | ForEach-Object { Split-Path $_ -Leaf })

  & sign code artifact-signing `
    -b $dir `
    -ase $vars.endpoint `
    -ascp $vars.profile `
    -asa $vars.account `
    @names `
    -v Information

  if ($LASTEXITCODE -ne 0) {
    throw "Azure Artifact Signing failed for $($group.Name)"
  }
}
