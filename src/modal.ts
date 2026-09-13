/**
 * Fechar modal pelo Esc, com a mesma trava do overlay. Listener na janela, não
 * no elemento: com o foco fora do formulário o keydown nunca chegaria ao modal.
 *
 * `podeFechar` existe porque fechar no meio de um envio deixava a resposta
 * atrasada agir sobre a tela seguinte: o usuário achava que cancelou algo que
 * o servidor já estava gravando.
 */
import { onBeforeUnmount, onMounted } from 'vue'

export function useFecharComEsc(podeFechar: () => boolean, fechar: () => void): void {
  const aoTeclar = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !podeFechar()) return
    e.preventDefault()
    fechar()
  }
  onMounted(() => window.addEventListener('keydown', aoTeclar))
  onBeforeUnmount(() => window.removeEventListener('keydown', aoTeclar))
}
