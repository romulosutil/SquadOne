#!/usr/bin/env python3
"""Esteira "Site antes da venda" no Dell: gera os sites da fila sem o PC ligado.

Porte do `executar-fila-leads.ps1` (G:\\Meu Drive\\auto), que só rodava com o PC
ligado às 08h e não gerava nada automático desde 17/09/2026. A pasta é a mesma
(`~/auto-site`; o espelho no Drive, pelo PC, parou em 25/09/2026), e o contrato
também:

- fila = pasta sem `.`/`_` no começo, com `content.md` e sem `publicado.json`,
  mais antiga primeiro pela data do `content.md`;
- o Claude roda `/lead-novo <slug>` com contexto limpo e publica sozinho; se ele
  deixou um `index.html` completo (fecha em `</html>`) sem recibo, este runner
  publica na Vercel e escreve o `publicado.json` com a URL REAL da linha
  "Aliased:" — URL montada à mão poderia não existir e o n8n mandaria link morto;
- sucesso = `publicado.json` com `site_url` que responde HTTP 200.

Diferenças de propósito em relação ao PS1:
- lead com 2 falhas registradas em `falha.log` sai da fila (o PS1 insistia todo
  dia nos mesmos leads quebrados); apagar o `falha.log` devolve o lead;
- `index.html` truncado não é apagado: é renomeado para `index.truncado.html`,
  para o próximo Claude recomeçar sem perder a evidência;
- trava em `.logs/gerador.lock` (com host e pid): se o PC ainda rodar a tarefa
  antiga, os dois não pegam o mesmo lead ao mesmo tempo;
- lead que o Claude tira da raiz no meio da geração (duplicado ou que já tem
  site vai para `_descartados/`) é resultado legítimo, não falha: fica no log
  e no resumo, e a fila segue. Nenhum erro de um lead derruba o lote (29/09/2026:
  um `falha.log` na pasta que o Claude tinha movido matou a execução inteira).

Sinais na raiz da pasta, como no PS1: `.parar` encerra a execução no fim do
lead atual. O `.logs/status.json` continua sendo o que a Central lê.

Desde 30/09/2026 o Claude não roda mais com `--dangerously-skip-permissions`:
roda em modo `dontAsk` com uma lista de permissão montada por lead
(`permissoes_do_claude`). O que não está na lista é negado sem pergunta, o
Claude segue pelo caminho permitido, e cada negação vai para o log do lead como
`[NEGADO] ...`, para afinar a lista.

Desde 05/10/2026 quem move um lead descartado é o runner, não o Claude: a lista
só deixa o Claude escrever na pasta do lead, e naquele dia ele concluiu que o
`baby-school-bercario-maternal` já tinha site, não pôde movê-lo para
`_descartados/` e o lead contou como falha duas vezes (serviço FAILED, aviso no
WhatsApp). Agora o Claude grava `DESCARTAR.md` (motivo) na pasta do lead e o
runner a move e conta como descarte. Pasta com `DESCARTAR.md` nunca entra na
fila, e o começo de cada execução move as que ficaram de uma anterior.

Também desde 05/10/2026 o lead cuja busca foi pausada (o "06 · Funil semanal"
pausa busca com 5+ enviados e nenhuma resposta, ou o Rômulo desliga `ativa`)
fica fora da fila: o funil lista os `place_id` em `nao_gerar` no
`site-funil.json`. Sem o arquivo, ou ilegível, a fila é a de sempre.

Modo personalizado (`--refazer SLUG...`, 07/10/2026): a Baby School, ao ver o demo,
deixou claro que o trabalho não parecia feito para ela. O `content.md` do Places
tem ~2 KB (nome, endereço, telefone, nota, avaliações) e dele só sai uma página
correta e intercambiável. Neste modo o runner refaz leads que já têm demo e AINDA
NÃO FORAM ENVIADOS (status `pronto` no retrato da planilha; enviado nunca é
refeito): guarda o site anterior em `_v1/` dentro da pasta, devolve o lead à
fila só desta execução e manda o Claude pesquisar o negócio (dossiê), definir um
conceito que só serve àquele negócio, escrever o texto à mão e se revisar como o
dono antes de publicar. Falhou ou estourou o tempo: o `_v1/` volta para o lugar
e o demo antigo segue no ar. Uma tentativa por lead, sem `falha.log`.
"""

from __future__ import annotations

import argparse
import collections
import datetime as dt
import importlib.util
import json
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import traceback
import urllib.request
from pathlib import Path

AUTO = Path(os.environ.get("AUTO_DIR", str(Path.home() / "auto-site")))
LOGS = AUTO / ".logs"
LOG_FILA = LOGS / "execucao-fila.log"
STATUS = LOGS / "status.json"
TRAVA = LOGS / "gerador.lock"
SINAL_PARAR = AUTO / ".parar"
# O Claude grava este arquivo na pasta do lead para descartá-lo (ele não pode
# mover a pasta: a lista de permissão só abre a escrita dentro dela).
SINAL_DESCARTE = "DESCARTAR.md"
DESCARTADOS = AUTO / "_descartados"
# O Chrome headless sem --user-data-dir abre um perfil temporário aqui (scoped_dir*) e só o apaga se
# sair sozinho. Morto por SIGKILL ou timeout (matar_grupo), cada captura deixava ~3 MB: 34 GB em 4 dias.
CACHE_CHROME = Path(os.environ.get("CHROME_HEADLESS_CACHE", str(Path.home() / ".cache" / "google-chrome-headless")))
# Um Chrome vivo mexe no perfil dele o tempo todo; só o que está parado há mais que isto é lixo.
IDADE_MIN_CACHE_CHROME_S = 600
# Gravado pelo "06 · Funil semanal" (n8n, segunda 08:00); `nao_gerar` são os
# leads `novo` de busca pausada.
FUNIL = Path(os.environ.get("SITE_FUNIL", str(Path.home() / ".local/share/n8n-estado/site-funil.json")))
# Imagem do cartão de prévia (og:image). O Rômulo manda só o link no WhatsApp, e
# até 05/10/2026 nenhum demo tinha og:image: o cartão saía sem foto. É o único
# arquivo além do index.html que sobe (lista de permissão: content.md, Fotos/ e o
# resto da pasta nunca vão para a Vercel).
IMAGEM_DA_PREVIA = "og.jpg"
VERCEL_SCOPE = os.environ.get("VERCEL_SCOPE", "romulodesigns")
MAX_FALHAS = 2
# TimeoutStartSec=4h no .service: não começa lead que pode estourar o teto (com
# folga para o deploy do último), senão o systemd mata a execução no meio.
TETO_MIN = 4 * 60 - 20
# "Metáfora e Atos" (08/10/2026): a direção do redesign conceitual do site do PRUMO virou a dos
# demos. Antes o prompt pedia só "mais movimento", e o fluxo comum saía em ordem de template com
# efeito sem significado; o passo 1.5.1 do CLAUDE.md diz como escolher a metáfora e montar os Atos.
PROMPT = (
    "/lead-novo {slug} na direção de metáfora e Atos (passo 1.5.1 do CLAUDE.md: uma metáfora do ofício que "
    "dita a navegação, cinco Atos do Google ao WhatsApp, movimento só com significado), usando as fotos e recursos "
    "extras; cumpra o passo 1.6.1: selecione uma referencia em styles.refero.design, copie o DESIGN.md para a "
    "pasta do lead e registre a referencia"
)
LIMITE_DE_USO = re.compile(r"(?i)(rate limit|usage limit|\b429\b)")
# Modo personalizado: o site anterior do lead fica aqui dentro (nunca sobe para a
# Vercel: só index.html e og.jpg sobem) até o novo ser publicado e validado.
# v1 = dossiê, conceito, redação e revisão (07/10/2026 à tarde); v2 = soma a etapa de
# movimento de nível especialista (motor próprio em JS, scroll narrativo, interações autorais).
VERSAO_PERSONALIZADO = 2
# v3 = modo premium (referências do Refero a cada lead, imagem feita em código, laço de crítica visual).
VERSAO_PREMIUM = 3
MODO_PREMIUM = False  # ligado por `--premium` em main()
NOTA_DA_REVISAO: str | None = None  # `--nota`: feedback do Rômulo que o refazer premium deve aplicar sobre a versão anterior
PREFIXO_BACKUP = "_v"  # _v1, _v2...: cada refazer guarda a versão que estava no ar
TENTATIVA_FALHA = "_tentativa-falha"
BACKUP_EM_CURSO: dict[str, str] = {}  # slug -> pasta _vN do refazer em andamento
# CONCEITO.md (metáfora, Atos e a tabela de movimento, passo 1.5.1) vai junto para o _vN: deixado na pasta,
# ancoraria o refazer na ideia que ele deve trocar.
ARQUIVOS_DO_SITE = ("index.html", "og.jpg", "publicado.json", "DESIGN.md", "CONCEITO.md", "raio-x.html")
SITE_LEADS = Path(os.environ.get("SITE_LEADS", str(Path.home() / ".local/share/n8n-estado/site-leads.json")))
# Raio-X do PRUMO (08/10/2026, deploy/dell/raio-x.py): depois de cada demo validado, o runner
# publica `/raio-x` no mesmo projeto. O deploy do Claude só leva index.html e og.jpg, então um
# refazer apaga o Raio-X do ar e este gancho o devolve. Sem o binário, o demo segue sem ele.
RAIO_X = Path(os.environ.get("RAIO_X_BIN", str(Path.home() / ".local/bin/raio-x")))
# QA com menos imagens (11/10/2026): nos 97 leads premium de 08-10/10 o Claude leu, em média, 44
# capturas por lead (em 18 chamadas ao modelo, cada uma relendo ~300 mil tokens de contexto). A
# folha de contato junta as capturas de uma rodada numa imagem só; o gate numérico mede antes do
# deploy o que não precisa de olho (bytes, CLS, alt, contraste, reduced-motion, Ato I sem JS) e
# tira ele mesmo as duas capturas do Ato I. As instruções só os citam se estiverem instalados:
# o gerador novo com as cópias antigas segue o QA de antes, sem quebrar o lead.
FOLHA_DE_CONTATO = Path(os.environ.get("FOLHA_DE_CONTATO_BIN", str(Path.home() / ".local/bin/folha-de-contato")))
QA_NUMERICO = Path(os.environ.get("QA_NUMERICO_BIN", str(Path.home() / ".local/bin/qa-numerico")))


def ferramentas_de_qa() -> bool:
    return FOLHA_DE_CONTATO.is_file() and QA_NUMERICO.is_file()


def pasta_de_capturas(rascunho: Path) -> Path:
    return rascunho / "qa"
PROMPT_PERSONALIZADO = (
    "/lead-novo {slug} no MODO PERSONALIZADO descrito nas instruções da execução (dossiê, conceito autoral, "
    "redação própria e revisão crítica antes de publicar), na direção de metáfora e Atos do passo 1.5.1 do CLAUDE.md, "
    "usando as fotos e recursos extras; "
    "cumpra o passo 1.6.1: selecione uma referencia em styles.refero.design, copie o DESIGN.md para a pasta do lead "
    "e registre a referencia"
)
# Frases que cabem em qualquer negócio do ramo: a revisão crítica as caça.
CLICHES = ("qualidade e compromisso", "excelência", "soluções completas", "a melhor opção", "venha nos conhecer",
           "tradição e inovação", "profissionais qualificados", "atendimento personalizado", "referência em",
           "sua satisfação é nossa prioridade", "cuidado que você merece", "compromisso com você", "há anos no mercado",
           "o melhor custo-benefício", "equipe experiente", "tecnologia de ponta", "confiança e segurança")

# Lista de permissão do Claude headless. Saiu das transcrições dos leads de
# 24-30/09/2026 (~/.claude/projects/-home-romulo-sutil-corr-a-auto-site/): o
# /lead-novo processa imagem e fonte em python3, tira captura no Chrome
# headless, confere domínio com curl, lê Instagram/Refero/site do negócio e
# publica com o vercel. Programas liberados com qualquer argumento; os comandos de
# arquivo (mkdir, cp, mv, sed...) o próprio Claude Code só aceita dentro de
# ~/auto-site e do rascunho do lead.
PROGRAMAS_LIVRES = (
    # "chrome" não existe no Dell, mas o CLAUDE.md usa esse nome: negado, o Claude
    # concluiu (lead de teste de 30/09) que o Chrome todo estava proibido e
    # publicou sem captura nenhuma; liberado, ele recebe "command not found" e
    # passa para o google-chrome.
    "python3", "node", "google-chrome", "chrome", "chromium", "/snap/bin/chromium", "pyftsubset", "fonttools", "curl",
    "mkdir", "cp", "mv", "touch", "sed", "tee", "date", "sleep", "base64", "file", "xxd", "md5sum", "sort", "uniq",
    "cut", "awk", "tr", "od", "basename", "dirname", "realpath", "printf", "fc-list", "unzip", "getent", "host",
    "nslookup", "dig",
)
PROGRAMAS_NEGADOS = (
    "git", "sudo", "su", "ssh", "scp", "rsync", "wget", "systemctl", "crontab", "pip", "pip3", "npm", "npx",
    "chmod", "chown", "python3 -m pip",
)
# curl só para ler (GET, código HTTP, baixar fonte no rascunho): nada que envie dados.
CURL_QUE_ENVIA = ("-d", "--data", "-F", "--form", "-T", "--upload-file", "-X", "--request", "--json", "-K", "--config")
# Nem rm nem mv tocam nestes, em lugar nenhum da pasta.
PROTEGIDOS = ("registro.md", "CLAUDE.md", "content.md", "publicado.json", ".claude", ".logs",
              "_recusados", "_concluidos", "_em-conversa")
# Redundante de propósito: fora da pasta o Claude já não lê nada sem regra, mas
# estes ficam negados mesmo que alguém abra a leitura depois.
SEGREDOS = (".ssh/**", ".config/**", ".hermes/**", "SquadOne/**", ".claude.json", ".claude/.credentials.json",
            ".local/share/com.vercel.cli/**", ".gnupg/**", "Pessoal-dev/**", "Corporativo-dev/**")


def palco_do_deploy(slug: str, rascunho: Path) -> Path:
    # O mesmo "${TMPDIR:-/tmp}/esteira-deploy/demo-<slug>" do passo 5 do CLAUDE.md.
    return rascunho / "esteira-deploy" / f"demo-{slug}"


def permissoes_do_claude(slug: str, rascunho: Path) -> dict:
    """Settings (`--settings`) de um lead: escreve só na pasta dele, no registro.md,
    em `_build/` e no rascunho; rm só na pasta dele e no rascunho; vercel só no
    projeto demo-<slug>, a partir do palco. Caminho absoluto em regra = `//caminho`."""
    lead, palco, home = AUTO / slug, palco_do_deploy(slug, rascunho), Path.home()
    allow = [f"Bash({p})" for p in PROGRAMAS_LIVRES] + [f"Bash({p} *)" for p in PROGRAMAS_LIVRES]
    for alvo in (str(rascunho), str(lead), slug):
        allow += [f"Bash(rm {opcao}{alvo}/*)" for opcao in ("", "-f ", "-r ", "-rf ")]
    allow += [f"Bash(pkill -f *{p}*)" for p in ("chrom", "headless", "remote-debugging")]
    allow += [
        f"Bash({home}/.claude/skills/impeccable/scripts/impeccable *)",
        "Bash(~/.claude/skills/impeccable/scripts/impeccable *)",
        "Bash(vercel whoami)", "Bash(vercel --version)",
        f"Bash(vercel link --cwd {palco} --yes --project demo-{slug} --scope {VERCEL_SCOPE})",
        f"Bash(vercel deploy --cwd {palco} --prod --yes --scope {VERCEL_SCOPE})",
    ]
    for alvo in (f"{lead}/**", f"{AUTO}/registro.md", f"{AUTO}/_build/**", f"{rascunho}/**"):
        allow += [f"Edit(/{alvo})", f"Write(/{alvo})"]
    allow += [f"Read(/{home}/.claude/skills/**)", "WebFetch", "WebSearch", "Skill"]

    deny = [f"Bash({p} *)" for p in PROGRAMAS_NEGADOS]
    for opcao in CURL_QUE_ENVIA:
        deny += [f"Bash(curl {opcao}*)", f"Bash(curl * {opcao}*)"]
    deny += ["Bash(curl *file:*)", "Bash(curl * -o ~*)", "Bash(curl * -o /home/*)", "Bash(curl * --output*)"]
    for nome in PROTEGIDOS:
        deny += [f"Bash(rm *{nome}*)", f"Bash(mv *{nome}*)"]
    deny.append("Bash(rm *_descartados*)")  # mover o lead para lá pode (regra do CLAUDE.md); apagar, não
    for alvo in (f"{AUTO}/CLAUDE.md", f"{AUTO}/.claude/**", f"{AUTO}/.logs/**", f"{home}/.claude/**"):
        deny += [f"Edit(/{alvo})", f"Write(/{alvo})"]
    deny += [f"Read(/{home}/{p})" for p in SEGREDOS]
    deny.append("mcp__*")
    return {"permissions": {"allow": allow, "deny": deny, "additionalDirectories": [str(rascunho)]}}


def instrucoes_da_execucao(slug: str, rascunho: Path) -> str:
    """Vai no --append-system-prompt: sem isto o Claude gasta turnos batendo nas
    negações (o roteiro de deploy do CLAUDE.md usa variável de shell, que o
    Claude Code nega em caminho)."""
    lead, palco, qa = AUTO / slug, palco_do_deploy(slug, rascunho), pasta_de_capturas(rascunho)
    if ferramentas_de_qa():
        conferencias = f"""- Direção de metáfora e Atos (passo 1.5.1 do CLAUDE.md): grave {lead}/CONCEITO.md antes do `/design`. O Ato I é a primeira `<section>` dentro de `<main>`: é até o fim dela que se mede o orçamento.
- QA com UMA imagem por rodada. Grave as capturas em {qa}/ (mkdir -p {qa} numa chamada só), com nome `<viewport>-ato<N>[-<modo>].png`: viewport `d` (--window-size=1440,900) ou `m` (390,844); modo `rm` (--force-prefers-reduced-motion), `p0.3` (progresso da narrativa); ex.: {qa}/m-ato3-p0.3.png. A cada rodada regrave com os mesmos nomes. Não leia as capturas uma a uma: junte-as com `python3 {FOLHA_DE_CONTATO} --saida {qa}/folha-N.jpg --pasta {qa}` (N = rodada; ele imprime a legenda #1, #2... com Ato, viewport, modo e escala) e leia (Read) só a folha. Abra uma captura isolada apenas se a folha não deixar julgar um defeito concreto, no máximo uma por rodada.
- Gate antes do deploy: `python3 {QA_NUMERICO} {lead}/index.html --capturas {qa}`. Ele mede o orçamento das "Regras do arquivo" (fim do Ato I, total, CSS e JS sem base64, fontes, fotos), width/height e alt das imagens, prefers-reduced-motion no CSS e no JS, contraste AA dos pares cor/fundo do CSS e o Ato I visível sem JS e com reduced-motion; essas duas capturas ele mesmo tira do index.html de agora (m-ato1-semjs.png de uma cópia sem <script>: o `--blink-settings=scriptEnabled=false` não grava captura neste Chrome, não tente). Código 1 = falhou e cada FALHA diz o que cortar: corrija e rode o mesmo comando até sair 0 (não escreva um script de bytes seu). Só então og:image e deploy. Se o próprio gate quebrar (código 2 ou traceback), diga no resumo final e confira à mão: bytes com um script no rascunho e o Ato I numa cópia sem <script>."""
    else:
        conferencias = f"""- Direção de metáfora e Atos (passo 1.5.1 do CLAUDE.md): grave {lead}/CONCEITO.md antes do `/design`. Antes do deploy, duas conferências: (a) grave no rascunho um script python3 que lê {lead}/index.html e imprime os bytes do começo do arquivo até o fim do Ato I, o total, o CSS e o JS sem base64, as fontes e cada imagem embutida, e falha acima do orçamento das "Regras do arquivo"; corte até passar. (b) Além das capturas normais, uma a 390x844 com `--force-prefers-reduced-motion` e outra com `--blink-settings=scriptEnabled=false` (sem JS): o Ato I tem de estar visível nas duas, e o `--dump-dom` com reduced-motion não pode ter conteúdo escondido esperando animação."""
    return f"""Execução automática do gerador de sites no Dell, com lista de permissão (modo dontAsk): o que não está na lista é negado na hora, sem pergunta. Não repita um comando negado; siga pelo caminho permitido.
- A lista não muda o processo do CLAUDE.md nem a barra de qualidade: rode as cinco skills na ordem, embuta fontes (baixe com curl para o rascunho e faça o subset com pyftsubset) e faça o QA com capturas de desktop e celular no Chrome headless, como nos leads anteriores. O Chrome daqui é `google-chrome` (ou /snap/bin/chromium); `chrome` não existe.
{conferencias}
- Escreva só em {lead}/, {AUTO}/registro.md, {AUTO}/_build/ e no rascunho {rascunho} (é o $TMPDIR: capturas, fontes, imagens e scripts temporários, palco do deploy). CLAUDE.md, .claude/ e .logs/ são só leitura.
- No Bash, escreva caminhos literais: variável de shell em caminho ("$stage", "${{TMPDIR:-/tmp}}") e laço for/while com variável são negados. Python de mais de uma linha: grave o script no rascunho (Write) e rode `python3 <arquivo>`; heredoc (`python3 - <<EOF`) e `python3 -c` de várias linhas costumam ser negados. Pasta nova: mkdir -p numa chamada só dele, e só na chamada seguinte use a pasta (cd, > arquivo).
- Descartar o lead (regras do CLAUDE.md: o negócio já tem site no ar, é rede/franquia com site, é duplicado ou já tem linha "— (não publicado)" no registro.md): não mova a pasta, mover para _descartados/ está fora da lista. Grave {lead}/{SINAL_DESCARTE} com o motivo (primeira linha: o motivo numa frase; depois as evidências: URLs testadas e o que o curl ou o DOM renderizado mostrou), anote a linha "— (não publicado)" no registro.md e termine sem index.html e sem publicado.json. O runner move a pasta para _descartados/ e conta como descarte, não como falha. Onde o CLAUDE.md manda mover para _descartados/, grave o {SINAL_DESCARTE}. Não grave {SINAL_DESCARTE} no caso "presença digital fraca ou nula" (lá o CLAUDE.md manda parar e devolver ao Rômulo, sem descartar).
- rm só dentro de {lead}/ e do rascunho. Negados: git, sudo, ssh, wget, pip/npm/npx, chmod, curl que envia dados (-d, -F, -T, -X) ou grava em ~/.
- Para pesquisar (Instagram, Refero, site do negócio) use WebFetch/WebSearch, curl ou o google-chrome headless (--dump-dom).
- Prévia do link no WhatsApp: o Rômulo manda só o link, e o WhatsApp mostra o cartão de prévia (og:*) antes de o dono abrir o site. Sem og:image o cartão sai sem foto. Antes do passo 5: (a) gere {lead}/{IMAGEM_DA_PREVIA} com python3/PIL a partir da melhor foto real do negócio (a do hero), 1200x630, recorte centrado, JPEG qualidade ~80, menos de 300 KB; (b) no <head> do index.html ponha og:type website, og:locale (pt_BR no Brasil), og:title (nome do negócio + cidade), og:description (a promessa do hero, até 150 caracteres), og:image https://demo-{slug}.vercel.app/{IMAGEM_DA_PREVIA} com og:image:width 1200 e og:image:height 630, twitter:card summary_large_image, e um favicon SVG inline (data: URI com a inicial ou o símbolo da marca, na cor da marca). Só foto do próprio negócio (nunca a ilustrativa do Unsplash nem imagem de paciente); sem foto real, não gere a imagem nem o og:image e pule o cp dela. Se a linha "Aliased:" der outra URL, corrija o og:image para ela e publique de novo.
- Passo 5 (publicar): em vez do roteiro com variáveis do CLAUDE.md, rode exatamente estes comandos, um por chamada (outra forma de vercel é negada); além do index.html, sobe só a {IMAGEM_DA_PREVIA}:
  mkdir -p {palco}
  cp {lead}/index.html {palco}/
  cp {lead}/{IMAGEM_DA_PREVIA} {palco}/
  vercel link --cwd {palco} --yes --project demo-{slug} --scope {VERCEL_SCOPE}
  vercel deploy --cwd {palco} --prod --yes --scope {VERCEL_SCOPE}
  Depois siga o CLAUDE.md: URL da linha "Aliased:", curl dando 200, publicado.json, registro.md. Se o deploy falhar, deixe o index.html completo sem publicado.json: o runner publica.
- No resumo final, diga se alguma negação fez falta ao site."""


def instrucoes_personalizado(slug: str, backup: str | None = None) -> str:
    """Segundo bloco do --append-system-prompt no modo personalizado. Vem DEPOIS de
    `instrucoes_da_execucao` e do CLAUDE.md: soma etapas, não troca nenhuma regra.
    `backup` = pasta `_vN/` do site anterior (refazer); None = lead novo."""
    lead = AUTO / slug
    cliches = "; ".join(f"\"{c}\"" for c in CLICHES)
    verificacao = (" As capturas seguem os nomes das instruções da execução e são lidas numa folha de contato só "
                   "(uma imagem por rodada), e o gate numérico roda antes do deploy." if ferramentas_de_qa() else "")
    if backup:
        abertura = (f"- Isto é um REFAZER. O site anterior deste lead está em {lead}/{backup}/ (index.html, og.jpg, DESIGN.md, CONCEITO.md se houver; pode haver outras "
                    f"versões em {lead}/_v*/). Leia-o uma vez só para saber o que NÃO repetir: outra paleta, outro estilo, outra instância da metáfora "
                    "(a família do nicho, do passo 1.5.1, pode ficar; a cena, a navegação e a forma de cada Ato mudam), "
                    "outro texto e outro movimento. Não copie nada dele. O `registro.md` já tem a linha do site anterior: isto é retrabalho pedido, a regra "
                    "contra retrabalho não vale aqui; acrescente uma linha nova marcada \"Refeito (personalizado)\". Neste modo NÃO grave "
                    f"{SINAL_DESCARTE}: o lead já passou pela triagem; faça o site.")
    else:
        abertura = ("- Este é um lead novo, feito já no modo personalizado: a triagem do CLAUDE.md (premissa \"sem site\", duplicado, rede) continua valendo e "
                    f"o descarte segue pelo {SINAL_DESCARTE}. Passou na triagem, faça as etapas abaixo.")
    return f"""MODO PERSONALIZADO (pedido do Rômulo, 07/10/2026). Contexto: uma escola, ao ver o demo que fizemos, respondeu que o trabalho não parecia feito para ela. Um site que serviria a qualquer concorrente do ramo é o defeito a eliminar. O que sai daqui será enviado a um dono real: ele precisa se reconhecer na página.
{abertura}
- Faça as etapas A a F, nesta ordem, ANTES do `/design` e do código (as cinco skills continuam rodando, e o resto do CLAUDE.md vale):
  A. DOSSIÊ. Grave {lead}/DOSSIE.md (uma página, em português) com o que você achou sobre ESTE negócio: quem é o dono ou os sócios (pelo nome, só se publicado), como e quando começou, bairro e cidade (o que o cliente daquela região vive e procura), o que os clientes realmente elogiam (3 trechos curtos e literais das avaliações do `content.md`, entre aspas), o vocabulário do próprio negócio (5 expressões que ele mesmo usa no Instagram, Facebook, Google ou site antigo), o que ele faz e o concorrente local não mostra, e o que se sabe da identidade visual real (logo, cores, fotos próprias). Fontes: `content.md`, as imagens de `Fotos/` e `Logotipo/`, perfil de Instagram e Facebook se existirem, e WebSearch pelo nome + cidade (ache o que o Google Places não tem: matérias, CNPJ/data de abertura, site antigo, redes). Cada afirmação do dossiê leva a fonte entre parênteses. O que não achar vira a linha "Lacuna: ..." — nunca preenchimento, nunca invenção.
  B. CONCEITO AUTORAL. Em {lead}/DOSSIE.md, uma seção "Conceito": uma ideia central em UMA frase que só serve a este negócio. Teste obrigatório: troque o nome por o de outro negócio do mesmo ramo e cidade; se a frase continuar verdadeira, ela é genérica, descarte e refaça. O conceito é a INSTÂNCIA da metáfora do passo 1.5.1 do CLAUDE.md (a família vem do nicho, a instância vem deste dossiê) e a ESTRUTURA são os cinco Atos de lá, as perguntas do visitante na ordem em que ele as tem: o conceito dá o nome, a cena e a forma de cada Ato e desenha a navegação. Não volte ao esquema "hero, serviços, depoimentos, contato". Um Ato pode ser curto, nenhum falta; nunca mais genérico. Passe a metáfora, os Atos e a tabela de movimento para {lead}/CONCEITO.md.
  C. REDAÇÃO AUTORAL. Escreva você mesmo cada título, subtítulo, botão e microtexto na voz deste negócio, com especificidade: nomes, lugares, números verificáveis, momentos do atendimento, palavras do dossiê. Cada seção tem pelo menos uma frase que só caberia neste negócio. Proibido texto de gaveta: {cliches}, e qualquer variação. Nada inventado (número de anos, prêmio, equipe, certificação, cliente): só o que o dossiê prova. O hero abre com a ideia do conceito, não com o nome do serviço.
  D. IDENTIDADE E ASSINATURA. Cor, tipografia e o "momento de assinatura" do CLAUDE.md saem do dossiê (identidade real do negócio, do bairro, do ofício), não de um repertório fixo. Use as fotos reais onde elas provam algo e diga na legenda o que mostram.
  E. MOVIMENTO DE NÍVEL ESPECIALISTA (pedido do Rômulo: todo site sai com movimento e com JavaScript de animação em nível especialista, sempre ligado ao conceito, nunca efeito solto). Antes de codar, rode as skills `animate` (leia ~/.claude/skills/animate/RECIPES.md), `animation-vocabulary` e `find-animation-opportunities`; ao final, `review-animations` e `improve-animations`. Código autoral em JS vanilla dentro do index.html (sem CDN nem biblioteca):
    - VOCABULÁRIO: o da seção 2.1 da "Barra de excelência" do CLAUDE.md (esticamento por velocidade, paralaxe 3D real, transição líquida entre Atos, magnetismo, tipografia com máscara, levitação de estado, inércia e lag elástico), com as doses e os tetos de lá. Cada efeito tem linha na tabela "efeito → Ato → o que significa" do CONCEITO.md; sem linha, não entra. A metáfora vive na página inteira (navegação, transições, sequência do Ato III), não num brinquedo isolado: quem não interagir com nada entende o negócio só rolando.
    - MOTOR próprio: um único loop `requestAnimationFrame`, valores suavizados por lerp/amortecimento, molas (rigidez e amortecimento) e curvas cubic-bezier nomeadas; o scroll nativo nunca é sequestrado. Anime só `transform`, `opacity`, `clip-path` e filtros leves, nunca propriedades de layout; leia o layout num lote e escreva noutro (sem layout thrash); listeners `passive`; `IntersectionObserver` liga e desliga o que está fora da tela; `ResizeObserver` recalcula; tudo pausa com a aba oculta.
    - NARRATIVA GUIADA PELO SCROLL: pelo menos UMA sequência cujo progresso 0-1 é o scroll da seção (seção "pinned" por `position: sticky`, não por JS), por exemplo um desenho SVG que se traça (`stroke-dashoffset` com `getTotalLength`), um objeto que se transforma, um percurso ou mapa que avança, peças que se montam em ordem.
    - ENTRADA COREOGRAFADA: timeline do hero com orquestração (stagger com easing, revelação por máscara ou `clip-path`, texto dividido em linhas, palavras ou letras mantendo a acessibilidade com `aria-label` no pai e `aria-hidden` nas partes, contadores).
    - PELO MENOS DUAS INTERAÇÕES AUTORAIS ligadas ao conceito (botão magnético com mola, elemento que segue o ponteiro com inércia, arrastar com física, seletor que reorganiza a página com FLIP: medir primeiro, medir último, inverter e tocar; tilt 3D; parallax por camadas). Use Pointer Events: em toque tem de funcionar por gesto, nunca depender de hover. O que segue o cursor (magnetismo, tilt, inércia de ponteiro) só liga com `matchMedia('(hover: hover) and (pointer: fine)')`. Nenhuma interação é condição para entender o negócio ou chegar ao WhatsApp.
    - Acabamento: estados de foco, pressionado e carregando com a mesma linguagem de mola; transições de estado coerentes.
    - Desempenho e acessibilidade: 60 fps em celular médio; nada de trabalho pesado por frame; `will-change` só durante a animação. `prefers-reduced-motion: reduce` desliga o decorativo mas mantém conteúdo e função (a narrativa vira estática e legível); tudo que é interativo tem foco por teclado; nada que pisque. Sem JavaScript ativo, o conteúdo inteiro continua visível.
    - Advocacia: o mesmo nível técnico, em tom contido e elegante (OAB sóbria): movimento que revela e organiza, sem exibição.
    - Verificação: coloque um `window.onerror` temporário que escreve num elemento e leia com `--dump-dom`; tire capturas em 4 posições de scroll no desktop e no celular; confira o estado final com reduced-motion.{verificacao}
  F. REVISÃO CRÍTICA, depois do HTML pronto e antes do QA e do deploy. Releia a página inteira como se fosse o dono. Grave {lead}/REVISAO.md com: (1) três coisas que ele reconheceria como dele, citando o trecho; (2) cada frase que serviria a qualquer concorrente (procure os clichês acima e as promessas vagas) e a versão reescrita, JÁ aplicada no index.html; (3) o que o conceito prometeu e a página entregou ou não; (4) "Movimento": a tabela do CONCEITO.md conferida contra o código (efeito que sobrou sem significado sai do index.html) e o que cai com reduced-motion; (5) "Confiança": cada afirmação de experiência com a fonte, e nenhuma frase de medo, desconfiança ou urgência artificial. Se menos de três coisas forem dele, volte à etapa A com mais pesquisa. Só então QA, og:image, deploy e registro.
- Advocacia: o Provimento 205/2021 da OAB continua valendo (sem avaliações na página, sem promessa de resultado, sem preço, sem superlativo, sem captação). A personalização vem do que é público e permitido: como é o primeiro atendimento, as áreas explicadas pelo que o cliente daquela cidade enfrenta, o fórum e a comarca, a linguagem do próprio advogado em artigos e posts.
- Tempo: este modo pode usar até o dobro do tempo de um lead comum. Gaste-o na pesquisa e na redação, não em efeitos.
- No resumo final, diga qual foi o conceito e qual frase do site mais prova que ele foi feito para este negócio."""


def instrucoes_premium(slug: str, rascunho: Path, nota: str | None = None) -> str:
    """Terceiro bloco (modo `--premium`, 08/10/2026). O Rômulo reprovou o primeiro site com movimento
    (turbo): "muito fraco e MUITO distante do refero.design/web-apps". O diagnóstico: uma passada só,
    fotos de celular como único material, referência de estilo sem relação com o negócio, e ninguém
    olhando o resultado renderizado. Aqui o Claude aprende com o Refero INTEIRO a cada lead, constrói,
    olha as próprias capturas ao lado das referências e reescreve, três vezes."""
    lead = AUTO / slug
    refs = rascunho / "refs"
    qa = rascunho / "qa"
    caderno = AUTO / "_build" / "aprendizados-refero.md"
    texto = f"""MODO PREMIUM (pedido do Rômulo, 08/10/2026). O padrão de qualidade é o refero.design/web-apps: produtos reais de estúdios grandes, com direção de arte, imagem rica, tipografia e ritmo de produção. "Correto" e "criativo" não bastam: o site precisa parecer feito por um estúdio caro. A exigência é a mesma para uma desentupidora e para um escritório de advocacia; muda o mundo visual, não o nível. Estas etapas SOMAM às do modo personalizado, e a etapa R vem antes do `/design`:
  R. APRENDER COM O REFERO, a cada lead (o exemplo são todos os exemplos). 1) Leia {caderno} se existir: são os princípios que os leads anteriores já extraíram; não repita o que ele já mostra. 2) Rode `python3 /home/romulo-sutil-corr-a/.local/bin/refero-aprender --saida {refs} --consulta "<termo em inglês do setor>" --consulta "<outro termo>" --consulta "<estilo desejado>" --max 30` com 3 a 5 consultas em inglês: o setor do negócio (ex.: "plumber", "law firm", "construction", "equipment rental"), o tipo de serviço (ex.: "local service", "emergency service", "consultancy"), e o ESTILO que o conceito pede (ex.: "editorial", "technical diagram", "dark product", "warm brand"). Sem resultado, tente outras consultas até ter pelo menos 15 imagens. 3) Leia (Read) TODAS as imagens da pasta, uma a uma, e olhe de verdade: grade, escala e contraste da tipografia, o que é imagem e o que é texto, como o hero usa a imagem, densidade, cor, profundidade, acabamento dos componentes. 4) Escolha as 6 mais úteis ao mundo visual deste negócio (não as mais bonitas em geral) e grave {lead}/REFERENCIAS.md: para cada uma, o site, o que ela faz que o seu rascunho de conceito não faz, e UMA decisão concreta que você vai tomar por causa dela (nunca "usar o estilo dela": copiar layout, texto ou marca de terceiros é proibido; aprenda o princípio). Termine com "Princípios deste lead": 5 linhas que valem para qualquer site futuro. 5) O `DESIGN.md` do passo 1.6.1 do CLAUDE.md deve vir de uma referência do MESMO MUNDO do negócio; um estilo de outro mundo (ex.: monografia industrial para um serviço de bairro) é erro.
  G. IMAGEM E MATERIAL, o que mais separa um site de estúdio do nosso. As fotos do Google Places são de celular e pequenas: nunca as use grandes nem cruas. Use-as como PROVA (pequenas, tratadas: recorte intencional, duotone ou grão, moldura, legenda que diz o que mostram). O visual principal tem de ser FEITO POR VOCÊ, em código, com produção: ilustração e cena em SVG com gradientes, luz, sombra projetada, textura (feTurbulence para grão e papel, feDisplacementMap, máscaras), CSS 3D (perspective, transform-style, camadas em profundidade), canvas 2D ou WebGL simples quando o conceito pedir. Proibido: bloco cinza liso, caixa vazia, ícone de biblioteca no lugar de imagem, hero só com texto e cor. Cada seção tem um objeto visual com volume, material e luz. Tipografia: par de fontes com função clara (embutidas e subsetadas, regra do CLAUDE.md), escala modular, entrelinha e tracking ajustados por tamanho, números tabulares onde há número; um sistema de espaçamento de 8 px; no máximo 3 cores mais neutros, com uma cor de acento usada com disciplina.
  K. CONCEITO COMO SISTEMA (feedback do Rômulo sobre o turbo: "ainda não está bem conceitual"). A ideia central não é um tema nem um hero bonito: é a regra que decide TUDO. Complete o {lead}/CONCEITO.md do passo 1.5.1 do CLAUDE.md com: a ideia em uma frase; a METÁFORA VISUAL única que a carrega (a família do nicho e a instância deste lead: um objeto, um mapa, um instrumento, um documento, um percurso); e a tabela "como a ideia aparece em": estrutura da página (os cinco Atos, nomeados e ordenados pela metáfora: a ordem É a ideia), navegação (o índice dos Atos é a metáfora), cada interação (o gesto do visitante é a ideia acontecendo), a microcopy (o vocabulário vem da ideia), o movimento (o que se move e por quê), a cor e a tipografia (a ideia decide o material). Teste obrigatório: tire a ideia e a página deixa de fazer sentido? Se ela continua funcionando como um template com outro tema, o conceito é decoração: refaça. Cada seção responde a uma pergunta que o visitante realmente tem, na ordem em que ele a tem.
  U. UX E UI DE PRODUTO (feedback do Rômulo: "mais UX e mais UI"). REGRA ZERO: nada inventado. Nenhuma interação, categoria, convenção ou vocabulário pode depender de o visitante saber algo que só você sabe (aconteceu: "Qual é a sua C?" supunha que todo visitante diz a rua pelo código do bairro; quem digitou o endereço normal não teve resposta). Toda interação nasce de uma ENTRADA QUE O VISITANTE REALMENTE TEM (o endereço como todo mundo escreve, o nome do problema com as palavras dele, o horário em que precisa) e de DADO REAL com fonte; se você não tem a base para responder, não finja: aceite o que ele digitar e leve-o ao WhatsApp com o texto pronto. UX: 1) Para cada tela e componente, desenhe e implemente TODOS os estados: vazio, digitando, validando, erro, sucesso, carregando e "não sei responder"; erro diz o que fazer, nunca culpa o visitante. 2) Um formulário tem rótulo visível, exemplo real no placeholder, ajuda em uma linha, validação em linha, `autocomplete`/`inputmode`/`enterkeyhint` certos, alvo de toque de 44 px, foco visível e Enter envia. 3) Uma ação primária por tela, hierarquia pelo tamanho e peso, texto de botão que diz o resultado ("Chamar no WhatsApp com meu endereço"). 4) Mobile primeiro: tudo dentro de 390 px sem rolagem lateral, polegar alcança a ação, teclado do celular não cobre o campo. 5) O caminho até o contato nunca passa por mais de dois toques a partir de qualquer ponto da página. UI: 6) Um sistema de componentes: botão, campo, chip, cartão, rótulo e legenda com o mesmo raio, altura, borda, sombra, ritmo e estados (repouso, hover, foco, pressionado, desabilitado), definidos uma vez em variáveis CSS e reutilizados; um conjunto de ícones SVG único, desenhado por você, com o mesmo traço. 7) Escala tipográfica com no máximo 6 tamanhos, grade de 8 px, alinhamento rigoroso, contraste mínimo de 4,5:1 e margens generosas; nenhum componente espremido nem texto solto sem função. 8) TESTE DE ENTRADAS REAIS: implemente `?qa=teste`, que preenche cada formulário e interação com pelo menos 5 entradas realistas, incluindo as erradas e as que você não sabe responder (ex.: "Rua Horácio Santana 342", "rua x", vazio, só número, com acento e maiúsculas), e escreve o resultado de cada uma em `<pre id="qa-resultado">`; leia com `google-chrome --headless=new --no-sandbox --disable-gpu --virtual-time-budget=8000 --dump-dom "file://{lead}/index.html?qa=teste"` e registre a tabela entrada → resposta na CRITICA. Qualquer entrada realista sem resposta útil é defeito que bloqueia o deploy.
  V. LAÇO DE CRÍTICA VISUAL, três rodadas depois do HTML funcionando e antes do deploy. Em cada rodada: 1) o index.html aceita o parâmetro `?qa=1` (e `&p=0.0 a 1.0` para fixar o progresso da seção narrativa): com ele as entradas terminam na hora, o scroll narrativo fica no progresso pedido e nada espera tempo ou ponteiro; o Chrome headless do Dell não roda animação por tempo, então sem isso a captura sai vazia (já aconteceu). 2) Tire capturas no Chrome headless: `google-chrome --headless=new --no-sandbox --disable-gpu --hide-scrollbars --virtual-time-budget=8000 --window-size=1440,900 --screenshot={qa}/d1.png "file://{lead}/index.html?qa=1&p=0.3"` (mkdir -p {qa} antes), em pelo menos 5 posições e estados (hero, narrativa em 0.3 e 0.8, uma seção intermediária, o fecho) no desktop 1440x900 e no celular 390x844, salvas em {qa}/, mais o Ato I e a sequência do Ato III a 390x844 com `--force-prefers-reduced-motion` e sem `?qa` (é o que o dono de celular com movimento reduzido vê). 3) Leia (Read) as capturas LADO A LADO com 4 imagens da pasta {refs} que você escolheu e escreva {lead}/CRITICA-N.md (N = rodada) com os 8 piores defeitos desta rodada, em ordem, cada um com a referência que o mostra e a correção que você vai fazer; seja cruel: pergunte "um estúdio entregaria isto?", "onde o olho entra e para?", "o que está vazio, chapado ou genérico?", "o texto é legível a 390 px?", "o movimento tem propósito?", "o conceito decide esta seção ou é decoração?", "o visitante saberia o que fazer sem explicação?", "algo aqui foi inventado sem base?". Depois, o CHECKLIST DOS ATOS, item por item, "sim" ou "não" com a captura que prova (um "não" entra nos defeitos da rodada): METÁFORA (1) dá para dizê-la em uma frase e ela vem do ofício, não de banco de imagem? (2) o índice e os nomes dos Atos são ela? (3) ela mostra cuidado e controle, nunca o problema? (4) trocar o nome por o de um concorrente da cidade deixaria algo falso? ATOS (5) no celular, em 3 s no Ato I: o que é, onde é e como chamar? (6) os cinco Atos estão na ordem das perguntas do visitante? (7) de qualquer ponto o WhatsApp está a até dois toques? (8) quem ignorar todos os efeitos entende tudo só rolando? MOVIMENTO (9) cada efeito tem linha no CONCEITO.md e nenhum sobra? (10) a sequência presa ao scroll conta a metáfora (capturas em p=0.3 e p=0.8)? (11) efeito de cursor só com pointer: fine, e o toque tem equivalente? (12) a captura com `--force-prefers-reduced-motion` está completa e legível? CONFIANÇA (13) toda afirmação de experiência (anos, nota, horário, marcas) tem fonte? (14) nenhuma frase de medo, desconfiança, urgência artificial ou deboche do ramo? (15) fotos reais tratadas e legendadas, nada proibido (paciente, criança, praga, sujeira)? (16) nada amador: alinhamento a 390 px, componentes coerentes, sem placeholder nem erro de texto? TÉCNICA (17) o script de bytes passa (fim do Ato I ≤ 200 KB, arquivo ≤ 450 KB, CSS ≤ 35 KB, JS ≤ 25 KB)? (18) título e foto do Ato I visíveis no primeiro quadro, sem esperar JS? (19) sem JS (`--blink-settings=scriptEnabled=false`), conteúdo e CTAs funcionam? (20) `window.onerror` vazio em todas as capturas? Inclua em cada CRITICA a tabela do `?qa=teste` (UX). 4) Aplique TODAS as correções no index.html. A rodada 3 só termina quando um estúdio entregaria a página: se ainda houver bloco chapado, imagem crua, hierarquia fraca ou algo que lembre template, faça uma 4ª rodada. Reduced-motion e teclado continuam obrigatórios; o parâmetro `?qa` pode ficar (inofensivo).
  W. APRENDIZADO PARA OS PRÓXIMOS. Ao final, leia {caderno} (se existir), acrescente uma seção "## {slug}" com os "Princípios deste lead" e os 3 defeitos que mais se repetiram nas suas críticas, e regrave o arquivo inteiro (Write) mantendo só as 40 seções mais recentes. Este caderno é o que faz o próximo lead começar melhor que este.
- Tempo: este modo pode usar até 3 horas. Gaste na referência, na imagem e nas rodadas de crítica; é aqui que a cota rende. No resumo final diga o que mudou da rodada 1 para a última e qual referência mais pesou.""" + (f"""
- REVISÃO DIRIGIDA (feedback do Rômulo sobre a versão anterior deste lead, que está em {lead}/{BACKUP_EM_CURSO.get(slug, '_v1')}/): NÃO comece do zero. Copie o index.html (e o CONCEITO.md, se houver) dessa pasta de volta para {lead}/ (cp) e parta dele: mantenha o que o feedback não condena, refaça por inteiro o que ele condena (um trecho condenado não se remenda: repense a ideia dele, com base real, e reimplemente), e rode U e V sobre a página toda. O feedback, nas palavras dele: "{nota}" """ if nota else "")
    if not ferramentas_de_qa():
        return texto
    # Laço V com a folha de contato e o gate (11/10/2026): cada rodada lia ~15 capturas e as 4
    # referências uma a uma. Agora é uma imagem por rodada; as referências já foram lidas na etapa R.
    for antes, depois in (
        (f"--screenshot={qa}/d1.png", f"--screenshot={qa}/d-ato3-p0.3.png"),
        (f"salvas em {qa}/, mais", f"salvas em {qa}/ com os nomes das instruções da execução (d-ato1.png, m-ato3-p0.8.png...), mais"),
        (f"3) Leia (Read) as capturas LADO A LADO com 4 imagens da pasta {refs} que você escolheu e escreva",
         f"3) Junte as capturas da rodada e as 4 imagens de {refs} que você escolheu numa folha: `python3 {FOLHA_DE_CONTATO} "
         f"--saida {qa}/folha-N.jpg --pasta {qa} --refs <os 4 arquivos de {refs}>`, e leia (Read) só ela: UMA imagem por "
         "rodada (as referências você já leu na etapa R; na folha elas ficam ao lado das capturas). Escreva"),
        ("(17) o script de bytes passa", f"(17) o gate `python3 {QA_NUMERICO} {lead}/index.html --capturas {qa}` sai 0"),
        ("(19) sem JS (`--blink-settings=scriptEnabled=false`)", "(19) sem JS (a m-ato1-semjs.png que o gate tira de uma cópia sem <script>)"),
    ):
        texto = texto.replace(antes, depois)
    return texto


def comando_do_claude(slug: str, rascunho: Path, personalizado: bool = False) -> list[str]:
    instrucoes = instrucoes_da_execucao(slug, rascunho)
    if personalizado:
        instrucoes += "\n\n" + instrucoes_personalizado(slug, BACKUP_EM_CURSO.get(slug))
        if MODO_PREMIUM:
            instrucoes += "\n\n" + instrucoes_premium(slug, rascunho, NOTA_DA_REVISAO)
    cmd = [
        "claude", "-p", (PROMPT_PERSONALIZADO if personalizado else PROMPT).format(slug=slug),
        "--permission-mode", "dontAsk",
        "--settings", json.dumps(permissoes_do_claude(slug, rascunho), ensure_ascii=False, separators=(",", ":")),
        "--append-system-prompt", instrucoes,
        "--strict-mcp-config",  # nenhum servidor MCP: o /lead-novo não usa
        "--output-format", "json",  # o resumo final traz as permission_denials
    ]
    # Modelo do design do site (GERADOR_MODELO no gerador.env). Ausente = o padrão
    # do Claude Code, como antes. O id completo (claude-opus-5-5) exige o CLI >= 2.1.280:
    # em 07/10/2026 o do Dell estava na 2.1.274 e devolvia 400 sem gerar nada, então um
    # id que o CLI não aceita derruba o lead inteiro — teste com `claude -p ok --model <id>`.
    modelo = os.environ.get("GERADOR_MODELO", "").strip()
    if modelo:
        cmd += ["--model", modelo]
    return cmd


def descrever_negacao(negacao: dict) -> str:
    entrada = negacao.get("tool_input") or {}
    alvo = next((entrada[k] for k in ("command", "file_path", "path", "url", "skill", "query") if entrada.get(k)), None)
    alvo = str(alvo) if alvo is not None else json.dumps(entrada, ensure_ascii=False)
    alvo = " ⏎ ".join(linha.strip() for linha in alvo.strip().splitlines())
    return f"{negacao.get('tool_name', '?')}: {alvo[:300]}{'…' if len(alvo) > 300 else ''}"


def registrar_saida_do_claude(bruto: str, log_lead: Path) -> int:
    """Grava no log do lead o resumo final do Claude e as permissões negadas.
    Devolve quantas foram negadas. Saída que não é JSON (erro antes de começar,
    limite de uso) vai crua, como antes."""
    resultado = None
    for linha in reversed(bruto.strip().splitlines()):
        if linha.startswith("{"):
            try:
                resultado = json.loads(linha)
                break
            except ValueError:
                pass
    with open(log_lead, "a", encoding="utf-8") as f:
        if not isinstance(resultado, dict):
            f.write(bruto if bruto.endswith("\n") or not bruto else bruto + "\n")
            return 0
        f.write(str(resultado.get("result") or "").rstrip() + "\n")
        if resultado.get("is_error"):
            f.write(f"Claude terminou com erro ({resultado.get('subtype')}).\n")
        f.write(f"Sessão do Claude: {resultado.get('session_id')} ({resultado.get('num_turns')} turnos); "
                "transcrição em ~/.claude/projects/-home-romulo-sutil-corr-a-auto-site/.\n")
        negadas = resultado.get("permission_denials") or []
        if not negadas:
            f.write("Permissões negadas: nenhuma.\n")
            return 0
        contagem = collections.Counter(descrever_negacao(n) for n in negadas if isinstance(n, dict))
        f.write(f"Permissões negadas: {len(negadas)}. Se alguma fez falta, ajuste permissoes_do_claude "
                "em deploy/dell/gerador-de-sites.py (ver README, \"Gerador de sites\").\n")
        for texto, vezes in contagem.most_common():
            f.write(f"[NEGADO] {texto}{f' (x{vezes})' if vezes > 1 else ''}\n")
        return len(negadas)


def agora() -> str:
    return dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def log(msg: str, nivel: str = "INFO", arquivo: Path | None = None) -> None:
    linha = f"[{agora()}] [{nivel}] {msg}"
    print(linha, flush=True)
    LOGS.mkdir(parents=True, exist_ok=True)
    for alvo in {LOG_FILA, arquivo} - {None}:
        with open(alvo, "a", encoding="utf-8") as f:
            f.write(linha + "\n")


# A lib de aviso (deploy/dell/lib/aviso.py, 11/10/2026): no repo, em lib/ ao
# lado deste arquivo; no Dell, instalada em ~/.local/lib/mel/ (instalados.json).
# Primeiro a do repo, para o teste nunca pegar uma cópia instalada.
FILA_AVISOS = Path.home() / ".local/share/avisos/fila"
PASTAS_DA_LIB = [Path(__file__).resolve().parent / "lib", Path.home() / ".local/lib/mel"]


def lib_de_aviso():
    """O módulo da lib, ou None quando nenhuma cópia existe ou carrega: aí o
    avisar() volta ao jeito antigo e o aviso sai do mesmo modo que antes."""
    for pasta in PASTAS_DA_LIB:
        arquivo = pasta / "aviso.py"
        if not arquivo.is_file():
            continue
        try:
            spec = importlib.util.spec_from_file_location("mel_aviso", arquivo)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return mod
        except Exception:  # noqa: BLE001 — cópia quebrada não derruba o gerador: tenta a próxima
            continue
    return None


def avisar(texto: str) -> None:
    """Aviso pelo WhatsApp: a fila que o dell-status repassa ao Hermes.

    Nunca levanta: o gerador roda sozinho pelo timer e um aviso que não saiu
    não pode derrubar a execução (nem um lead)."""
    aviso = {"titulo": "🌐 Gerador de sites", "texto": texto, "origem": "gerador-de-sites"}
    try:
        lib = lib_de_aviso()
        if lib is not None:
            # Valida, grava atômico, não cria a pasta da fila e dá um nome que
            # nunca colide (o antigo usava só os segundos). Texto interno: se
            # um dia trouxer "R$", sai com [valor] em vez de se perder.
            if lib.VALOR_EM_REAIS.search(texto):
                aviso["texto"] = lib.sem_valores(texto)
            r = lib.gravar(aviso, fila=FILA_AVISOS, prefixo="gerador")
            if not r.gravado:
                log(f"Aviso não gravado ({r.estado}): {r.motivo}", "ERRO")
            return
        # Sem a lib instalada: o jeito de antes, sem mudar nada.
        FILA_AVISOS.mkdir(parents=True, exist_ok=True)
        (FILA_AVISOS / f"gerador-{int(time.time())}.json").write_text(json.dumps(aviso, ensure_ascii=False), encoding="utf-8")
    except Exception as e:  # noqa: BLE001 — era só OSError; ver a docstring
        try:
            log(f"Aviso não gravado: {e}", "ERRO")
        except Exception:  # noqa: BLE001 — nem o log (pasta .logs) derruba a execução por causa do aviso
            pass


def gravar_status(estado: dict) -> None:
    # Informativo (a Central lê); nunca derruba a execução.
    try:
        tmp = STATUS.with_suffix(".tmp")
        tmp.write_text(json.dumps(estado, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(STATUS)
    except OSError:
        pass


def falhas_registradas(pasta: Path) -> int:
    try:
        texto = (pasta / "falha.log").read_text(encoding="utf-8", errors="replace")
    except OSError:
        return 0
    return sum(1 for linha in texto.splitlines() if linha.strip())


def place_id_do_lead(pasta: Path) -> str | None:
    try:
        conteudo = (pasta / "content.md").read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    m = re.search(r"(?i)place_id[:* \t]+([a-zA-Z0-9_-]+)", conteudo)
    return m.group(1).strip() if m else None


def nao_gerar() -> dict[str, str]:
    """place_id -> busca pausada, do retrato do funil. Sem arquivo ou ilegível: nada
    fica de fora (a fila de sempre), porque o funil é ajuda, não trava."""
    try:
        estado = json.loads(FUNIL.read_text(encoding="utf-8"))
        return {str(x["place_id"]): str(x.get("busca") or "busca pausada")
                for x in estado.get("nao_gerar") or [] if isinstance(x, dict) and x.get("place_id")}
    except (OSError, ValueError, AttributeError, TypeError):
        return {}


def fora_da_fila(pasta: Path, pausados: dict[str, str]) -> str | None:
    """Por que um lead pronto para gerar fica de fora; None = entra na fila."""
    if (pasta / SINAL_DESCARTE).is_file():
        return f"{SINAL_DESCARTE} (o runner move para _descartados/)"
    if falhas_registradas(pasta) >= MAX_FALHAS:
        return f"{MAX_FALHAS} falhas em falha.log"
    pid = place_id_do_lead(pasta) if pausados else None
    if pid and pid in pausados:
        return f"busca pausada: {pausados[pid]}"
    return None


def candidatos_da_fila() -> list[Path]:
    """Pastas da raiz com `content.md` e sem `publicado.json`, mais antiga primeiro."""
    leads = []
    for p in AUTO.iterdir():
        if not p.is_dir() or p.name.startswith((".", "_")):
            continue
        try:
            if not (p / "content.md").is_file() or (p / "publicado.json").exists():
                continue
            leads.append(((p / "content.md").stat().st_mtime, p.name, p))
        except OSError:
            continue  # a pasta mudou de lugar durante a listagem (o Claude move leads)
    return [p for _, _, p in sorted(leads)]


def fila() -> list[Path]:
    pausados = nao_gerar()
    return [p for p in candidatos_da_fila() if fora_da_fila(p, pausados) is None]


def paradeiro(pasta: Path) -> Path | None:
    """Onde foi parar um lead que saiu da raiz durante a geração: o runner (pelo
    `DESCARTAR.md`) ou o Claude movem duplicados e leads que já têm site para
    `_descartados/` (regras do CLAUDE.md da pasta). None = sumiu (renomeado ou apagado)."""
    candidatos = ([DESCARTADOS / pasta.name] + sorted(DESCARTADOS.glob(f"{pasta.name}--*"), reverse=True)
                  + sorted(AUTO.glob(f"_*/{pasta.name}")))
    return next((d for d in candidatos if d.is_dir()), None)


def motivo_do_descarte(pasta: Path) -> str:
    try:
        texto = (pasta / SINAL_DESCARTE).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return "sem motivo legível"
    linha = next((l.strip().lstrip("#").strip() for l in texto.splitlines() if l.strip()), "")
    return (linha[:200] + ("…" if len(linha) > 200 else "")) or "sem motivo escrito"


def descartar_pelo_sinal(pasta: Path, log_lead: Path) -> Path | None:
    """Move para `_descartados/` o lead em que o Claude gravou `DESCARTAR.md`.
    Nunca sobrescreve: o slug que já está lá (o n8n trouxe o lead de volta)
    ganha sufixo com a hora. None = não moveu (o lead fica fora da fila pelo
    sinal e a próxima execução tenta de novo)."""
    destino = DESCARTADOS / pasta.name
    if destino.exists():
        destino = DESCARTADOS / f"{pasta.name}--{dt.datetime.now().strftime('%Y%m%d-%H%M%S')}"
    try:
        DESCARTADOS.mkdir(exist_ok=True)
        pasta.rename(destino)
    except OSError as e:
        log(f"{pasta.name} pediu descarte ({SINAL_DESCARTE}), mas a pasta não foi movida: {e}. "
            "Fica fora da fila; a próxima execução tenta de novo.", "ERRO", log_lead)
        return None
    log(f"Descartado pelo Claude ({SINAL_DESCARTE}): {pasta.name} -> {destino.relative_to(AUTO)}/. "
        f"Motivo: {motivo_do_descarte(destino)}", arquivo=log_lead)
    return destino


def varrer_descartes() -> list[str]:
    """Pastas que ficaram na raiz com `DESCARTAR.md` (movimento que falhou, ou o
    Rômulo gravou o arquivo à mão): move antes de começar a fila."""
    movidos = []
    for p in candidatos_da_fila():
        if (p / SINAL_DESCARTE).is_file():
            destino = descartar_pelo_sinal(p, LOGS / f"execucao-{p.name}.log")
            if destino:
                movidos.append(f"{p.name} → {destino.parent.name}")
    return movidos


def html_completo(caminho: Path) -> bool:
    if not caminho.is_file():
        return False
    return bool(re.search(r"(?is)</html>\s*$", caminho.read_text(encoding="utf-8", errors="replace")))


def registrar_falha(pasta: Path, motivo: str, log_lead: Path) -> None:
    # Nunca derruba o lote: sem a pasta (ou sem disco), a falha fica só no log.
    try:
        with open(pasta / "falha.log", "a", encoding="utf-8") as f:
            f.write(f"[{agora()}] {motivo} Consulte: {log_lead}\n")
    except OSError as e:
        log(f"Falha de {pasta.name} não registrada em falha.log ({e}); só neste log.", "ERRO", log_lead)
        return
    log(f"Falha registrada em {pasta / 'falha.log'} ({falhas_registradas(pasta)}/{MAX_FALHAS})", "ERRO")


def matar_grupo(pid: int, sinal: int = signal.SIGTERM) -> None:
    try:
        os.killpg(pid, sinal)
    except ProcessLookupError:
        pass


def limpar_cache_chrome(pasta: Path | None = None, agora: float | None = None) -> int:
    """Apaga os perfis temporários do Chrome headless parados há mais de IDADE_MIN_CACHE_CHROME_S.
    Devolve quantos apagou. Nunca levanta: limpeza não pode derrubar o lead que acabou de ser gerado."""
    pasta = CACHE_CHROME if pasta is None else pasta
    agora = time.time() if agora is None else agora
    apagados = 0
    try:
        perfis = list(pasta.glob("scoped_dir*"))
    except OSError:
        return 0
    for perfil in perfis:
        try:
            if perfil.is_symlink() or not perfil.is_dir():
                continue
            if agora - perfil.stat().st_mtime > IDADE_MIN_CACHE_CHROME_S:
                shutil.rmtree(perfil, ignore_errors=True)
                apagados += 1
        except OSError:
            continue
    return apagados


def rodar_claude(slug: str, log_lead: Path, timeout_min: int, personalizado: bool = False) -> dict:
    # Rascunho do lead, fora de ~/auto-site (que o Syncthing e o backup espelham).
    # Caminho curto de propósito: o Chrome headless não sobe com socket em caminho longo.
    rascunho = Path(tempfile.mkdtemp(prefix="gerador-"))
    cmd = comando_do_claude(slug, rascunho, personalizado)
    log(f"Iniciando processo novo do Claude para {slug} (contexto limpo, lista de permissão, rascunho {rascunho}).",
        arquivo=log_lead)
    inicio = time.monotonic()
    try:
        with open(log_lead, "a", encoding="utf-8") as erros, tempfile.TemporaryFile() as saida:
            # Grupo próprio: no timeout mata o Claude E os filhos (vercel, Chrome...).
            proc = subprocess.Popen(cmd, cwd=AUTO, stdin=subprocess.DEVNULL, stdout=saida, stderr=erros,
                                    env={**os.environ, "TMPDIR": str(rascunho)}, start_new_session=True)
            try:
                codigo = proc.wait(timeout=timeout_min * 60)
                estourou = False
            except subprocess.TimeoutExpired:
                matar_grupo(proc.pid)
                try:
                    proc.wait(timeout=30)
                except subprocess.TimeoutExpired:
                    matar_grupo(proc.pid, signal.SIGKILL)
                codigo, estourou = 124, True
            except BaseException:
                # Runner interrompido (SIGTERM, Ctrl+C): não deixa o Claude órfão no grupo dele.
                matar_grupo(proc.pid)
                raise
            matar_grupo(proc.pid)  # Chrome que o Claude deixou em segundo plano
            saida.seek(0)
            negadas = registrar_saida_do_claude(saida.read().decode("utf-8", errors="replace"), log_lead)
    finally:
        shutil.rmtree(rascunho, ignore_errors=True)
        # Depois do rascunho e do matar_grupo: o Chrome do QA já morreu e deixou o perfil dele para trás.
        limpos = limpar_cache_chrome()
        if limpos:
            log(f"Cache do Chrome headless: {limpos} perfil(is) temporário(s) apagado(s).", arquivo=log_lead)
    texto = log_lead.read_text(encoding="utf-8", errors="replace")[-4000:]
    return {
        "codigo": codigo,
        "estourou": estourou,
        "limite": bool(LIMITE_DE_USO.search(texto)) and codigo != 0,
        "minutos": round((time.monotonic() - inicio) / 60, 1),
        "negadas": negadas,
    }


def publicar_na_vercel(pasta: Path, log_lead: Path) -> bool:
    slug = pasta.name
    with tempfile.TemporaryDirectory(prefix=f"demo-{slug}-") as palco:
        shutil.copy2(pasta / "index.html", Path(palco) / "index.html")
        if (pasta / IMAGEM_DA_PREVIA).is_file():  # o og:image do index.html aponta para ela
            shutil.copy2(pasta / IMAGEM_DA_PREVIA, Path(palco) / IMAGEM_DA_PREVIA)
        log(f"Publicando demo-{slug} na Vercel...", arquivo=log_lead)
        with open(log_lead, "a", encoding="utf-8") as saida:
            subprocess.run(["vercel", "link", "--yes", "--project", f"demo-{slug}", "--scope", VERCEL_SCOPE],
                           cwd=palco, stdout=saida, stderr=subprocess.STDOUT, timeout=300)
        r = subprocess.run(["vercel", "deploy", "--prod", "--yes", "--scope", VERCEL_SCOPE],
                           cwd=palco, capture_output=True, text=True, timeout=600)
    saida = (r.stdout or "") + (r.stderr or "")
    with open(log_lead, "a", encoding="utf-8") as f:
        f.write(saida)
    # Até a CLI 5x era "Aliased: https://…"; a 59 escreve "▲ Aliased         https://…", sem os dois-pontos.
    m = re.search(r"(?i)aliased:?\s+(https://\S+)", saida)
    if not m:
        log(f"Deploy sem linha 'Aliased:' na saída; recibo não escrito para {slug}.", "ERRO", log_lead)
        return False
    url = m.group(1).rstrip(".,)")
    conteudo = (pasta / "content.md").read_text(encoding="utf-8", errors="replace")
    pid = re.search(r"(?i)place_id[:* \t]+([a-zA-Z0-9_-]+)", conteudo)
    if not pid:
        log(f"place_id não encontrado no content.md de {slug}; sem ele o n8n não acha a linha. Recibo não escrito.", "ERRO", log_lead)
        return False
    recibo = {
        "place_id": pid.group(1).strip(),
        "slug": slug,
        "nome": conteudo.splitlines()[0].replace("#", "").strip() if conteudo else slug,
        "site_url": url,
        "vercel_project": f"demo-{slug}",
        "publicado_em": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
    }
    (pasta / "publicado.json").write_text(json.dumps(recibo, ensure_ascii=False, indent=2), encoding="utf-8")
    log(f"Recibo escrito com a URL real: {url}", arquivo=log_lead)
    return True


def validar(pasta: Path, log_lead: Path) -> bool:
    recibo = pasta / "publicado.json"
    if not recibo.is_file():
        log(f"Recibo não gerado: {recibo}", "ERRO", log_lead)
        return False
    try:
        url = json.loads(recibo.read_text(encoding="utf-8-sig"))["site_url"]
        assert isinstance(url, str) and url.startswith(("http://", "https://"))
    except Exception as e:  # noqa: BLE001 — qualquer recibo ilegível é falha do lead
        log(f"publicado.json inválido: {e}", "ERRO", log_lead)
        return False
    try:
        with urllib.request.urlopen(urllib.request.Request(url, method="GET"), timeout=30) as r:
            codigo = r.status
    except Exception as e:  # noqa: BLE001
        codigo = getattr(e, "code", str(e))
    log(f"Validação HTTP: {url} -> {codigo}", arquivo=log_lead)
    return codigo == 200


def publicar_raio_x(pasta: Path, log_lead: Path) -> None:
    """Nunca falha o lead: o demo já está no ar e validado. O raio-x escreve no log do
    lead (inclusive a saída do vercel, onde o lote-continuo procura o limite de deploys)."""
    if not RAIO_X.is_file():
        log(f"Raio-X não publicado: {RAIO_X} não existe.", "ERRO", log_lead)
        return
    try:
        with open(log_lead, "a", encoding="utf-8") as erros:
            r = subprocess.run([sys.executable, str(RAIO_X), pasta.name], stdin=subprocess.DEVNULL,
                               stdout=subprocess.DEVNULL, stderr=erros, timeout=10 * 60,
                               env={**os.environ, "AUTO_DIR": str(AUTO)})
        if r.returncode != 0:
            log(f"Raio-X de {pasta.name} não saiu (código {r.returncode}); o demo segue no ar. "
                "O `raio-x --pendentes` tenta de novo.", "ERRO", log_lead)
    except Exception as e:  # noqa: BLE001 — o demo já está no ar: nada aqui vira falha do lead (nem restaura o _vN)
        log(f"Raio-X de {pasta.name} não saiu: {type(e).__name__}: {e}", "ERRO", log_lead)


def status_no_retrato(place_id: str | None) -> str | None:
    """Status do lead na planilha (retrato do fluxo 07, até 26 h); None = sem retrato ou lead fora dele."""
    try:
        d = json.loads(SITE_LEADS.read_text(encoding="utf-8"))
        gerado = dt.datetime.fromisoformat(str(d.get("geradoEm")).replace("Z", "+00:00"))
        if dt.datetime.now(dt.timezone.utc) - gerado > dt.timedelta(hours=26):
            return None
        return next((str(l.get("status")) for l in d.get("leads", []) if l.get("place_id") == place_id), None)
    except (OSError, ValueError, TypeError, AttributeError):
        return None


def marcar_personalizado(pasta: Path) -> None:
    """`personalizado.json`: o lote contínuo só refaz quem tem versão menor que a atual
    (v2 = com a etapa de movimento de nível especialista). Nunca derruba o lead."""
    try:
        (pasta / "personalizado.json").write_text(json.dumps({
            "versao": VERSAO_PREMIUM if MODO_PREMIUM else VERSAO_PERSONALIZADO, "modelo": os.environ.get("GERADOR_MODELO", "").strip() or "padrão",
            "em": dt.datetime.now().astimezone().isoformat(timespec="seconds")}, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass


def backups_do_lead(pasta: Path) -> list[Path]:
    """Pastas `_v1`, `_v2`... em ordem numérica."""
    achados = [p for p in pasta.glob(f"{PREFIXO_BACKUP}[0-9]*") if p.is_dir() and p.name[len(PREFIXO_BACKUP):].isdigit()]
    return sorted(achados, key=lambda p: int(p.name[len(PREFIXO_BACKUP):]))


def preparar_refazer(pasta: Path, log_lead: Path) -> str | None:
    """Põe o site publicado de um lead não enviado na próxima `_vN/` e devolve o lead
    à fila desta execução (sem index.html nem publicado.json). None = pronto; texto =
    motivo de recusar (nada foi mexido). Um refazer que morreu no meio (sem index.html
    na pasta e uma `_vN/` com o site) é desfeito primeiro."""
    if not pasta.is_dir() or not (pasta / "content.md").is_file():
        return "sem pasta ou sem content.md na raiz"
    if not (pasta / "index.html").exists() and backups_do_lead(pasta) and (backups_do_lead(pasta)[-1] / "index.html").is_file():
        restaurar_v1(pasta, log_lead, backups_do_lead(pasta)[-1].name, "refazer anterior interrompido")
    if not (pasta / "publicado.json").is_file() or not (pasta / "index.html").is_file():
        return "não tem um demo publicado para refazer"
    status = status_no_retrato(place_id_do_lead(pasta))
    if status != "pronto":
        return f"status na planilha é {status!r}: só se refaz 'pronto' (não enviado)"
    existentes = backups_do_lead(pasta)
    numero = int(existentes[-1].name[len(PREFIXO_BACKUP):]) + 1 if existentes else 1
    nome_backup = f"{PREFIXO_BACKUP}{numero}"
    v = pasta / nome_backup
    v.mkdir()
    BACKUP_EM_CURSO[pasta.name] = nome_backup
    movidos = []
    try:
        for nome in ARQUIVOS_DO_SITE:
            if (pasta / nome).exists():
                (pasta / nome).replace(v / nome)
                movidos.append(nome)
    except OSError as e:
        restaurar_v1(pasta, log_lead, nome_backup, "não guardou o site anterior")
        return f"não consegui guardar o site anterior: {e}"
    log(f"Refazer: site anterior de {pasta.name} guardado em {nome_backup}/ ({', '.join(movidos)}).", arquivo=log_lead)
    return None


def restaurar_v1(pasta: Path, log_lead: Path, nome_backup: str | None = None, motivo: str = "refazer falhou") -> None:
    """Volta o site anterior (o demo antigo continua no ar); o que o refazer deixou
    de novo fica em `_tentativa-falha/` para olhar depois."""
    nome_backup = nome_backup or BACKUP_EM_CURSO.get(pasta.name)
    v = pasta / nome_backup if nome_backup else None
    if v is None or not v.is_dir():
        return
    tentativa = pasta / TENTATIVA_FALHA
    tentativa.mkdir(exist_ok=True)
    for nome in ARQUIVOS_DO_SITE:
        if (pasta / nome).exists():
            (pasta / nome).replace(tentativa / nome)
    for f in v.iterdir():
        f.replace(pasta / f.name)
    v.rmdir()
    BACKUP_EM_CURSO.pop(pasta.name, None)
    log(f"{motivo}: site anterior de {pasta.name} restaurado (a tentativa ficou em {TENTATIVA_FALHA}/).", "ERRO", log_lead)


def processar(pasta: Path, timeout_min: int, personalizado: bool = False) -> tuple[bool, str]:
    slug = pasta.name
    log_lead = LOGS / f"execucao-{slug}.log"
    indice = pasta / "index.html"
    resultado = {"codigo": 0, "estourou": False, "limite": False}
    if html_completo(indice):
        log(f"Checkpoint: index.html completo para {slug}. Pulando o Claude e indo direto ao deploy.", arquivo=log_lead)
    else:
        if indice.exists():
            indice.replace(pasta / "index.truncado.html")
            log(f"index.html anterior estava truncado; guardado como index.truncado.html.", "ERRO", log_lead)
        resultado = (rodar_claude(slug, log_lead, timeout_min, True) if personalizado
                     else rodar_claude(slug, log_lead, timeout_min))
        negadas = resultado.get("negadas", 0)
        log(f"Claude Code finalizado com exit code {resultado['codigo']} em {resultado.get('minutos')} min; "
            + (f"{negadas} permissão(ões) negada(s), ver [NEGADO] em {log_lead}." if negadas else "nenhuma permissão negada."),
            arquivo=log_lead)
        if not pasta.is_dir():
            return False, "a pasta do lead saiu da raiz durante a geração"
        # Antes do deploy: lead descartado nunca é publicado, mesmo com index.html completo.
        if (pasta / SINAL_DESCARTE).is_file() and not (pasta / "publicado.json").exists():
            if descartar_pelo_sinal(pasta, log_lead):
                return False, "descartado pelo Claude"
            return False, f"{SINAL_DESCARTE} gravado, mas a pasta não pôde ser movida para _descartados/"
        if indice.exists() and not html_completo(indice):
            indice.replace(pasta / "index.truncado.html")
            log("index.html ficou truncado (sem </html>): guardado como index.truncado.html, não publicado.", "ERRO", log_lead)
    if html_completo(indice) and not (pasta / "publicado.json").exists():
        publicar_na_vercel(pasta, log_lead)
    if validar(pasta, log_lead):
        falha = pasta / "falha.log"
        if falha.exists():
            falha.unlink()
        publicar_raio_x(pasta, log_lead)
        return True, ""
    if resultado["estourou"]:
        return False, f"Claude Code excedeu o timeout de {timeout_min} min"
    if resultado["limite"]:
        return False, "limite de uso do Claude atingido"
    if resultado["codigo"] != 0:
        return False, f"Claude Code retornou exit code {resultado['codigo']}"
    return False, "index.html não foi gerado; publicado.json ou validação HTTP 200 falhou"


def tomar_trava() -> bool:
    LOGS.mkdir(parents=True, exist_ok=True)
    if TRAVA.exists():
        try:
            dono = json.loads(TRAVA.read_text(encoding="utf-8"))
            idade_h = (time.time() - dono.get("desde", 0)) / 3600
            mesmo_host_morto = dono.get("host") == socket.gethostname() and not Path(f"/proc/{dono.get('pid')}").exists()
            # Trava de outro host (o PC) só vale por 6 h: runner que morreu sem apagar não bloqueia para sempre.
            if not mesmo_host_morto and idade_h < 6:
                log(f"Outra execução em andamento ({dono.get('host')}, pid {dono.get('pid')}); saindo.", "ERRO")
                return False
        except (OSError, ValueError):
            pass
    TRAVA.write_text(json.dumps({"host": socket.gethostname(), "pid": os.getpid(), "desde": time.time()}), encoding="utf-8")
    return True


def resumo_de_erro(erro: str) -> dict:
    """Execução que não chegou a gerar nada (sem login, sem binário): o
    dell-status lê o `erro` e avisa."""
    try:
        pendentes = len(fila())
    except OSError:
        pendentes = -1
    return {"host": socket.gethostname(), "estado": "ocioso", "ultimo_resumo": {
        "concluidos": [], "falhas": [], "descartados": [], "sumidos": [], "tentativas": 0,
        "pendentes": pendentes, "erro": erro,
        "fim": dt.datetime.now().astimezone().isoformat(timespec="seconds")}}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--quantidade", type=int, default=4)
    ap.add_argument("--timeout-min", type=int, default=45)
    ap.add_argument("--listar", action="store_true", help="só mostra a fila, sem gerar nada")
    ap.add_argument("--refazer", nargs="+", metavar="SLUG",
                    help="modo personalizado: refaz estes leads (publicados e não enviados), na ordem dada")
    ap.add_argument("--premium", action="store_true",
                    help="modo premium: aprende com o Refero a cada lead, imagem feita em código e laço de crítica visual "
                         "(implica --personalizado; use --timeout-min 180)")
    ap.add_argument("--personalizado", action="store_true",
                    default=os.environ.get("GERADOR_PERSONALIZADO", "").strip().lower() in ("1", "true", "sim"),
                    help="leads novos da fila também no modo personalizado (env GERADOR_PERSONALIZADO=1 liga sempre)")
    ap.add_argument("--nota", help="com --refazer --premium: feedback a aplicar sobre a versão anterior (parte dela, não do zero)")
    ap.add_argument("--teto-horas", type=float, default=4.0,
                    help="duração máxima da execução (TimeoutStartSec do serviço); mude junto com o systemd-run")
    a = ap.parse_args()
    if a.refazer and not all(re.fullmatch(r"[a-z0-9][a-z0-9._-]{0,179}", s) for s in a.refazer):
        ap.error("--refazer espera slugs de pasta (minúsculas, números, ponto, hífen e sublinhado)")

    if a.listar:
        pausados = nao_gerar()
        for p in candidatos_da_fila():
            motivo = fora_da_fila(p, pausados)
            print(p.name if motivo is None else f"{p.name}  (fora da fila: {motivo})")
        return 0
    for binario in ("claude", "vercel"):
        if not shutil.which(binario):
            log(f"'{binario}' não encontrado no PATH; nada gerado.", "ERRO")
            gravar_status(resumo_de_erro(f"'{binario}' não encontrado no PATH"))
            return 2
    # Sem login o Claude falharia em todo lead, e 2 falhas tiram o lead da fila:
    # checar ANTES, sem tocar em nenhum lead, e avisar quem pode resolver.
    if not os.environ.get("CLAUDE_CODE_OAUTH_TOKEN") and not (Path.home() / ".claude/.credentials.json").exists():
        log("Claude sem login no Dell (sem CLAUDE_CODE_OAUTH_TOKEN nem ~/.claude/.credentials.json); nada gerado.", "ERRO")
        avisar("O gerador de sites não rodou: o Claude não está logado no Dell. Grave o token em "
               "~/.config/claude-ops/gerador.env (CLAUDE_CODE_OAUTH_TOKEN=...) e ele volta amanhã às 08h.")
        gravar_status(resumo_de_erro("Claude sem login no Dell"))
        return 2
    if not tomar_trava():
        return 0
    # systemctl stop / teto do systemd: sair pelo finally, que grava o resumo e solta a trava.
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    inicio = time.monotonic()
    inicio_iso = dt.datetime.now().astimezone().isoformat(timespec="seconds")
    concluidos, falhas, descartados, sumidos = [], [], [], []
    tentados: set[str] = set()
    global MODO_PREMIUM
    MODO_PREMIUM = a.premium
    global NOTA_DA_REVISAO
    NOTA_DA_REVISAO = (a.nota or "").strip().replace('"', "'")[:3000] or None
    personalizado = bool(a.refazer) or a.personalizado or a.premium
    erro = None
    if a.refazer:
        a.quantidade = max(a.quantidade, len(a.refazer))
    try:
        log("Execução da fila iniciada (Dell)." if not a.refazer
            else f"Refazer em modo personalizado iniciado (Dell): {len(a.refazer)} lead(s).")
        # Sinal que ficou de uma execução anterior: move antes, e não gasta o teto do dia.
        varridos = varrer_descartes()
        descartados += varridos
        # Descartado/sumido não conta como site do dia, mas também tem teto.
        while (len(concluidos) + len(falhas) < a.quantidade
               and len(descartados) - len(varridos) + len(sumidos) < a.quantidade):
            if SINAL_PARAR.exists():
                SINAL_PARAR.unlink()
                log("Sinal .parar recebido; encerrando a fila.", "ERRO")
                break
            if (time.monotonic() - inicio) / 60 + a.timeout_min > a.teto_horas * 60 - 20:
                log(f"Sem tempo para mais um lead antes do teto de {a.teto_horas:g} h do systemd; o resto fica para a próxima execução.")
                break
            pendentes = [AUTO / s for s in a.refazer if s not in tentados] if a.refazer else fila()
            if not pendentes:
                log("Lista de refazer concluída." if a.refazer else "Fila vazia.")
                break
            lead = pendentes[0]
            tentados.add(lead.name)
            log_lead = LOGS / f"execucao-{lead.name}.log"
            log(f"{len(pendentes)} lead(s) pendente(s). Próximo: {lead.name}"
                + (" (refazer, modo personalizado)." if a.refazer else "."))
            if a.refazer:
                recusa = preparar_refazer(lead, log_lead)
                if recusa:
                    falhas.append(f"{lead.name}: pulado, {recusa}")
                    log(f"Refazer pulado: {lead.name}: {recusa}.", "ERRO", log_lead)
                    continue
            # "processando"/"ocioso": os estados que server/auto-production.ts reconhece.
            gravar_status({"host": socket.gethostname(), "estado": "processando", "lead": lead.name,
                           "inicio": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
                           "timeout_min": a.timeout_min, "pendentes": len(pendentes)})
            try:
                ok, motivo = processar(lead, a.timeout_min, personalizado)
            except Exception as e:  # noqa: BLE001 — um lead quebrado não derruba o lote
                ok, motivo = False, f"erro no runner: {type(e).__name__}: {e}"
                log(f"{lead.name}: {motivo}\n{traceback.format_exc().rstrip()}", "ERRO", log_lead)
            if a.refazer and not ok and lead.is_dir():
                # Uma tentativa por lead: o demo antigo volta e segue no ar; sem falha.log.
                restaurar_v1(lead, log_lead)
                falhas.append(f"{lead.name}: {motivo}")
                if motivo.startswith("limite de uso"):
                    log("Limite de uso do Claude: parando a lista de refazer.", "ERRO")
                    break
                continue
            if ok:
                BACKUP_EM_CURSO.pop(lead.name, None)  # o novo está no ar; a _vN fica como histórico
                if personalizado:
                    marcar_personalizado(lead)
                concluidos.append(lead.name)
                log(f"Lead concluído: {lead.name}", "SUCESSO")
            elif not lead.is_dir():
                destino = paradeiro(lead)
                if destino:
                    descartados.append(f"{lead.name} → {destino.parent.name}")
                    log(f"Lead saiu da fila pelo Claude: {lead.name} foi para {destino.parent.name}/ "
                        f"(motivo em {SINAL_DESCARTE} ou no registro.md). Não é falha; seguindo.", arquivo=log_lead)
                else:
                    sumidos.append(lead.name)
                    log(f"A pasta de {lead.name} sumiu durante a geração e não está em nenhuma _*/ "
                        f"(renomeada ou apagada?). Veja {log_lead}. Seguindo.", "ERRO", log_lead)
            else:
                falhas.append(f"{lead.name}: {motivo}")
                registrar_falha(lead, motivo, log_lead)
                if motivo.startswith("limite de uso"):
                    log("Limite de uso do Claude: parando a execução para não queimar a fila.", "ERRO")
                    break
    except Exception as e:  # noqa: BLE001 — erro fora de um lead: registra no resumo em vez de sumir
        erro = f"{type(e).__name__}: {e}"
        log(f"Execução interrompida por erro do runner: {erro}\n{traceback.format_exc().rstrip()}", "ERRO")
    except SystemExit:
        erro = "execução interrompida (SIGTERM: systemctl stop ou teto do systemd)"
        log(erro, "ERRO")
        # Refazer no meio: sem o novo publicado, o demo antigo volta para a pasta (o do ar nunca saiu).
        for slug in list(BACKUP_EM_CURSO):
            pasta = AUTO / slug
            if pasta.is_dir() and not (pasta / "publicado.json").exists():
                restaurar_v1(pasta, LOGS / f"execucao-{slug}.log", motivo="Refazer interrompido")
        raise
    finally:
        try:
            restantes = len(fila())
        except OSError:
            restantes = -1
        duracao = dt.timedelta(seconds=int(time.monotonic() - inicio))
        nivel = "ERRO" if falhas or sumidos or erro else "SUCESSO"
        tentativas = len(concluidos) + len(falhas) + len(descartados) + len(sumidos)
        log(f"Resumo: {tentativas} tentativa(s); {len(concluidos)} concluído(s); "
            f"{len(falhas)} falha(s); {len(descartados)} descartado(s); {len(sumidos)} sumido(s); "
            f"{restantes} pendente(s); duração {duracao}."
            + (f" Falhas: {'; '.join(falhas)}" if falhas else "")
            + (f" Descartados: {'; '.join(descartados)}" if descartados else "")
            + (f" Sumidos: {'; '.join(sumidos)}" if sumidos else "")
            + (f" Erro: {erro}" if erro else ""), nivel)
        # O dell-status lê este resumo (falha sem nenhum concluído ou `erro` vira WhatsApp).
        gravar_status({"host": socket.gethostname(), "estado": "ocioso", "ultimo_resumo": {
            "concluidos": concluidos, "falhas": falhas, "descartados": descartados, "sumidos": sumidos,
            "tentativas": tentativas, "pendentes": restantes, "inicio": inicio_iso,
            **({"erro": erro} if erro else {}),
            "fim": dt.datetime.now().astimezone().isoformat(timespec="seconds")}})
        TRAVA.unlink(missing_ok=True)
    return 1 if erro or (falhas and not concluidos) else 0


if __name__ == "__main__":
    sys.exit(main())
