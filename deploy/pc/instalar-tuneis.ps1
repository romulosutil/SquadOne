# Instala no PC (Jarvis) a tarefa "Mel-Tuneis", que mantem os tuneis SSH para a
# Mel no ar desde o logon (ver mel-tuneis.ps1 e o README desta pasta).
#
#   powershell -ExecutionPolicy Bypass -File .\instalar-tuneis.ps1            # instala e testa
#   powershell -ExecutionPolicy Bypass -File .\instalar-tuneis.ps1 -Desfazer  # tira tudo
#
# Nao precisa de administrador. Nao mexe no ~/.ssh/config nem na chave.
# Arquivo so com ASCII de proposito (Windows PowerShell 5.1 le .ps1 sem BOM como ANSI).

param([switch]$Desfazer)

$ErrorActionPreference = 'Stop'
$tarefa = 'Mel-Tuneis'
$pasta = Join-Path $env:LOCALAPPDATA 'Mel'
$destino = Join-Path $pasta 'mel-tuneis.ps1'
$ssh = Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe'
$portas = 9119, 9120, 5679, 8080

function Parar-Tuneis {
  # Parar a tarefa encerra o PowerShell, mas o ssh filho pode ficar: procura pelo
  # proprio encaminhamento, para nao derrubar outro ssh do Romulo.
  Get-CimInstance Win32_Process -Filter "Name='ssh.exe'" |
    Where-Object { $_.CommandLine -like '*127.0.0.1:5679:127.0.0.1:5679*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

if ($Desfazer) {
  if (Get-ScheduledTask -TaskName $tarefa -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $tarefa -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $tarefa -Confirm:$false
  }
  Parar-Tuneis
  Write-Host "Tarefa $tarefa removida e tuneis parados. ($pasta ficou; apague a mao se quiser.)"
  return
}

# 1. Pre-requisitos. Cada falha diz o que fazer e para antes de instalar.
if (-not (Test-Path $ssh)) { throw "Nao achei $ssh. Instale o OpenSSH Client (Configuracoes > Apps > Recursos opcionais)." }

$agente = Get-Service ssh-agent -ErrorAction SilentlyContinue
if (-not $agente -or $agente.Status -ne 'Running') {
  throw "O servico ssh-agent nao esta rodando. Num PowerShell de administrador: Set-Service ssh-agent -StartupType Automatic; Start-Service ssh-agent. Depois: ssh-add ~/.ssh/id_ed25519"
}
if ($agente.StartType -ne 'Automatic') {
  Write-Warning "ssh-agent esta rodando mas nao inicia sozinho (StartType=$($agente.StartType)). Depois de reiniciar o PC os tuneis nao sobem. Admin: Set-Service ssh-agent -StartupType Automatic"
}

# No PowerShell 5.1, stderr de programa nativo com ErrorActionPreference=Stop
# vira excecao (um simples aviso do ssh derrubaria o script): Continue so aqui.
$ErrorActionPreference = 'Continue'
$nome = & $ssh -o BatchMode=yes -o ConnectTimeout=10 mel hostname 2>$null
$codigo = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
if ($codigo -ne 0 -or "$nome" -notmatch 'Latitude-7420') {
  throw "ssh mel nao respondeu sem senha (codigo $codigo). Confira: Tailscale ligado, Host mel no ~/.ssh/config, chave no agente (ssh-add -l). Para ver o erro: ssh -o BatchMode=yes mel hostname"
}
Write-Host "ok  ssh mel sem senha: $nome"

# Se a tarefa ja existe (reinstalacao), para antes de olhar as portas: os
# proprios tuneis dela ocupam as 4.
if (Get-ScheduledTask -TaskName $tarefa -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $tarefa -ErrorAction SilentlyContinue
  Parar-Tuneis
  Start-Sleep -Seconds 2
}
$ocupadas = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $portas -contains $_.LocalPort } | Select-Object -ExpandProperty LocalPort -Unique
if ($ocupadas) {
  throw "Porta(s) local(is) ja em uso no PC: $($ocupadas -join ', '). Feche o programa que usa (Get-Process -Id (Get-NetTCPConnection -LocalPort <porta>).OwningProcess) e rode de novo."
}

# 2. Copia o script para fora do clone (trocar de branch no repositorio nao
#    pode mudar o que a tarefa roda).
New-Item -ItemType Directory -Force $pasta | Out-Null
Copy-Item -Force (Join-Path $PSScriptRoot 'mel-tuneis.ps1') $destino

# 3. Tarefa no logon, so do usuario atual (usa o ssh-agent dele), sem limite de
#    tempo, religando se o PowerShell morrer.
$acao = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$destino`"" `
  -WorkingDirectory $pasta
$gatilho = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$config = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
$quem = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
try {
  Register-ScheduledTask -TaskName $tarefa -Action $acao -Trigger $gatilho -Settings $config -Principal $quem `
    -Description "Tuneis SSH do PC para a Mel (9119, 9120, 5679, 8080 em 127.0.0.1). Desfazer: instalar-tuneis.ps1 -Desfazer" -Force | Out-Null
} catch {
  throw "Nao consegui registrar a tarefa ($($_.Exception.Message)). Se for 'Acesso negado', rode este script num PowerShell de administrador."
}
Start-ScheduledTask -TaskName $tarefa
Write-Host "ok  tarefa $tarefa registrada e iniciada"

# 4. Prova: cada porta responde pelo tunel.
Start-Sleep -Seconds 6
$testes = [ordered]@{
  'Central   http://127.0.0.1:9120/'        = 'http://127.0.0.1:9120/'
  'Hermes    http://127.0.0.1:9119/'        = 'http://127.0.0.1:9119/'
  'n8n       http://127.0.0.1:5679/healthz' = 'http://127.0.0.1:5679/healthz'
  'code-srv  http://127.0.0.1:8080/'        = 'http://127.0.0.1:8080/'
}
$falhou = $false
foreach ($t in $testes.GetEnumerator()) {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 -Uri $t.Value -ErrorAction Stop
    Write-Host ("ok  {0}  ({1})" -f $t.Key, $r.StatusCode)
  } catch {
    $resp = $_.Exception.Response
    if ($resp -and [int]$resp.StatusCode -lt 500) {
      # 401/403/404 tambem provam que o tunel chegou ate o servico.
      Write-Host ("ok  {0}  ({1})" -f $t.Key, [int]$resp.StatusCode)
    } else {
      Write-Warning ("{0}: sem resposta ({1})" -f $t.Key, $_.Exception.Message)
      $falhou = $true
    }
  }
}
if ($falhou) {
  Write-Warning "Algum tunel nao respondeu. Veja $pasta\tuneis.log e rode: ssh -N -L 127.0.0.1:9120:127.0.0.1:9120 mel (deixa aberto e mostra o erro)."
} else {
  Write-Host "Pronto. Os tuneis sobem sozinhos a cada logon."
}
