/** Fixtures anteriores a 13/11: exercitam explicitamente a política histórica.
 * O comportamento padrão vigente é coberto em server/envios-sem-travas.test.ts.
 * Cada arquivo de node:test roda em processo próprio; isto nunca entra no app.
 */
import politica from '../../config/politica-envios.json'
import { REGRAS_DO_RITMO } from '../operations/trava-de-ritmo'
politica.limitesOperacionais = true
REGRAS_DO_RITMO.habilitado = true
