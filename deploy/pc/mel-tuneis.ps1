# Tuneis locais do PC (Jarvis) para a Mel (o Dell).
#
# O que na Mel so escuta em 127.0.0.1 (editor do n8n, code-server) passa a abrir
# no navegador do PC no MESMO endereco. Por que o mesmo endereco: o login do
# Google do n8n volta para http://127.0.0.1:5679, e os links antigos da planilha
# (http://127.0.0.1:5679/webhook/...) so funcionam onde 127.0.0.1:5679 for o n8n.
#
# Roda sem janela pela tarefa agendada "Mel-Tuneis" (instalar-tuneis.ps1).
# Para testar a mao, pare a tarefa antes (so roda uma instancia por vez):
#   Stop-ScheduledTask Mel-Tuneis; powershell -ExecutionPolicy Bypass -File mel-tuneis.ps1
#
# Precisa de: Host "mel" no ~/.ssh/config e a chave carregada no ssh-agent do
# Windows (BatchMode: sem agente, o ssh falha em vez de pedir a senha).
# Arquivo so com ASCII de proposito: o Windows PowerShell 5.1 le .ps1 sem BOM
# como ANSI e acento quebra o script.

$ErrorActionPreference = 'Continue'

$ssh = Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe'
$pasta = Join-Path $env:LOCALAPPDATA 'Mel'
$log = Join-Path $pasta 'tuneis.log'
$logSsh = Join-Path $pasta 'ssh.log'
New-Item -ItemType Directory -Force $pasta | Out-Null

# Porta local = porta na Mel, sempre em 127.0.0.1 dos dois lados.
$portas = [ordered]@{
  5679 = 'n8n (editor e webhooks)'
  9120 = 'Central do SquadOne'
  9119 = 'Hermes (painel)'
  8080 = 'code-server'
}

function Registrar([string]$texto) {
  Add-Content -Path $log -Value ("{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $texto)
}

function Girar([string]$arquivo) {
  # Log curto: passou de 256 KB, vira .old (so guarda o ultimo).
  if ((Test-Path $arquivo) -and ((Get-Item $arquivo).Length -gt 256KB)) {
    Move-Item -Force $arquivo "$arquivo.old"
  }
}

function Porta-Livre([int]$porta) {
  # Testa o mesmo bind que o ssh vai fazer. Pega tambem as faixas reservadas
  # pelo Hyper-V/WSL, que o Get-NetTCPConnection nao mostra.
  $ouvinte = New-Object System.Net.Sockets.TcpListener ([System.Net.IPAddress]::Loopback, $porta)
  try { $ouvinte.Start(); return $true } catch { return $false } finally { try { $ouvinte.Stop() } catch { } }
}

function Endereco-Da-Mel {
  # O mesmo endereco que o ssh vai usar (Host mel do ~/.ssh/config). Sem
  # resposta do ssh -G, volta $null e o laco nao espera pela rede: tenta o ssh
  # direto (melhor tentar a toa do que esperar para sempre um nome errado).
  $nome = $null; $porta = 22
  foreach ($linha in (& $ssh -G mel 2>$null)) {
    if ($linha -match '^hostname\s+(\S+)') { $nome = $Matches[1] }
    elseif ($linha -match '^port\s+(\d+)') { $porta = [int]$Matches[1] }
  }
  return @($nome, $porta)
}

function Mel-Alcancavel([string]$nome, [int]$porta) {
  # So TCP, sem login: enquanto a Tailscale sobe (logo depois de ligar o PC ou
  # de acordar do sono) o nome nem resolve, e isso nao conta como falha do ssh.
  $cliente = New-Object System.Net.Sockets.TcpClient
  try {
    $tentativa = $cliente.BeginConnect($nome, $porta, $null, $null)
    if (-not $tentativa.AsyncWaitHandle.WaitOne(2000)) { return $false }
    $cliente.EndConnect($tentativa)
    return $true
  } catch { return $false } finally { $cliente.Close() }
}

# Uma instancia so: duas brigariam pelas mesmas portas e uma ficaria
# logando na Mel a cada tentativa.
$criado = $false
$trava = New-Object System.Threading.Mutex($true, 'Local\MelTuneis', [ref]$criado)
if (-not $criado) { Registrar 'outra instancia ja esta rodando; saindo'; exit 0 }

# Espera entre tentativas: 15 s depois de uma sessao longa; dobra (ate 5 min)
# quando o ssh cai logo, para uma chave fora do agente nao virar uma tentativa
# de login na Mel a cada poucos segundos. Rede fora (Mel inalcancavel) nao
# entra nessa conta: o script olha a cada 3 s e conecta assim que a Mel
# aparece, sem fazer login nenhum enquanto isso.
$espera = 15
$melNome, $melPorta = Endereco-Da-Mel
Registrar ("iniciado; Mel em {0}:{1}" -f $(if ($melNome) { $melNome } else { '(ssh -G sem resposta)' }), $melPorta)
$avisouRede = $false
while ($true) {
  Girar $log
  Girar $logSsh

  if ($melNome -and -not (Mel-Alcancavel $melNome $melPorta)) {
    if (-not $avisouRede) { Registrar 'Mel ainda inalcancavel (Tailscale subindo ou sem rede); conecto assim que aparecer'; $avisouRede = $true }
    Start-Sleep -Seconds 3
    continue
  }
  if ($avisouRede) { Registrar 'Mel alcancavel'; $avisouRede = $false }

  # Porta ocupada por outro programa fica de fora nesta rodada: com
  # ExitOnForwardFailure, uma so derrubaria os quatro tuneis (e o login na Mel
  # se repetiria a cada tentativa).
  $encaminhar = @()
  $fora = @()
  foreach ($p in $portas.Keys) {
    if (Porta-Livre $p) { $encaminhar += '-L', ("127.0.0.1:{0}:127.0.0.1:{0}" -f $p) } else { $fora += $p }
  }
  if ($fora.Count -gt 0) { Registrar ("porta(s) ocupada(s) no PC, sem tunel nesta rodada: {0}" -f ($fora -join ', ')) }

  if ($encaminhar.Count -eq 0) {
    $espera = 300
  } else {
    $sshArgumentos = @(
      '-N'
      '-o', 'BatchMode=yes'
      '-o', 'ExitOnForwardFailure=yes'
      '-o', 'ConnectTimeout=10'
      '-o', 'ServerAliveInterval=15'
      '-o', 'ServerAliveCountMax=3'
      '-E', $logSsh
    ) + $encaminhar + @('mel')
    $inicio = Get-Date
    & $ssh @sshArgumentos
    $codigo = $LASTEXITCODE
    $durou = [int]((Get-Date) - $inicio).TotalSeconds
    if ($durou -lt 60) { $espera = [Math]::Min($espera * 2, 300) } else { $espera = 15 }
    Registrar ("ssh saiu com codigo {0} depois de {1} s (erro em ssh.log); nova tentativa em {2} s" -f $codigo, $durou, $espera)
  }
  Start-Sleep -Seconds $espera
}
