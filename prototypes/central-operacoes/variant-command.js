(() => {
  'use strict'

  document.dispatchEvent(new CustomEvent('squadone-prototype:register', {
    detail: {
      name: 'Comando',
      render: () => `
        <div class="prototype prototype--command" data-variant="command">
          <a class="skip-link" href="#command-content">Pular para o conteúdo</a>
          <aside class="command-rail" aria-label="Navegação principal">
            <div class="command-brand"><span>S1</span><div><strong>SquadOne</strong><small>operações</small></div></div>
            <nav class="command-nav">
              <button type="button" data-view="today" class="is-active"><span>01</span>Hoje</button>
              <button type="button" data-view="projects"><span>02</span>Projetos</button>
              <button type="button" data-view="readings"><span>03</span>Leituras <b>4</b></button>
            </nav>
            <div class="command-sources" aria-label="Fontes conectadas">
              <p>Fontes</p>
              <span><i class="signal signal--ok"></i>PC</span>
              <span><i class="signal signal--ok"></i>Dell worker</span>
              <span><i class="signal signal--warn"></i>Cloud · 1 atenção</span>
            </div>
            <a class="scheduler-link scheduler-link--rail" href="https://aladdin-squadone-app.jicnzg.easypanel.host/" target="_blank" rel="noopener noreferrer">
              <span>Agendador pessoal</span><strong>Abrir SquadOne ↗</strong>
            </a>
          </aside>

          <div class="command-main">
            <header class="command-topbar">
              <div><span class="prototype-flag">Protótipo · dados de exemplo</span><strong data-current-date></strong></div>
              <div class="command-health"><span><i class="signal signal--ok"></i>Hermes</span><span><i class="signal signal--ok"></i>n8n</span><span><i class="signal signal--ok"></i>Túnel SSH</span></div>
            </header>

            <main id="command-content" tabindex="-1">
              <section class="command-screen" data-screen="today">
                <div class="command-heading"><div><span>Visão de decisão</span><h1 tabindex="-1">O que precisa de você agora</h1></div><button class="icon-action" type="button" data-demo-action="Atualização solicitada">↻ <span>Atualizar</span></button></div>
                <div class="command-dashboard">
                  <section class="attention-stack" aria-labelledby="command-attention">
                    <div class="panel-heading"><h2 id="command-attention">Atenção</h2><span>3 itens</span></div>
                    <article class="attention-item attention-item--critical">
                      <span class="priority-code">A1</span><div><p>Produção Auto</p><h3>Runner sem estado atual</h3><small>Evidência: log existe, status não foi renovado.</small></div><button type="button" data-demo-action="Painel Auto aberto">Revisar</button>
                    </article>
                    <article class="attention-item">
                      <span class="priority-code">A2</span><div><p>Iris · negócio</p><h3>Produto pronto; próximo marco é cliente piloto</h3><small>Momento técnico e comercial separados.</small></div><button type="button" data-open-project data-project-name="Iris" data-project-meta="Produção técnica · aquisição de clientes" data-project-next="Definir clínica-alvo e registrar a próxima ação comercial.">Abrir</button>
                    </article>
                    <article class="attention-item">
                      <span class="priority-code">A3</span><div><p>Prumo · contexto</p><h3>Origem ainda não localizada</h3><small>Informado como existente no ecossistema Claude.</small></div><button type="button" data-open-project data-project-name="Prumo" data-project-meta="Sem repositório conhecido · contexto Claude" data-project-next="Identificar onde o contexto canônico está armazenado.">Localizar</button>
                    </article>
                  </section>

                  <aside class="command-side">
                    <a class="scheduler-card" href="https://aladdin-squadone-app.jicnzg.easypanel.host/" target="_blank" rel="noopener noreferrer">
                      <span>Agenda pessoal</span><strong>SquadOne permanece separado</strong><small>Abrir o escritório, a agenda e as quests atuais ↗</small>
                    </a>
                    <section class="focus-card"><span>Em andamento</span><h2>4 frentes ativas</h2><ul><li><b>SquadOne</b><small>Central conectada</small></li><li><b>Auto</b><small>10 sites prontos</small></li><li><b>Iris</b><small>Aquisição de clientes</small></li><li><b>P4F</b><small>Trabalho corporativo</small></li></ul></section>
                  </aside>
                </div>
                <section class="connection-board" aria-labelledby="command-connections">
                  <div class="panel-heading"><h2 id="command-connections">Conectividade de trabalho</h2><span>somente leitura</span></div>
                  <div class="connection-grid">
                    <article><span>PC</span><strong>13 checkouts Git</strong><small>Claude · Codex · Antigravity</small></article>
                    <article><span>Dell worker</span><strong>Operação persistente</strong><small>Hermes · n8n · Syncthing · containers</small></article>
                    <article><span>GitHub</span><strong>44 repositórios</strong><small>37 privados · 7 públicos</small></article>
                    <article><span>Vercel</span><strong>57 projetos</strong><small>Produção Auto e produtos publicados</small></article>
                    <article><span>Drive</span><strong>Auto sincronizado</strong><small>22 leads ativos</small></article>
                  </div>
                </section>
              </section>

              <section class="command-screen" data-screen="projects" hidden>
                <div class="command-heading"><div><span>Portfólio conectado</span><h1 tabindex="-1">Projetos</h1></div><strong class="inventory-count">8 visíveis · 5 fontes</strong></div>
                <div class="project-toolbar">
                  <label><span>Buscar projeto</span><input data-project-search type="search" placeholder="Nome, momento ou fonte" /></label>
                  <div class="scope-filter" aria-label="Filtrar por escopo"><button type="button" data-scope="all" aria-pressed="true">Todos</button><button type="button" data-scope="personal" aria-pressed="false">Pessoal</button><button type="button" data-scope="corporate" aria-pressed="false">Corporativo</button><button type="button" data-scope="client" aria-pressed="false">Clientes</button></div>
                  <span data-project-result aria-live="polite">8 projetos visíveis</span>
                </div>
                <div class="command-projects">
                  ${projectRowsCommand()}
                </div>
              </section>

              <section class="command-screen" data-screen="readings" hidden>
                <div class="command-heading"><div><span>Hermes agent</span><h1 tabindex="-1">Leituras com evidência</h1></div><div class="reading-legend"><span>4 novas</span><span>2 ações</span></div></div>
                <div class="reading-inbox">
                  ${readingRowsCommand()}
                </div>
              </section>
            </main>
          </div>
          ${projectDialog('command')}
        </div>
      `
    }
  }))

  function projectRowsCommand() {
    const projects = [
      ['Auto', 'client', 'Drive + Vercel + Hermes', 'Operação ativa', '10 prontos · 12 em atenção', 'Revisar runner', 'AU'],
      ['Iris', 'personal', 'GitHub + EasyPanel', 'Produção', 'Precisa de clientes', 'Definir clínica piloto', 'IR'],
      ['CRM Silmer', 'personal', 'GitHub + n8n', 'Construção', 'Produto interno', 'Avançar integrações', 'CS'],
      ['Silmer Web', 'client', 'GitHub + Vercel', 'Produção', 'Cliente ativo', 'Aguardar conteúdo', 'SW'],
      ['SquadOne', 'personal', 'GitHub + Dell', 'Construção', 'Ferramenta pessoal', 'Validar arquitetura', 'S1'],
      ['Prumo', 'personal', 'Claude', 'Descoberta', 'Contexto incompleto', 'Localizar fonte', 'PR'],
      ['P4F Institucional', 'corporate', 'Bitbucket + Vercel', 'Manutenção', 'Corporativo', 'Revisar trabalho ativo', 'P4'],
      ['Aladdin', 'personal', 'GitHub', 'Pausado', 'Produto potencial', 'Decidir retomada', 'AL']
    ]
    return projects.map(([name, scope, source, technical, business, next, mark]) => `
      <article class="command-project-row" data-project-card data-scope="${scope}">
        <span class="project-mark">${mark}</span><div class="project-identity"><h2>${name}</h2><small>${source}</small></div>
        <div><span>Técnico</span><strong>${technical}</strong></div><div><span>Negócio</span><strong>${business}</strong></div>
        <div class="project-next"><span>Próxima ação</span><strong>${next}</strong></div>
        <button type="button" data-open-project data-project-name="${name}" data-project-meta="${technical} · ${business} · ${source}" data-project-next="${next}.">Detalhes</button>
      </article>`).join('')
  }

  function readingRowsCommand() {
    const readings = [
      ['Ação', 'Auto', 'Runner sem estado atual', 'O log existe, mas a última evidência de execução está desatualizada.', '.logs/execucao-fila.log · Dell worker'],
      ['Ação', 'Iris', 'Próximo marco é comercial', 'O produto está em produção; aquisição de clientes deve aparecer separada da saúde técnica.', 'Contexto humano + README do Iris'],
      ['Informação', 'Inventário', 'GitHub e Vercel foram correlacionados', 'Ativos cloud podem ser ligados aos projetos sem criar projetos duplicados.', 'GitHub CLI + Vercel CLI'],
      ['Atenção', 'Prumo', 'Fonte canônica não localizada', 'O nome não apareceu no diretório .claude pesquisado no PC.', 'Varredura local allowlisted']
    ]
    return readings.map(([severity, project, title, copy, evidence], index) => `
      <article class="command-reading" data-reading>
        <div><span class="reading-severity reading-severity--${severity.toLowerCase()}">${severity}</span><small>H-${String(index + 1).padStart(2, '0')}</small></div>
        <div><p>${project}</p><h2>${title}</h2><span>${copy}</span><small>Evidência: ${evidence}</small></div>
        <div><button type="button" data-demo-action="Projeto ${project} aberto">Abrir projeto</button><button type="button" data-resolve-reading aria-pressed="false">Marcar resolvida</button></div>
      </article>`).join('')
  }

  function projectDialog(prefix) {
    return `<dialog class="project-detail" data-project-dialog aria-labelledby="${prefix}-detail-title"><div class="project-detail__bar"><span>Projeto conectado</span><button type="button" data-close-dialog aria-label="Fechar detalhes">×</button></div><div class="project-detail__body"><p>Visão consolidada</p><h2 id="${prefix}-detail-title" data-detail-name></h2><strong data-detail-meta></strong><dl><div><dt>Próxima ação</dt><dd data-detail-next></dd></div><div><dt>Política</dt><dd>Somente leitura; nenhuma ação operacional parte desta tela.</dd></div></dl><button type="button" data-demo-action="Dossiê completo aberto">Abrir dossiê completo</button></div></dialog>`
  }
})()
