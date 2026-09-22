(() => {
  'use strict'

  document.dispatchEvent(new CustomEvent('squadone-prototype:register', {
    detail: {
      name: 'Portfólio',
      render: () => `
        <div class="prototype prototype--portfolio" data-variant="portfolio">
          <a class="skip-link" href="#portfolio-content">Pular para o conteúdo</a>
          <header class="portfolio-header">
            <a class="portfolio-brand" href="#portfolio-content"><span>SquadOne</span><small>Mapa do trabalho</small></a>
            <nav aria-label="Navegação principal"><button type="button" data-view="today" class="is-active">Hoje</button><button type="button" data-view="projects">Projetos</button><button type="button" data-view="readings">Leituras <sup data-reading-count>4</sup></button></nav>
            <a class="portfolio-scheduler" href="https://aladdin-squadone-app.jicnzg.easypanel.host/" target="_blank" rel="noopener noreferrer"><span>Agendador pessoal</span><strong>Abrir SquadOne ↗</strong></a>
          </header>
          <div class="portfolio-status"><span class="prototype-flag">Protótipo · dados de exemplo</span><span><i class="signal signal--ok"></i>PC conectado</span><span><i class="signal signal--ok"></i>Dell conectado</span><span><i class="signal signal--ok"></i>Cloud consultada</span><time data-current-date></time></div>

          <main id="portfolio-content" class="portfolio-main" tabindex="-1">
            <section class="portfolio-screen" data-screen="today">
              <header class="portfolio-hero"><div><span>Hoje, uma visão inteira</span><h1 tabindex="-1">Seu trabalho,<br>sem perder o fio.</h1></div><p>O SquadOne reúne o que existe no PC, no Dell e na nuvem — e separa andamento técnico, momento comercial e a próxima decisão.</p></header>
              <section class="portfolio-now" aria-labelledby="portfolio-now-title">
                <div class="portfolio-section-title"><span>01</span><div><p>O que pede movimento</p><h2 id="portfolio-now-title">Três decisões abertas</h2></div></div>
                <div class="portfolio-feature-grid">
                  <article class="portfolio-feature portfolio-feature--lead"><span>Produto × negócio</span><h3>Iris está em produção.<br>Agora precisa de clientes.</h3><p>O estado técnico não encerra o trabalho. A próxima ação é escolher uma clínica piloto e registrar a abordagem.</p><button type="button" data-open-project data-project-name="Iris" data-project-meta="Produção técnica · aquisição de clientes" data-project-next="Definir clínica-alvo e registrar a próxima ação comercial.">Ver contexto do Iris</button></article>
                  <article class="portfolio-feature"><span>Operação</span><h3>Auto tem 10 sites prontos</h3><p>O runner precisa renovar sua evidência de execução; 12 leads seguem em atenção.</p><button type="button" data-demo-action="Painel Auto aberto">Abrir produção</button></article>
                  <article class="portfolio-feature"><span>Conhecimento</span><h3>Onde vive o Prumo?</h3><p>O projeto foi citado no ecossistema Claude, mas sua fonte canônica ainda não está ligada.</p><button type="button" data-open-project data-project-name="Prumo" data-project-meta="Contexto Claude · sem origem localizada" data-project-next="Identificar a fonte canônica do projeto.">Completar vínculo</button></article>
                </div>
              </section>
              <section class="portfolio-horizon" aria-labelledby="portfolio-horizon-title">
                <div class="portfolio-section-title"><span>02</span><div><p>Horizonte</p><h2 id="portfolio-horizon-title">Frentes em andamento</h2></div></div>
                <div class="horizon-list">
                  <article><span class="horizon-index">A</span><div><h3>Construir</h3><p>SquadOne · CRM Silmer</p></div><strong>2 projetos</strong></article>
                  <article><span class="horizon-index">B</span><div><h3>Operar</h3><p>Auto · Silmer Web · P4F</p></div><strong>3 projetos</strong></article>
                  <article><span class="horizon-index">C</span><div><h3>Encontrar clientes</h3><p>Iris · propostas Auto</p></div><strong>2 frentes</strong></article>
                  <article><span class="horizon-index">D</span><div><h3>Decidir depois</h3><p>Aladdin · Espectro · Portfólio</p></div><strong>3 projetos</strong></article>
                </div>
              </section>
              <section class="portfolio-presence" aria-label="Presença do trabalho"><div><span>PC</span><strong>13</strong><small>checkouts Git</small></div><div><span>GitHub</span><strong>44</strong><small>repositórios</small></div><div><span>Vercel</span><strong>57</strong><small>projetos</small></div><div><span>Drive Auto</span><strong>22</strong><small>leads ativos</small></div></section>
            </section>

            <section class="portfolio-screen" data-screen="projects" hidden>
              <header class="portfolio-page-heading"><span>O portfólio não é uma lista de links</span><h1 tabindex="-1">Projetos são<br>histórias em curso.</h1><p>Cada entrada liga intenção, código, deploy, arquivos, automações e a próxima decisão humana.</p></header>
              <div class="portfolio-project-tools"><label><span>Buscar no portfólio</span><input data-project-search type="search" placeholder="Digite um projeto ou momento" /></label><div class="scope-filter scope-filter--paper" aria-label="Filtrar por escopo"><button type="button" data-scope="all" aria-pressed="true">Tudo</button><button type="button" data-scope="personal" aria-pressed="false">Pessoal</button><button type="button" data-scope="corporate" aria-pressed="false">Corporativo</button><button type="button" data-scope="client" aria-pressed="false">Clientes</button></div><span data-project-result aria-live="polite">8 projetos visíveis</span></div>
              <div class="portfolio-project-grid">
                ${portfolioCards()}
              </div>
            </section>

            <section class="portfolio-screen" data-screen="readings" hidden>
              <header class="portfolio-page-heading portfolio-page-heading--readings"><span>Hermes observa; você decide</span><h1 tabindex="-1">Leituras</h1><p>Uma caixa editorial de mudanças relevantes, cada uma com origem, instante e evidência.</p></header>
              <div class="portfolio-reading-list">
                ${portfolioReadings()}
              </div>
            </section>
          </main>
          <footer class="portfolio-footer"><strong>SquadOne · Central conectada</strong><span>Leitura local · sem poder operacional</span></footer>
          ${projectDialogPortfolio()}
        </div>
      `
    }
  }))

  function portfolioCards() {
    const projects = [
      ['Iris', 'personal', 'Produção', 'Aquisição', 'Definir clínica piloto', 'GitHub · EasyPanel', '01'],
      ['Produção Auto', 'client', 'Operação', 'Prospecção', 'Revisar runner', 'Drive · Vercel · Hermes', '02'],
      ['SquadOne', 'personal', 'Construção', 'Uso pessoal', 'Escolher direção visual', 'GitHub · Dell', '03'],
      ['CRM Silmer', 'personal', 'Construção', 'Produto interno', 'Avançar integrações', 'GitHub · n8n', '04'],
      ['Silmer Web', 'client', 'Produção', 'Cliente ativo', 'Aguardar conteúdo', 'GitHub · Vercel', '05'],
      ['P4F Institucional', 'corporate', 'Manutenção', 'Corporativo', 'Revisar frente atual', 'Bitbucket · Vercel', '06'],
      ['Prumo', 'personal', 'Descoberta', 'Contexto incompleto', 'Localizar fonte', 'Claude', '07'],
      ['Aladdin', 'personal', 'Pausado', 'Produto potencial', 'Decidir retomada', 'GitHub', '08']
    ]
    return projects.map(([name, scope, technical, business, next, sources, index]) => `
      <article class="portfolio-project-card" data-project-card data-scope="${scope}">
        <div class="portfolio-project-card__top"><span>${index}</span><small>${sources}</small></div><h2>${name}</h2>
        <dl><div><dt>Técnico</dt><dd>${technical}</dd></div><div><dt>Negócio</dt><dd>${business}</dd></div></dl>
        <p><span>Próxima ação</span>${next}</p>
        <button type="button" data-open-project data-project-name="${name}" data-project-meta="${technical} · ${business} · ${sources}" data-project-next="${next}.">Abrir história <span aria-hidden="true">→</span></button>
      </article>`).join('')
  }

  function portfolioReadings() {
    const readings = [
      ['auto-runner', '21 set · Dell worker', 'Produção Auto', 'O runner perdeu atualidade, não necessariamente execução.', 'A evidência existente é antiga. A interface deve dizer “estado desconhecido”, não “parado”.', '.logs/execucao-fila.log'],
      ['iris-commercial', '21 set · contexto humano', 'Iris', 'Pronto tecnicamente não significa concluído comercialmente.', 'O próximo marco é uma clínica piloto; saúde do deploy e aquisição precisam permanecer separadas.', 'README + decisão de Rômulo'],
      ['cloud-inventory', '21 set · inventário cloud', 'Portfólio', 'Ativos duplicados podem pertencer ao mesmo projeto.', 'Silmer, silmer-web e seus deploys precisam ser correlacionados, não exibidos como três projetos.', 'GitHub + Vercel'],
      ['prumo-source', '21 set · PC', 'Prumo', 'A fonte informada ainda não apareceu na varredura allowlisted.', 'É necessária uma referência explícita antes de mostrar andamento ou arquivos.', 'C:\\Users\\sutil\\.claude']
    ]
    return readings.map(([id, date, project, title, copy, evidence], index) => `
      <article class="portfolio-reading" data-reading data-reading-id="${id}"><span class="portfolio-reading__index">0${index + 1}</span><div><small>${date}</small><p>${project}</p><h2>${title}</h2><span>${copy}</span><em>Evidência · ${evidence}</em></div><div><button type="button" data-open-project data-project-name="${project}" data-project-meta="Leitura do Hermes · ${evidence}" data-project-next="${title}.">Ver projeto</button><button type="button" data-resolve-reading aria-pressed="false">Marcar resolvida</button></div></article>`).join('')
  }

  function projectDialogPortfolio() {
    return `<dialog class="project-detail project-detail--paper" data-project-dialog aria-labelledby="portfolio-detail-title"><div class="project-detail__bar"><span>História do projeto</span><button type="button" data-close-dialog aria-label="Fechar detalhes">×</button></div><div class="project-detail__body"><p>Projeto conectado</p><h2 id="portfolio-detail-title" data-detail-name></h2><strong data-detail-meta></strong><dl><div><dt>Próxima ação</dt><dd data-detail-next></dd></div><div><dt>Limite</dt><dd>A prévia não acessa arquivos, credenciais ou serviços.</dd></div></dl><button type="button" data-demo-action="Dossiê completo aberto">Abrir dossiê completo</button></div></dialog>`
  }
})()
