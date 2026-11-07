param([switch]$NoWindow)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeDirectory = Join-Path $projectRoot '.deckmate'
New-Item -ItemType Directory -Force -Path $runtimeDirectory | Out-Null
Set-Location -LiteralPath $projectRoot

try {
    $nodeExecutable = Join-Path $env:ProgramFiles 'nodejs\node.exe'
    if (-not (Test-Path -LiteralPath $nodeExecutable)) { $nodeExecutable = (Get-Command node -ErrorAction Stop).Source }
    $env:Path = (Split-Path -Parent $nodeExecutable) + ';' + $env:Path
    # 2026-11-05: use Node's env-file precedence, exactly as server/main.ts does.
    # The server logs the legacy warning; the port probe must keep stdout numeric and stderr empty.
    $port = [int](& $nodeExecutable --env-file-if-exists=.env.local --input-type=module -e "console.log(process.env.DECKMATE_PORT ?? process.env.FREETION_PORT ?? 4317)")
    $url = "http://127.0.0.1:$port"
    function Read-DeckmateHealth {
        try { return Invoke-RestMethod -Uri "$url/api/health" -TimeoutSec 1 } catch { return $null }
    }
    function Invoke-DeckmateNpm([string[]]$NpmArguments, [string]$LogName) {
        $npmCli = Join-Path (Split-Path -Parent $nodeExecutable) 'node_modules\npm\bin\npm-cli.js'
        $arguments = @('"' + $npmCli + '"') + $NpmArguments
        # 2026-11-03: Windows PowerShell 5 treats native stderr warnings as terminating errors.
        $command = Start-Process -FilePath $nodeExecutable -ArgumentList $arguments -WorkingDirectory $projectRoot -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput (Join-Path $runtimeDirectory "$LogName.log") -RedirectStandardError (Join-Path $runtimeDirectory "$LogName-error.log")
        if ($command.ExitCode -ne 0) { throw "Command failed. See .deckmate\$LogName-error.log." }
    }
    $health = Read-DeckmateHealth
    if ($health -and $health.app -ne 'Deckmate') { throw "Port $port belongs to another application." }
    if (-not $health) {
        if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules'))) {
            Invoke-DeckmateNpm -NpmArguments @('ci') -LogName 'install'
        }
        Invoke-DeckmateNpm -NpmArguments @('run', 'check') -LogName 'check'
        Invoke-DeckmateNpm -NpmArguments @('run', 'build') -LogName 'build'
        $serverProcess = Start-Process -FilePath $nodeExecutable -ArgumentList '--env-file-if-exists=.env.local','server/main.ts' -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeDirectory 'server.log') -RedirectStandardError (Join-Path $runtimeDirectory 'server-error.log')
        for ($attempt = 0; $attempt -lt 80; $attempt++) {
            $health = Read-DeckmateHealth
            if ($health -and $health.app -eq 'Deckmate') { break }
            if ($serverProcess.HasExited) { throw 'Deckmate could not start. See .deckmate\server-error.log.' }
            Start-Sleep -Milliseconds 150
        }
        if (-not $health) { throw 'Deckmate startup timed out.' }
    }
    if (-not $NoWindow) {
        $edgeCandidates = @(
            (Join-Path ([Environment]::GetEnvironmentVariable('ProgramFiles(x86)')) 'Microsoft\Edge\Application\msedge.exe'),
            (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
        )
        $edgeExecutable = $edgeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
        if (-not $edgeExecutable) { throw 'Microsoft Edge was not found.' }
        Start-Process -FilePath $edgeExecutable -ArgumentList "--app=$url"
    }
} catch {
    $_ | Out-String | Set-Content -LiteralPath (Join-Path $runtimeDirectory 'launch-error.log') -Encoding UTF8
    if ($NoWindow) { throw }
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show("Deckmate could not start.`n$($_.Exception.Message)", 'Deckmate', 'OK', 'Error') | Out-Null
    exit 1
}
