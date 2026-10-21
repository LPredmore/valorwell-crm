# Windows entry point. Inputs stay on the operator's WSL2 filesystem.
# Deliberately no SQL copying, transcript, logging, hosted CLI operations or uploads.
param(
    [Parameter(Mandatory=$true)][string]$PrivateRoot,
    [Parameter(Mandatory=$true)][string]$RepositoryRoot,
    [string]$Distribution = 'Ubuntu',
    [switch]$Execute,
    [switch]$KeepStackForSignedTests
)
$ErrorActionPreference = 'Stop'
if (-not $PrivateRoot.StartsWith('/') -or -not $RepositoryRoot.StartsWith('/')) {
    throw 'Use absolute WSL Linux paths, not Windows paths or network shares.'
}
if ($PrivateRoot.StartsWith('/mnt/') -or $RepositoryRoot.StartsWith('/mnt/')) {
    throw 'Use the WSL Linux filesystem, not Windows-mounted or shared folders.'
}
if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
    throw 'Install WSL2 and Docker Desktop WSL integration before running.'
}
$runner = "$RepositoryRoot/scripts/migration-recovery/private-local-restore.py"
$arguments = @('--distribution', $Distribution, '--exec', 'python3', $runner, '--private-root', $PrivateRoot)
if ($Execute) { $arguments += '--execute' }
if ($KeepStackForSignedTests) { $arguments += '--keep-stack-for-signed-tests' }
& wsl.exe @arguments
if ($LASTEXITCODE -ne 0) { throw 'Private local check/restore blocked. No SQL diagnostics were emitted.' }