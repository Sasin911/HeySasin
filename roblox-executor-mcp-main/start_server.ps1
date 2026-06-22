$logFile = Join-Path $PSScriptRoot "server_stdout3.log"
$errFile = Join-Path $PSScriptRoot "server_stderr3.log"
$p = Start-Process -FilePath "node.exe" -ArgumentList "dist/index.js" -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru
$p.Id | Out-File (Join-Path $PSScriptRoot "server_pid.txt") -Encoding utf8
while (!$p.HasExited) {
    Start-Sleep -Seconds 10
}
