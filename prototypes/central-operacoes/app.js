(() => {
  'use strict'

  const variants = []
  let current = 0
  let toastTimer = 0
  let activeView = 'today'
  let projectQuery = ''
  let projectScope = 'all'
  const resolvedReadings = new Set()

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

    function syncUrl() {
      const url = new URL(location)
      url.searchParams.set('v', current + 1)
      if (activeView === 'today') url.searchParams.delete('view')
      else url.searchParams.set('view', activeView)
      history.replaceState(null, '', url)
    }

    function setView(root, view, options = {}) {
      const nextView = root.querySelector(`[data-screen="${view}"]`) ? view : 'today'
      activeView = nextView
      root.querySelectorAll('[data-screen]').forEach((screen) => {
        screen.hidden = screen.dataset.screen !== nextView
      })
      root.querySelectorAll('[data-view]').forEach((control) => {
        const active = control.dataset.view === nextView
        control.classList.toggle('is-active', active)
        if (active) control.setAttribute('aria-current', 'page')
        else control.removeAttribute('aria-current')
      })
      if (options.focus !== false) {
        root.querySelector(`[data-screen="${nextView}"]`)?.querySelector('h1, h2')?.focus({ preventScroll: true })
      }
      if (options.sync !== false) syncUrl()
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
      root.querySelectorAll('[data-project-total]').forEach((node) => {
        node.textContent = `${visible} ${visible === 1 ? 'visível' : 'visíveis'}`
      })

      let empty = root.querySelector('[data-project-empty]')
      if (!empty && input) {
        empty = document.createElement('p')
        empty.className = 'project-empty'
        empty.dataset.projectEmpty = ''
        empty.setAttribute('role', 'status')
        input.closest('[data-screen]')?.append(empty)
      }
      if (empty) {
        empty.hidden = visible !== 0
        empty.textContent = query
          ? `Nenhum projeto corresponde a “${input.value.trim()}”.`
          : 'Nenhum projeto corresponde a este escopo.'
      }
    }

    function updateReadings(root) {
      let open = 0
      root.querySelectorAll('[data-reading]').forEach((item, index) => {
        const id = item.dataset.readingId || `reading-${index + 1}`
        const resolved = resolvedReadings.has(id)
        item.classList.toggle('is-resolved', resolved)
        const action = item.querySelector('[data-resolve-reading]')
        if (action) {
          action.textContent = resolved ? 'Reabrir' : 'Marcar resolvida'
          action.setAttribute('aria-pressed', String(resolved))
        }
        if (!resolved) open += 1
      })
      root.querySelectorAll('[data-reading-count]').forEach((node) => { node.textContent = String(open) })
      root.querySelectorAll('[data-reading-open]').forEach((node) => {
        node.textContent = `${open} ${open === 1 ? 'aberta' : 'abertas'}`
      })
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
          projectScope = scope.dataset.scope
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
          const id = item.dataset.readingId || 'reading-unknown'
          if (resolvedReadings.has(id)) resolvedReadings.delete(id)
          else resolvedReadings.add(id)
          const resolved = resolvedReadings.has(id)
          updateReadings(root)
          showToast(resolved ? 'Leitura marcada como resolvida nesta prévia.' : 'Leitura reaberta nesta prévia.')
          return
        }

        const demo = event.target.closest('[data-demo-action]')
        if (demo) showToast(`${demo.dataset.demoAction}. Nenhum serviço ou dado real foi alterado.`)
      })

      root.addEventListener('input', (event) => {
        if (event.target.matches('[data-project-search]')) {
          projectQuery = event.target.value
          filterProjects(root)
        }
      })

      root.querySelectorAll('[data-project-dialog]').forEach((dialog) => {
        dialog.addEventListener('click', (event) => {
          if (event.target === dialog) dialog.close()
        })
      })

      const search = root.querySelector('[data-project-search]')
      if (search) search.value = projectQuery
      root.querySelectorAll('[data-scope]').forEach((button) => {
        button.setAttribute('aria-pressed', String(button.dataset.scope === projectScope))
      })
      filterProjects(root)
      updateReadings(root)
      setView(root, activeView, { focus: false, sync: false })
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
      syncUrl()
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

    const params = new URLSearchParams(location.search)
    const requestedView = params.get('view')
    if (['today', 'projects', 'readings'].includes(requestedView)) activeView = requestedView
    const requestedVariant = Number.parseInt(params.get('v'), 10) || 1
    setActive(requestedVariant >= 1 && requestedVariant <= variants.length ? requestedVariant - 1 : 0)
    requestAnimationFrame(() => requestAnimationFrame(() => picker.setAttribute('data-ready', '')))
  })
})()
