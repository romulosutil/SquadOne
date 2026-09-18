<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { LocalProject, ProjectInput } from './types'

const props = defineProps<{ open: boolean; project: LocalProject | null; saving: boolean; error: string }>()
const emit = defineEmits<{ close: []; save: [input: ProjectInput]; remove: [project: LocalProject] }>()
const dialog = ref<HTMLDialogElement | null>(null)
const name = ref('')
const target = ref('')
const description = ref('')
const category = ref('')
const pinned = ref(false)

watch(() => props.open, async open => {
  if (open) {
    name.value = props.project?.name ?? ''
    target.value = props.project?.target ?? ''
    description.value = props.project?.description ?? ''
    category.value = props.project?.category ?? ''
    pinned.value = props.project?.pinned ?? false
    await nextTick()
    if (dialog.value && !dialog.value.open) dialog.value.showModal()
  } else if (dialog.value?.open) dialog.value.close()
})

const submit = () => emit('save', { name: name.value, description: description.value, category: category.value, pinned: pinned.value, target: target.value })
const close = () => { if (!props.saving) emit('close') }
</script>

<template>
  <dialog ref="dialog" class="ops-dialog" aria-labelledby="project-dialog-title" @cancel.prevent="close" @close="emit('close')">
    <form method="dialog" @submit.prevent="submit">
      <div class="ops-dialog__heading">
        <div><span>Atalho local</span><h2 id="project-dialog-title">{{ project ? 'Editar projeto' : 'Adicionar projeto' }}</h2></div>
        <button type="button" aria-label="Fechar" :disabled="saving" @click="close">×</button>
      </div>

      <label for="project-name">Nome</label>
      <input id="project-name" v-model="name" required maxlength="80" autocomplete="off" />

      <label for="project-description">Descrição <small>opcional</small></label>
      <input id="project-description" v-model="description" maxlength="240" autocomplete="off" placeholder="O que você acompanha neste projeto" />

      <label for="project-category">Categoria <small>opcional</small></label>
      <input id="project-category" v-model="category" maxlength="60" autocomplete="off" placeholder="Ex.: SaaS, Conteúdo, Cliente" />

      <label for="project-target">Caminho ou link</label>
      <input id="project-target" v-model="target" required maxlength="1000" autocomplete="off" aria-describedby="project-target-hint" />
      <p id="project-target-hint">Use uma URL http/https ou um caminho Linux absoluto, começando com /.</p>

      <label class="ops-checkbox"><input v-model="pinned" type="checkbox"> <span>Fixar este projeto na página Hoje</span></label>

      <p v-if="error" class="ops-form-error" role="alert">{{ error }}</p>

      <div class="ops-dialog__actions">
        <button v-if="project" type="button" class="ops-button ops-button--danger" :disabled="saving" @click="emit('remove', project)">Excluir projeto</button>
        <span />
        <button type="button" class="ops-button ops-button--ghost" :disabled="saving" @click="close">Manter como está</button>
        <button type="submit" class="ops-button ops-button--primary" :disabled="saving">
          {{ saving ? 'Salvando…' : project ? 'Salvar alterações' : 'Adicionar projeto' }}
        </button>
      </div>
    </form>
  </dialog>
</template>
