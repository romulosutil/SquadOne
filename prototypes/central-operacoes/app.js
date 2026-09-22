(() => {
  'use strict'

  const variants = []
  let current = 0
  let toastTimer = 0

  document.addEventListener('squadone-prototype:register', (event) => {
    variants.push(event.detail)
  })

  document.addEventListener('DOMContentLoaded', () => {
    const stage = document.getElementById('stage')
    const picker = document.querySelector('.proto-picker')
    const highlight = picker.querySelector('.proto-picker-highlight')
    const items = [...picker.querySelectorAll('.proto-picker-item:not(.proto-picker-replay)')]
    const replay = picker.querySelector('.proto-picker-replay')
    const toast = document.getElementById('prototype-toast')
    const toastMessage = document.getElementById('prototype-toast-message')

    function showToast(message) {
      window.clearTimeout(toastTimer)
      toastMessage.textContent = message
      toast.hidden = false
      toastTimer = window.setTimeout(() => { toast.hidden = true }, 4200)
    }

    function moveHighlight() {
      const el = items[current]
      highlight.style.width = el.offsetWidth + 'px'
      highlight.style.transform = `translateX(${el.offsetLeft}px)`
    }

    function setView(root, view) {
      root.querySelectorAll('[data-screen]').forEach((screen) => {
        screen.hidden = screen.dataset.screen !== view
      })
      root.querySelectorAll('[data-view]').forEach((control) => {
        const active = control.dataset.view === view
        control.classList.toggle('is-active', active)
        if (active) control.setAttribute('aria-current', 'page')
        else control.removeAttribute('aria-current')
      })
      const activeScreen = root.querySelector(`[data-screen="${view}"]`)
      activeScreen?.querySelector('h1, h2')?.focus({ preventScroll: true })
    }

    function filterProjects(root) {
      const input = root.querySelector('[data-project-search]')
      const selected = root.querySelector('[data-scope][aria-pressed="true"]')?.dataset.scope || 'all'
      const query = input?.value.trim().toLocaleLowerCase('pt-BR') || ''
      let visible = 0

      root.querySelectorAll('[data-project-card]').forEach((card) => {
        const matchesScope = selected === 'all' || card.dataset.scope === selected
        const matchesQuery = !query || card.textContent.toLocaleLowerCase('pt-BR').includes(query)
        card.hidden = !(matchesScope && matchesQuery)
        if (!card.hidden) visible += 1
      })

      const result = root.querySelector('[data-project-result]')
      if (result) result.textContent = `${visible} ${visible === 1 ? 'projeto visível' : 'projetos visíveis'}`
    }

    function openProject(root, trigger) {
      const dialog = root.querySelector('[data-project-dialog]')
      if (!dialog) return
      dialog.querySelector('[data-detail-name]').textContent = trigger.dataset.projectName
      dialog.querySelector('[data-detail-meta]').textContent = trigger.dataset.projectMeta
      dialog.querySelector('[data-detail-next]').textContent = trigger.dataset.projectNext
      dialog.showModal()
    }

    function wireVariant() {
      const root = stage.firstElementChild
      if (!root) return

      const today = new Intl.DateTimeFormat('pt-BR', {
        weekday: 'long', day: 'numeric', month: 'long'
      }).format(new Date())
      root.querySelectorAll('[data-current-date]').forEach((node) => { node.textContent = today })

      root.addEventListener('click', (event) => {
        const viewControl = event.target.closest('[data-view]')
        if (viewControl) {
          setView(root, viewControl.dataset.view)
          return
        }

        const scope = event.target.closest('[data-scope]')
        if (scope) {
          root.querySelectorAll('[data-scope]').forEach((button) => {
            button.setAttribute('aria-pressed', String(button === scope))
          })
          filterProjects(root)
          return
        }

        const detail = event.target.closest('[data-open-project]')
        if (detail) {
          openProject(root, detail)
          return
        }

        const closeDialog = event.target.closest('[data-close-dialog]')
        if (closeDialog) {
          closeDialog.closest('dialog')?.close()
          return
        }

        const reading = event.target.closest('[data-resolve-reading]')
        if (reading) {
          const item = reading.closest('[data-reading]')
          item.classList.toggle('is-resolved')
          const resolved = item.classList.contains('is-resolved')
          reading.textContent = resolved ? 'Reabrir' : 'Marcar resolvida'
          reading.setAttribute('aria-pressed', String(resolved))
          showToast(resolved ? 'Leitura marcada como resolvida nesta prévia.' : 'Leitura reaberta nesta prévia.')
          return
        }

        const demo = event.target.closest('[data-demo-action]')
        if (demo) showToast(`${demo.dataset.demoAction}. Nenhum serviço ou dado real foi alterado.`)
      })

      root.addEventListener('input', (event) => {
        if (event.target.matches('[data-project-search]')) filterProjects(root)
      })

      root.querySelectorAll('[data-project-dialog]').forEach((dialog) => {
        dialog.addEventListener('click', (event) => {
          if (event.target === dialog) dialog.close()
        })
      })

      setView(root, 'today')
    }

    function mount(i) {
      stage.innerHTML = ''
      requestAnimationFrame(() => {
        stage.innerHTML = variants[i].render()
        wireVariant()
      })
    }

    function setActive(i) {
      if (i < 0 || i >= variants.length) return
      current = i
      items.forEach((el, j) => {
        el.toggleAttribute('data-active', j === i)
        if (j === i) el.setAttribute('aria-current', 'true')
        else el.removeAttribute('aria-current')
      })
      moveHighlight()
      const url = new URL(location)
      url.searchParams.set('v', i + 1)
      history.replaceState(null, '', url)
      mount(i)
    }

    items.forEach((el, i) => el.addEventListener('click', () => setActive(i)))
    replay?.addEventListener('click', () => mount(current))
    window.addEventListener('resize', moveHighlight)

    document.addEventListener('keydown', (event) => {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.target.isContentEditable) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const num = Number.parseInt(event.key, 10)
      if (num >= 1 && num <= variants.length) setActive(num - 1)
      else if (event.key === 'ArrowRight') setActive((current + 1) % variants.length)
      else if (event.key === 'ArrowLeft') setActive((current - 1 + variants.length) % variants.length)
      else if (event.key === 'r' || event.key === 'R') mount(current)
      else if (event.key === 'Escape') stage.querySelector('dialog[open]')?.close()
    })

    document.querySelector('[data-close-toast]').addEventListener('click', () => {
      toast.hidden = true
      window.clearTimeout(toastTimer)
    })

    if (variants.length !== items.length) {
      stage.innerHTML = '<p class="prototype-error" role="alert">Não foi possível carregar todas as direções do protótipo.</p>'
      return
    }

    const requestedVariant = Number.parseInt(new URLSearchParams(location.search).get('v'), 10) || 1
    setActive(requestedVariant >= 1 && requestedVariant <= variants.length ? requestedVariant - 1 : 0)
    requestAnimationFrame(() => requestAnimationFrame(() => picker.setAttribute('data-ready', '')))
  })
})()
