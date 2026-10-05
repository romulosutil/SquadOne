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
$tarefaAntiga = 'DellWorker-LocalPortForwards'   # do PC antigo, com o apelido dell-worker
$pasta = Join-Path $env:LOCALAPPDATA 'Mel'
$destino = Join-Path $pasta 'mel-tuneis.ps1'
$lancador = Join-Path $pasta 'mel-tuneis.vbs'
$ssh = Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe'
$portas = 5679, 9120, 9119, 8080

function Parar-Tuneis {
  # Parar a tarefa encerra o wscript, mas o PowerShell e o ssh filhos podem
  # ficar. Procura cada um pela propria linha de comando, para nao derrubar
  # outro ssh ou PowerShell do Romulo (este instalador nao casa: o nome dele e
  # instalar-tuneis.ps1).
  foreach ($t in @(Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object { $_.TaskName -in $tarefa, $tarefaAntiga })) {
    Stop-ScheduledTask -TaskName $t.TaskName -ErrorAction SilentlyContinue
  }
  $alvos = @(
    @{ Nome = 'wscript.exe';    Padrao = '*mel-tuneis.vbs*' }
    @{ Nome = 'powershell.exe'; Padrao = '*mel-tuneis.ps1*' }
    @{ Nome = 'powershell.exe'; Padrao = '*dell-worker-tunnels.ps1*' }
    @{ Nome = 'ssh.exe';        Padrao = '*127.0.0.1:5679:127.0.0.1:5679*' }
  )
  foreach ($a in $alvos) {
    Get-CimInstance Win32_Process -Filter ("Name='{0}'" -f $a.Nome) |
      Where-Object { $_.CommandLine -like $a.Padrao } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  }
}

function Porta-Livre([int]$porta) {
  # Mesmo teste do mel-tuneis.ps1: o bind de verdade (pega as faixas do Hyper-V/WSL).
  $ouvinte = New-Object System.Net.Sockets.TcpListener ([System.Net.IPAddress]::Loopback, $porta)
  try { $ouvinte.Start(); return $true } catch { return $false } finally { try { $ouvinte.Stop() } catch { } }
}

# Sempre: tira a tarefa antiga do PC velho (fazia ssh a cada 5 s, sem espera
# crescente) e para qualquer tunel que ja esteja rodando.
Parar-Tuneis
if (Get-ScheduledTask -TaskName $tarefaAntiga -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $tarefaAntiga -Confirm:$false
  Write-Host "ok  tarefa antiga $tarefaAntiga removida"
}

if ($Desfazer) {
  if (Get-ScheduledTask -TaskName $tarefa -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $tarefa -Confirm:$false
  }
  Write-Host "Tarefa $tarefa removida e tuneis parados. ($pasta ficou; apague a mao se quiser.)"
  return
}

# 1. Pre-requisitos. Cada falha diz o que fazer e para antes de instalar.
if (-not (Test-Path $ssh)) { throw "Nao achei $ssh. Instale o OpenSSH Client (Configuracoes > Apps > Recursos opcionais)." }

# Para "ligou o PC, conectou": o ssh-agent tem de iniciar sozinho no boot. O
# agente do Windows guarda a chave adicionada com ssh-add entre reinicios
# (cifrada para o seu usuario), entao a senha da chave so e pedida uma vez.
$agente = Get-Service ssh-agent -ErrorAction SilentlyContinue
if (-not $agente) { throw "Nao achei o servico ssh-agent (OpenSSH Authentication Agent). Instale o OpenSSH Client (Configuracoes > Apps > Recursos opcionais)." }
if ($agente.StartType -ne 'Automatic' -or $agente.Status -ne 'Running') {
  Write-Host "..  ssh-agent: StartType=$($agente.StartType), Status=$($agente.Status). Vou pedir permissao de administrador (janela do UAC) so para ligar o inicio automatico."
  try {
    Start-Process powershell.exe -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile -Command "Set-Service ssh-agent -StartupType Automatic; Start-Service ssh-agent"'
  } catch {
    Write-Warning "Permissao de administrador negada ou indisponivel ($($_.Exception.Message))."
  }
  $agente = Get-Service ssh-agent
  if ($agente.StartType -ne 'Automatic' -or $agente.Status -ne 'Running') {
    throw "ssh-agent continua StartType=$($agente.StartType), Status=$($agente.Status). Num PowerShell de administrador: Set-Service ssh-agent -StartupType Automatic; Start-Service ssh-agent. Depois rode este script de novo."
  }
}
Write-Host "ok  ssh-agent automatico e rodando"

# Chave no agente. ssh-add -l: 0 = tem chave, 1 = vazio, 2 = sem agente.
$ErrorActionPreference = 'Continue'
& (Join-Path $env:WINDIR 'System32\OpenSSH\ssh-add.exe') -l *> $null
$temChave = ($LASTEXITCODE -eq 0)
$ErrorActionPreference = 'Stop'
if (-not $temChave) {
  $interativo = [Environment]::UserInteractive -and -not [Console]::IsInputRedirected
  if ($interativo) {
    Write-Host "..  o agente esta sem chave: o ssh-add vai pedir a senha da chave UMA vez (fica guardada entre reinicios)."
    $ErrorActionPreference = 'Continue'
    & (Join-Path $env:WINDIR 'System32\OpenSSH\ssh-add.exe')
    $ErrorActionPreference = 'Stop'
  } else {
    throw "O ssh-agent esta sem chave e este terminal nao e interativo (nao da para pedir a senha). Abra um PowerShell e rode: ssh-add   (pede a senha uma vez). Depois rode este script de novo."
  }
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

Start-Sleep -Seconds 2   # deixa o Windows soltar as portas dos tuneis que acabaram de parar
$ocupadas = @($portas | Where-Object { -not (Porta-Livre $_) })
if ($ocupadas -contains 5679) {
  throw "A porta 5679 do PC esta ocupada (ou reservada pelo Hyper-V/WSL: netsh int ipv4 show excludedportrange protocol=tcp). Sem ela o editor do n8n nao abre. Feche o programa que a usa (Get-Process -Id (Get-NetTCPConnection -LocalPort 5679).OwningProcess) e rode de novo."
}
if ($ocupadas.Count -gt 0) {
  Write-Warning ("Porta(s) ocupada(s) no PC: {0}. Os outros tuneis sobem; essas ficam de fora ate a porta liberar (o mel-tuneis tenta de novo sozinho)." -f ($ocupadas -join ', '))
}

# 2. Copia o script para fora do clone (trocar de branch no repositorio nao
#    pode mudar o que a tarefa roda) e cria o lancador sem janela: com o Windows
#    Terminal como terminal padrao, "-WindowStyle Hidden" deixa uma janela que,
#    fechada, derruba os tuneis. O wscript abre o PowerShell com janela 0 e
#    espera por ele (a tarefa fica "Em execucao" e IgnoreNew vale).
New-Item -ItemType Directory -Force $pasta | Out-Null
Copy-Item -Force (Join-Path $PSScriptRoot 'mel-tuneis.ps1') $destino
$comando = 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ""' + $destino + '""'
Set-Content -Path $lancador -Encoding Unicode -Value @(
  "' Abre o mel-tuneis.ps1 sem janela. Gerado por instalar-tuneis.ps1."
  ('CreateObject("WScript.Shell").Run "' + $comando + '", 0, True')
)

# 3. Tarefa no logon, so do usuario atual (usa o ssh-agent dele), sem limite de
#    tempo, prioridade normal (a padrao da tarefa, 7, passaria ao ssh).
$acao = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$lancador`"" -WorkingDirectory $pasta
$gatilho = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$config = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 99 -RestartInterval (New-TimeSpan -Minutes 1) -Priority 5
$quem = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
try {
  Register-ScheduledTask -TaskName $tarefa -Action $acao -Trigger $gatilho -Settings $config -Principal $quem `
    -Description "Tuneis SSH do PC para a Mel (5679, 9120, 9119, 8080 em 127.0.0.1). Desfazer: instalar-tuneis.ps1 -Desfazer" -Force | Out-Null
} catch {
  throw "Nao consegui registrar a tarefa ($($_.Exception.Message)). Se for 'Acesso negado', rode num PowerShell de administrador aberto com o MESMO usuario (outra conta de admin instalaria a tarefa para ela, sem a sua chave)."
}
Start-ScheduledTask -TaskName $tarefa
Write-Host "ok  tarefa $tarefa registrada e iniciada"

# 4. Prova: cada porta responde pelo tunel (ate ~30 s, a 1a conexao pode demorar).
$testes = [ordered]@{
  5679 = @('n8n      ', 'http://127.0.0.1:5679/healthz')
  9120 = @('Central  ', 'http://127.0.0.1:9120/')
  9119 = @('Hermes   ', 'http://127.0.0.1:9119/')
  8080 = @('code-srv ', 'http://127.0.0.1:8080/')
}
$falhou = $false
# GetEnumerator e nao $testes[$p]: num [ordered] com chave inteira, o indice
# inteiro e a POSICAO, nao a chave.
foreach ($item in $testes.GetEnumerator()) {
  $p = $item.Key
  $rotulo, $url = $item.Value
  if ($ocupadas -contains $p) { Write-Warning "$rotulo $url pulado (porta ocupada no PC)"; continue }
  $resposta = $null
  $limite = (Get-Date).AddSeconds(30)
  while (-not $resposta -and (Get-Date) -lt $limite) {
    try {
      $resposta = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 -Uri $url -ErrorAction Stop).StatusCode
    } catch {
      $r = $_.Exception.Response
      # 401/403/404 tambem provam que o tunel chegou ate o servico.
      if ($r -and [int]$r.StatusCode -lt 500) { $resposta = [int]$r.StatusCode } else { Start-Sleep -Seconds 3 }
    }
  }
  if ($resposta) { Write-Host ("ok  {0} {1}  ({2})" -f $rotulo, $url, $resposta) }
  else { Write-Warning ("{0} {1}: sem resposta em 30 s" -f $rotulo, $url); $falhou = $true }
}
if ($falhou) {
  Write-Warning "Algum tunel nao respondeu. Veja $pasta\tuneis.log e $pasta\ssh.log."
}

# 5. O resto do "ligou o PC, conectou": so confere e diz o que falta (nao mexe
#    na Tailscale nem na tarefa de backup).
Write-Host ""
Write-Host "Ao ligar o PC:"
$ts = Get-Service Tailscale -ErrorAction SilentlyContinue
if ($ts -and $ts.StartType -eq 'Automatic') { Write-Host "ok  Tailscale inicia com o Windows" }
else { Write-Warning "Servico Tailscale nao esta automatico (StartType=$($ts.StartType)). Admin: Set-Service Tailscale -StartupType Automatic" }
$tsExe = Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'
if (Test-Path $tsExe) {
  $ErrorActionPreference = 'Continue'
  $prefs = (& $tsExe debug prefs 2>$null) -join "`n"
  $ErrorActionPreference = 'Stop'
  if ($prefs -match '"ForceDaemon":\s*true') { Write-Host "ok  Tailscale em 'Run unattended' (conecta antes do login)" }
  elseif ($prefs) { Write-Warning "Tailscale sem 'Run unattended': ela so conecta depois do login, e os tuneis esperam por ela. Para conectar ja no boot: icone da Tailscale > Settings (ou Preferences) > Run unattended." }
}
if (Get-ScheduledTask -TaskName 'Backup-Estrutura-PC' -ErrorAction SilentlyContinue) { Write-Host "ok  tarefa Backup-Estrutura-PC (logon e 03:30)" }
else { Write-Warning "Nao achei a tarefa Backup-Estrutura-PC (backup diario do PC para a Mel)." }
Write-Host "ok  tarefa ${tarefa}: no logon, sem janela; espera a Mel aparecer na rede e conecta na hora; religa sozinha se cair"
Write-Host ""
Write-Host "Pronto. Sessao do Claude na Mel: app Claude > Code > ambiente > + Add SSH connection > host mel."
