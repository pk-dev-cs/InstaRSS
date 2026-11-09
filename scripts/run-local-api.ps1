param([ValidateRange(1, 65535)][int]$Port = 3102)
$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$names = @('DATA_DIR', 'APP_BASE_URL', 'PORT', 'BIND_ADDRESS', 'ADMIN_PASSWORD', 'CARGO_HOME', 'RUSTUP_HOME')
$previous = @{}
foreach ($name in $names) { $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
Push-Location $projectDirectory
try {
    $cargoCommand = Get-Command cargo -ErrorAction SilentlyContinue
    if ($cargoCommand) {
        $cargoExecutable = $cargoCommand.Source
    } else {
        $env:CARGO_HOME = Join-Path $projectDirectory 'data/toolchain/cargo'
        $env:RUSTUP_HOME = Join-Path $projectDirectory 'data/toolchain/rustup'
        $cargoExecutable = Join-Path $env:CARGO_HOME 'bin/cargo.exe'
        if (-not (Test-Path -LiteralPath $cargoExecutable)) { throw 'Install the Rust toolchain before running the API.' }
    }
    if (-not $env:ADMIN_PASSWORD) {
        $secret = Read-Host 'Choose a password for the local InstaRSS API (not the source account)' -AsSecureString
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
        try { $env:ADMIN_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
        finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer); $secret.Dispose() }
        if (-not $env:ADMIN_PASSWORD) { throw 'A local API password is required.' }
    }
    $env:DATA_DIR = Join-Path $projectDirectory 'data/local-api'
    $env:PORT = "$Port"
    $env:BIND_ADDRESS = '127.0.0.1'
    $env:APP_BASE_URL = "http://127.0.0.1:$Port"
    Write-Host "Starting the local API at $env:APP_BASE_URL. Press Ctrl+C to stop."
    & $cargoExecutable run --manifest-path api/Cargo.toml --locked
    if ($LASTEXITCODE -ne 0) { throw "Rust API exited with code $LASTEXITCODE" }
} finally {
    Pop-Location
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
}
