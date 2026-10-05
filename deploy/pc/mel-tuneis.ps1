# Tuneis locais do PC (Jarvis) para a Mel (o Dell).
#
# O que na Mel so escuta em 127.0.0.1 (editor do n8n, code-server) passa a abrir
# no navegador do PC no MESMO endereco. Por que o mesmo endereco: o login do
# Google do n8n volta para http://127.0.0.1:5679, e os links antigos da planilha
# (http://127.0.0.1:5679/webhook/...) so funcionam onde 127.0.0.1:5679 for o n8n.
#
# Roda escondido pela tarefa agendada "Mel-Tuneis" (instalar-tuneis.ps1).
# Sozinho, para testar: powershell -ExecutionPolicy Bypass -File mel-tuneis.ps1
#
# Precisa de: Host "mel" no ~/.ssh/config e a chave carregada no ssh-agent do
# Windows (BatchMode: sem agente, o ssh falha em vez de pedir a senha).
# Arquivo so com ASCII de proposito: o Windows PowerShell 5.1 le .ps1 sem BOM
# como ANSI e acento quebra o script.

$ErrorActionPreference = 'Continue'

$ssh = Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe'
$pasta = Join-Path $env:LOCALAPPDATA 'Mel'
$log = Join-Path $pasta 'tuneis.log'
New-Item -ItemType Directory -Force $pasta | Out-Null

$sshArgumentos = @(
  '-N'
  '-o', 'BatchMode=yes'
  '-o', 'ExitOnForwardFailure=yes'
  '-o', 'ServerAliveInterval=15'
  '-o', 'ServerAliveCountMax=3'
  '-L', '127.0.0.1:9119:127.0.0.1:9119'   # Hermes (painel)
  '-L', '127.0.0.1:9120:127.0.0.1:9120'   # Central do SquadOne
  '-L', '127.0.0.1:5679:127.0.0.1:5679'   # n8n (editor e webhooks)
  '-L', '127.0.0.1:8080:127.0.0.1:8080'   # code-server
  'mel'
)

function Registrar([string]$texto) {
  # Log curto: passou de 256 KB, vira .old (so guarda o ultimo).
  if ((Test-Path $log) -and ((Get-Item $log).Length -gt 256KB)) {
    Move-Item -Force $log "$log.old"
  }
  Add-Content -Path $log -Value ("{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $texto)
}

# Espera entre tentativas: 15 s depois de uma sessao longa; dobra (ate 5 min)
# quando o ssh cai logo, para uma chave fora do agente ou uma porta ocupada nao
# virar uma tentativa de login na Mel a cada poucos segundos.
$espera = 15
while ($true) {
  $inicio = Get-Date
  & $ssh @sshArgumentos
  $codigo = $LASTEXITCODE
  $durou = [int]((Get-Date) - $inicio).TotalSeconds
  if ($durou -lt 60) { $espera = [Math]::Min($espera * 2, 300) } else { $espera = 15 }
  Registrar ("ssh saiu com codigo {0} depois de {1} s; nova tentativa em {2} s" -f $codigo, $durou, $espera)
  Start-Sleep -Seconds $espera
}
