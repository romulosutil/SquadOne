(() => {
  'use strict'

  document.dispatchEvent(new CustomEvent('squadone-prototype:register', {
    detail: {
      name: 'Fluxo',
      render: () => `
        <div class="prototype prototype--flow" data-variant="flow">
          <a class="skip-link" href="#flow-content">Pular para o conteúdo</a>
          <header class="flow-header">
            <div class="flow-brand"><span class="flow-brand__mark">S1</span><div><strong>SquadOne</strong><small>work graph / local</small></div></div>
            <nav aria-label="Navegação principal"><button type="button" data-view="today" class="is-active">Hoje</button><button type="button" data-view="projects">Projetos</button><button type="button" data-view="readings">Leituras <span data-reading-count>4</span></button></nav>
            <a href="https://aladdin-squadone-app.jicnzg.easypanel.host/" target="_blank" rel="noopener noreferrer" class="flow-scheduler"><span>Agendador pessoal</span><strong>Abrir app ↗</strong></a>
          </header>
          <div class="flow-strip"><span class="prototype-flag">Protótipo · dados de exemplo</span><p><i class="signal signal--ok"></i>PC + Dell + Cloud</p><span>→</span><p><i class="signal signal--ok"></i>Hermes</p><span>→</span><p><i class="signal signal--ok"></i>n8n</p><span>→</span><p><i class="signal signal--ok"></i>SquadOne</p><time data-current-date></time></div>

          <main id="flow-content" class="flow-main" tabindex="-1">
            <section class="flow-screen" data-screen="today">
              <header class="flow-page-heading"><div><span>Mapa de situação</span><h1 tabindex="-1">Hoje, de ponta a ponta</h1></div><p>Acompanhe como trabalho, infraestrutura e nuvem se conectam. O destaque vai para relações quebradas ou decisões sem dono.</p></header>
              <section class="work-map" aria-labelledby="work-map-title">
                <div class="flow-section-heading"><h2 id="work-map-title">Conexões do ambiente</h2><span>5 fontes · 1 atenção</span></div>
                <div class="map-lanes">
                  <article class="map-lane"><header><span>01</span><div><strong>PC</strong><small>trabalho interativo</small></div><i class="signal signal--ok"></i></header><ul><li>Repos pessoais <b>8</b></li><li>Repos corporativos <b>5</b></li><li>Claude · Codex · Antigravity</li><li class="is-gap">Prumo <em>origem pendente</em></li></ul></article>
                  <span class="lane-arrow" aria-hidden="true">→</span>
                  <article class="map-lane map-lane--core"><header><span>02</span><div><strong>Dell worker</strong><small>operação persistente</small></div><i class="signal signal--ok"></i></header><ul><li>Hermes <b>online</b></li><li>n8n <b>online</b></li><li>Syncthing <b>online</b></li><li class="is-gap">Runner Auto <em>evidência antiga</em></li></ul></article>
                  <span class="lane-arrow" aria-hidden="true">→</span>
                  <article class="map-lane"><header><span>03</span><div><strong>Cloud</strong><small>fontes externas</small></div><i class="signal signal--ok"></i></header><ul><li>GitHub <b>44 repos</b></li><li>Vercel <b>57 projetos</b></li><li>Drive Auto <b>22 ativos</b></li><li>Bitbucket <b>P4F</b></li></ul></article>
                </div>
              </section>
              <div class="flow-today-grid">
                <section class="decision-flow" aria-labelledby="decision-flow-title"><div class="flow-section-heading"><h2 id="decision-flow-title">Fila de decisão</h2><span>ordem sugerida</span></div><ol><li><span>1</span><div><small>Operação · Auto</small><strong>Confirmar o estado do runner</strong><p>Não inferir parada a partir de evidência antiga.</p></div><button type="button" data-demo-action="Painel Auto aberto">Abrir</button></li><li><span>2</span><div><small>Negócio · Iris</small><strong>Escolher clínica piloto</strong><p>Produto em produção, aquisição ainda aberta.</p></div><button type="button" data-open-project data-project-name="Iris" data-project-meta="Produção técnica · aquisição de clientes" data-project-next="Definir clínica-alvo e registrar a próxima ação comercial.">Contexto</button></li><li><span>3</span><div><small>Conhecimento · Prumo</small><strong>Vincular fonte canônica</strong><p>Sem origem explícita, não há estado confiável.</p></div><button type="button" data-open-project data-project-name="Prumo" data-project-meta="Descoberta · contexto Claude" data-project-next="Identificar a fonte canônica do projeto.">Localizar</button></li></ol></section>
                <aside class="flow-agenda"><span>Continuidade preservada</span><h2>Seu agendador não muda.</h2><p>Agenda, escritório, agentes e quests continuam no SquadOne remoto. A Central apenas oferece acesso direto.</p><a href="https://aladdin-squadone-app.jicnzg.easypanel.host/" target="_blank" rel="noopener noreferrer">Abrir agendador pessoal <span aria-hidden="true">↗</span></a></aside>
              </div>
            </section>

            <section class="flow-screen" data-screen="projects" hidden>
              <header class="flow-page-heading"><div><span>Grafo de trabalho</span><h1 tabindex="-1">Projetos e seus ativos</h1></div><p>Veja o projeto como centro e conecte checkouts, repositórios, deploys, arquivos, automações e contexto humano.</p></header>
              <div class="flow-project-tools"><label><span>Encontrar nó</span><input data-project-search type="search" placeholder="Projeto, fonte ou próxima ação" /></label><div class="scope-filter scope-filter--blueprint" aria-label="Filtrar por escopo"><button type="button" data-scope="all" aria-pressed="true">Todos</button><button type="button" data-scope="personal" aria-pressed="false">Pessoal</button><button type="button" data-scope="corporate" aria-pressed="false">Corporativo</button><button type="button" data-scope="client" aria-pressed="false">Clientes</button></div><span data-project-result aria-live="polite">8 projetos visíveis</span></div>
              <div class="flow-project-list">
                ${flowProjects()}
              </div>
            </section>

            <section class="flow-screen" data-screen="readings" hidden>
              <header class="flow-page-heading"><div><span>Hermes → n8n → SquadOne</span><h1 tabindex="-1">Leituras rastreáveis</h1></div><p>Cada leitura nasce de fatos, passa por normalização e termina ligada ao projeto e à evidência que a sustenta.</p></header>
              <div class="reading-pipeline" aria-label="Fluxo das leituras"><span>Fonte</span><i>→</i><span>Hermes</span><i>→</i><span>n8n normaliza</span><i>→</i><span>SquadOne apresenta</span><i>→</i><span>Você decide</span></div>
              <div class="flow-readings">
                ${flowReadings()}
              </div>
            </section>
          </main>
          <footer class="flow-footer"><span>SquadOne / central conectada / somente leitura</span><span>O navegador não executa infraestrutura</span></footer>
          ${projectDialogFlow()}
        </div>
      `
    }
  }))

  function flowProjects() {
    const projects = [
      ['Iris', 'personal', 'Produção', 'Aquisição', ['PC checkout', 'GitHub', 'EasyPanel'], 'Definir clínica piloto'],
      ['Produção Auto', 'client', 'Operação', 'Prospecção', ['Drive', 'Vercel', 'Hermes', 'n8n'], 'Revisar runner'],
      ['SquadOne', 'personal', 'Construção', 'Uso pessoal', ['PC checkout', 'GitHub', 'Dell'], 'Escolher direção'],
      ['CRM Silmer', 'personal', 'Construção', 'Produto interno', ['PC checkout', 'GitHub', 'n8n'], 'Avançar integrações'],
      ['Silmer Web', 'client', 'Produção', 'Cliente ativo', ['PC checkout', 'GitHub', 'Vercel'], 'Aguardar conteúdo'],
      ['P4F Institucional', 'corporate', 'Manutenção', 'Corporativo', ['PC checkout', 'Bitbucket', 'Vercel'], 'Revisar frente atual'],
      ['Prumo', 'personal', 'Descoberta', 'Contexto incompleto', ['Claude', 'fonte ?'], 'Localizar fonte'],
      ['Aladdin', 'personal', 'Pausado', 'Produto potencial', ['PC checkout', 'GitHub'], 'Decidir retomada']
    ]
    return projects.map(([name, scope, technical, business, nodes, next], index) => `
      <article class="flow-project" data-project-card data-scope="${scope}">
        <span class="flow-project__number">${String(index + 1).padStart(2, '0')}</span><div class="flow-project__name"><h2>${name}</h2><small>${technical} / ${business}</small></div>
        <div class="flow-project__nodes">${nodes.map((node) => `<span>${node}</span>`).join('<i>—</i>')}</div><div class="flow-project__next"><small>Próxima ação</small><strong>${next}</strong></div>
        <button type="button" data-open-project data-project-name="${name}" data-project-meta="${technical} · ${business} · ${nodes.join(' · ')}" data-project-next="${next}.">Inspecionar</button>
      </article>`).join('')
  }

  function flowReadings() {
    const readings = [
      ['auto-runner', 'Dell / arquivo', 'Auto', 'attention', 'Runner sem evidência recente', 'A observação expirou; o estado correto é desconhecido até nova coleta.', '.logs/execucao-fila.log'],
      ['iris-commercial', 'Humano + Git', 'Iris', 'action', 'Momento comercial aberto', 'Deploy e produto podem estar saudáveis enquanto aquisição exige uma ação.', 'README + decisão de Rômulo'],
      ['cloud-inventory', 'GitHub + Vercel', 'Portfólio', 'info', 'Ativos aguardam correlação', 'Repos e deploys com nomes próximos devem convergir no mesmo projeto.', 'Inventário das contas'],
      ['prumo-source', 'PC / allowlist', 'Prumo', 'attention', 'Fonte não localizada', 'Nenhum contexto deve ser inventado até existir um vínculo explícito.', 'Diretório .claude']
    ]
    const severityLabels = { attention: 'Atenção', action: 'Ação', info: 'Informação' }
    return readings.map(([id, source, project, severity, title, copy, evidence], index) => `
      <article class="flow-reading" data-reading data-reading-id="${id}"><span class="flow-reading__rail"></span><div class="flow-reading__source"><small>Entrada ${index + 1}</small><strong>${source}</strong><span class="reading-severity reading-severity--${severity}">${severityLabels[severity]}</span></div><div class="flow-reading__body"><small>${project}</small><h2>${title}</h2><p>${copy}</p><em>${evidence}</em></div><div class="flow-reading__actions"><button type="button" data-open-project data-project-name="${project}" data-project-meta="Leitura do Hermes · ${evidence}" data-project-next="${title}.">Projeto</button><button type="button" data-resolve-reading aria-pressed="false">Marcar resolvida</button></div></article>`).join('')
  }

  function projectDialogFlow() {
    return `<dialog class="project-detail project-detail--blueprint" data-project-dialog aria-labelledby="flow-detail-title"><div class="project-detail__bar"><span>Nó do projeto</span><button type="button" data-close-dialog aria-label="Fechar detalhes">×</button></div><div class="project-detail__body"><p>Relações conhecidas</p><h2 id="flow-detail-title" data-detail-name></h2><strong data-detail-meta></strong><dl><div><dt>Próxima ação</dt><dd data-detail-next></dd></div><div><dt>Execução</dt><dd>Somente leitura; ações permanecem nas ferramentas de origem.</dd></div></dl><button type="button" data-demo-action="Grafo do projeto aberto">Abrir grafo completo</button></div></dialog>`
  }
})()
