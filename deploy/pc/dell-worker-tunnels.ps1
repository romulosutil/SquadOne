$ErrorActionPreference = 'Continue'

$sshPath = Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe'
$sshArguments = @(
  '-N'
  '-o', 'BatchMode=yes'
  '-o', 'ExitOnForwardFailure=yes'
  '-o', 'ServerAliveInterval=15'
  '-o', 'ServerAliveCountMax=3'
  '-L', '127.0.0.1:9119:127.0.0.1:9119'
  '-L', '127.0.0.1:9120:127.0.0.1:9120'
  '-L', '127.0.0.1:8080:127.0.0.1:8080'
  '-L', '127.0.0.1:5679:127.0.0.1:5679'
  'dell-worker'
)

while ($true) {
  & $sshPath @sshArguments
  Start-Sleep -Seconds 5
}
