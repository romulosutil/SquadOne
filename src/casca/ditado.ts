/**
 * Microfone da folha Pedir: ditado pelo reconhecimento de voz do PRÓPRIO
 * navegador (Web Speech API), em pt-BR, que escreve no campo. Nada de áudio
 * passa pelo servidor do SquadOne. No Chrome e no Safari o navegador manda o
 * áudio ao serviço de voz dele (Google, Apple) — custo da mesma ordem do
 * áudio do Telegram, que já passa pelo Gemini; a folha diz isso enquanto ouve.
 *
 * Sem suporte (Firefox), o botão aparece desabilitado com o motivo escrito:
 * esconder deixaria a pessoa procurando um microfone que não existe.
 */
import { onBeforeUnmount, ref } from 'vue'

interface ResultadoDeFala {
  isFinal: boolean
  0: { transcript: string }
}
interface EventoDeFala {
  resultIndex: number
  results: ArrayLike<ResultadoDeFala>
}
interface Reconhecedor {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((e: EventoDeFala) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
}
type ConstrutorDeReconhecedor = new () => Reconhecedor

function construtor(): ConstrutorDeReconhecedor | null {
  const w = window as unknown as { SpeechRecognition?: ConstrutorDeReconhecedor; webkitSpeechRecognition?: ConstrutorDeReconhecedor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

const MOTIVO_DO_ERRO: Record<string, string> = {
  'not-allowed': 'O navegador não deixou usar o microfone. Libere nas permissões do site.',
  'service-not-allowed': 'O navegador não deixou usar o ditado.',
  'no-speech': 'Não ouvi nada. Toque de novo e fale.',
  'audio-capture': 'Nenhum microfone encontrado.',
  network: 'O ditado do navegador precisa de internet.',
}

/** `aoOuvir` recebe cada trecho FINAL reconhecido; o parcial fica em `parcial`. */
export function useDitado(aoOuvir: (texto: string) => void) {
  const Ctor = construtor()
  const suportado = !!Ctor
  const ouvindo = ref(false)
  const parcial = ref('')
  const erro = ref('')
  let rec: Reconhecedor | null = null

  function parar() {
    rec?.stop()
  }

  function comecar() {
    if (!Ctor || ouvindo.value) return
    erro.value = ''
    parcial.value = ''
    rec = new Ctor()
    rec.lang = 'pt-BR'
    rec.interimResults = true
    rec.continuous = false
    rec.onresult = (e) => {
      let provisorio = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) aoOuvir(r[0].transcript.trim())
        else provisorio += r[0].transcript
      }
      parcial.value = provisorio
    }
    rec.onerror = (e) => {
      erro.value = MOTIVO_DO_ERRO[e.error] ?? `O ditado falhou (${e.error}).`
    }
    rec.onend = () => {
      ouvindo.value = false
      parcial.value = ''
      rec = null
    }
    try {
      rec.start()
      ouvindo.value = true
    } catch (e) {
      erro.value = e instanceof Error ? e.message : String(e)
      rec = null
    }
  }

  const alternar = () => (ouvindo.value ? parar() : comecar())

  onBeforeUnmount(parar)

  return { suportado, ouvindo, parcial, erro, alternar, parar }
}
