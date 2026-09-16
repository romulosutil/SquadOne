(() => {
  'use strict'

  const body = document.body
  const dialog = document.querySelector('#project-dialog')
  const form = document.querySelector('#project-form')
  const dialogTitle = document.querySelector('#project-dialog-title')
  const nameInput = document.querySelector('#project-name')
  const pathInput = document.querySelector('#project-path')
  const toast = document.querySelector('#toast')
  const toastMessage = document.querySelector('#toast-message')
  const squadOneWindow = document.querySelector('#squadone-window')
  const squadOneFrame = squadOneWindow.querySelector('iframe')
  const squadOneFrameStatus = document.querySelector('#squadone-frame-status')
  const squadOneWindowLoading = document.querySelector('#squadone-window-loading')
  let toastTimer = 0
  let frameReadyTimer = 0

  const scenarioCopy = {
    healthy: {
      icon: '✓',
      title: 'Tudo em ordem para o próximo bloco.',
      detail: 'Sincronização concluída há 2 minutos; nenhum serviço exige atenção.',
      action: 'Ver atividade',
    },
    offline: {
      icon: '!',
      title: 'n8n está indisponível.',
      detail: 'As outras ferramentas seguem disponíveis. Tente novamente ou abra a verificação local.',
      action: 'Verificar serviço',
    },
    'empty-agenda': {
      icon: '✓',
      title: 'Agenda livre; ferramentas locais estão disponíveis.',
      detail: 'Bom momento para reservar um bloco de foco no projeto ativo.',
      action: 'Criar bloco de foco',
    },
    'google-off': {
      icon: '!',
      title: 'Google Agenda não está conectado.',
      detail: 'Conecte sua conta Google para carregar e sincronizar os compromissos do SquadOne.',
      action: 'Conectar Google',
    },
    'empty-projects': {
      icon: '✓',
      title: 'A Central está pronta para receber seus projetos.',
      detail: 'Adicione uma pasta local ou um link para criar o primeiro atalho.',
      action: 'Adicionar projeto',
    },
  }

  function updateClock() {
    const now = new Date()
    const hour = now.getHours()
    const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite'
    document.querySelector('#saudacao').textContent = `${greeting}, Rômulo`
    document.querySelector('#data-atual').textContent = new Intl.DateTimeFormat('pt-BR', {
      weekday: 'long', day: 'numeric', month: 'long'
    }).format(now)
    document.querySelector('#hora-atual').textContent = new Intl.DateTimeFormat('pt-BR', {
      hour: '2-digit', minute: '2-digit'
    }).format(now)

    const nextStart = new Date(now.getTime() + 24 * 60 * 1000)
    const nextEnd = new Date(nextStart.getTime() + 45 * 60 * 1000)
    const formatTime = (value) => new Intl.DateTimeFormat('pt-BR', {
      hour: '2-digit', minute: '2-digit'
    }).format(value)
    const eventTime = document.querySelector('.next-event__time')
    eventTime.querySelector('strong').textContent = formatTime(nextStart)
    eventTime.querySelector('span').textContent = `— ${formatTime(nextEnd)}`
    eventTime.setAttribute('aria-label', `Das ${formatTime(nextStart)} às ${formatTime(nextEnd)}`)
  }

  function showToast(message) {
    window.clearTimeout(toastTimer)
    toastMessage.textContent = message
    toast.hidden = false
    toastTimer = window.setTimeout(() => { toast.hidden = true }, 5000)
  }

  function setServiceState(element, state, label) {
    element.className = `service-state service-state--${state}`
    element.innerHTML = `<i></i>${label}`
  }

  function resetOfflineState() {
    const tool = document.querySelector('[data-service="n8n"]')
    const health = document.querySelector('[data-health="n8n"]')
    setServiceState(tool.querySelector('.service-state'), 'healthy', 'Disponível')
    tool.querySelector('button').disabled = false
    setServiceState(health.querySelector('.service-state'), 'healthy', 'Saudável')
    health.querySelector('small').textContent = 'verificação exemplo · 1 min'

    const connection = document.querySelector('#dell-connection')
    connection.querySelector('.status-dot').className = 'status-dot status-dot--healthy'
    connection.querySelector('span:nth-child(2)').textContent = 'Dell conectado'
    document.querySelector('#dell-latency').textContent = 'local'
  }

  function setScenario(scenario) {
    body.dataset.scenario = scenario
    document.querySelector('#scenario-select').value = scenario

    const agendaSummary = document.querySelector('#agenda-summary')
    const timeline = document.querySelector('#timeline')
    const agendaEmpty = document.querySelector('#agenda-empty')
    const googleOff = document.querySelector('#google-off')
    const projectList = document.querySelector('#project-list')
    const projectEmpty = document.querySelector('#project-empty')
    const attention = document.querySelector('#attention-line')
    const copy = scenarioCopy[scenario]

    agendaSummary.hidden = scenario === 'empty-agenda' || scenario === 'google-off'
    timeline.hidden = scenario === 'empty-agenda' || scenario === 'google-off'
    agendaEmpty.hidden = scenario !== 'empty-agenda'
    googleOff.hidden = scenario !== 'google-off'
    projectList.hidden = scenario === 'empty-projects'
    projectEmpty.hidden = scenario !== 'empty-projects'

    attention.querySelector('.attention-line__icon').textContent = copy.icon
    attention.querySelector('strong').textContent = copy.title
    attention.querySelector(':scope > div > span').textContent = copy.detail
    attention.querySelector('button').textContent = copy.action
    attention.classList.toggle('is-alert', scenario === 'offline' || scenario === 'google-off')
    resetOfflineState()

    if (scenario === 'offline') {
      const tool = document.querySelector('[data-service="n8n"]')
      const health = document.querySelector('[data-health="n8n"]')
      setServiceState(tool.querySelector('.service-state'), 'offline', 'Indisponível')
      tool.querySelector('button').disabled = true
      setServiceState(health.querySelector('.service-state'), 'offline', 'Indisponível')
      health.querySelector('small').textContent = 'última tentativa · exemplo'

      const connection = document.querySelector('#dell-connection')
      connection.querySelector('.status-dot').className = 'status-dot status-dot--offline'
      connection.querySelector('span:nth-child(2)').textContent = 'Dell com atenção'
      document.querySelector('#dell-latency').textContent = 'n8n sem resposta'
    }
  }

  function openProjectDialog(mode, name = '', path = '') {
    dialogTitle.textContent = mode === 'edit' ? 'Editar projeto' : 'Adicionar projeto'
    nameInput.value = name
    pathInput.value = path
    dialog.showModal()
    window.setTimeout(() => nameInput.focus(), 60)
  }

  function openSquadOneWindow() {
    if (!squadOneFrame.src) {
      squadOneFrame.src = squadOneFrame.dataset.src
    }
    squadOneFrameStatus.textContent = 'Carregando aplicação…'
    squadOneWindowLoading.hidden = false
    squadOneWindow.showModal()
    window.clearTimeout(frameReadyTimer)
    frameReadyTimer = window.setTimeout(() => {
      squadOneWindowLoading.hidden = true
      squadOneFrameStatus.textContent = 'Janela pronta'
    }, 1800)
  }

  function closeSquadOneWindow() {
    squadOneWindow.close()
  }

  document.querySelector('#scenario-select').addEventListener('change', (event) => {
    setScenario(event.target.value)
  })

  document.querySelectorAll('[data-open-project-dialog]').forEach((button) => {
    button.addEventListener('click', () => openProjectDialog('add'))
  })

  document.querySelectorAll('[data-edit-project]').forEach((button) => {
    button.addEventListener('click', () => {
      const [name, path] = button.dataset.editProject.split('|')
      openProjectDialog('edit', name, path)
    })
  })

  document.querySelectorAll('[data-close-dialog]').forEach((button) => {
    button.addEventListener('click', () => dialog.close())
  })

  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close()
  })

  document.querySelectorAll('[data-open-squadone-window]').forEach((button) => {
    button.addEventListener('click', openSquadOneWindow)
  })

  document.querySelector('[data-close-squadone-window]').addEventListener('click', closeSquadOneWindow)

  squadOneWindow.addEventListener('click', (event) => {
    if (event.target === squadOneWindow) closeSquadOneWindow()
  })

  squadOneFrame.addEventListener('load', () => {
    window.clearTimeout(frameReadyTimer)
    squadOneWindowLoading.hidden = true
    squadOneFrameStatus.textContent = 'Aplicação carregada'
  })

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const projectName = nameInput.value.trim()
    dialog.close()
    showToast(`${projectName || 'Projeto'} seria salvo aqui. Nenhum dado real foi alterado.`)
  })

  document.querySelectorAll('[data-tool]').forEach((button) => {
    button.addEventListener('click', () => {
      showToast(`${button.dataset.tool} seria aberto aqui. Nenhum serviço real foi acionado.`)
    })
  })

  document.querySelectorAll('[data-demo-action]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.demoAction === 'Adicionar projeto') {
        openProjectDialog('add')
        return
      }
      showToast(`${button.dataset.demoAction}: interação representada apenas nesta prévia.`)
    })
  })

  document.querySelector('[data-close-toast]').addEventListener('click', () => {
    toast.hidden = true
    window.clearTimeout(toastTimer)
  })

  updateClock()
  window.setInterval(updateClock, 30000)
  setScenario('healthy')
})()
