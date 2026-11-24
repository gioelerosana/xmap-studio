import { useEffect, useRef } from 'react';
import { AGENT_TOOLS, runAgentTool, type AppController } from '@xmap/core';
import { MCP_DESCRIBE, type McpRendererReply, type McpRendererRequest } from './electronBridge.js';
import { flushInPlaceEdit } from './flushInPlaceEdit.js';
import type { AddToast } from './useToasts.js';

interface McpBridgeOptions {
  controller: AppController;
  activeSheetIndex: number;
  selectedTopicIds: string[];
  setActiveSheetIndex: (index: number) => void;
  selectSingle: (id: string | undefined) => void;
  refreshState: () => void;
  /** Mappa aperta da Nextcloud: "Salva" la riscrive lì anche senza percorso locale. */
  hasCloudFile: boolean;
  writeWorkbook: (force: boolean, saveAs: boolean) => Promise<boolean>;
  addToast: AddToast;
}

/**
 * Collegamento con Claude nell'app desktop: esegue sul controller di questa
 * finestra gli strumenti chiesti dal server MCP (via main process, `mcp-host.ts`).
 * Le modifiche passano dalla stessa cronologia della UI, quindi si annullano con Ctrl+Z.
 */
export function useMcpBridge(options: McpBridgeOptions): void {
  // La sottoscrizione resta una sola: le richieste leggono sempre lo stato più recente.
  const latest = useRef(options);
  latest.current = options;
  const announced = useRef(false);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onMcpRequest || !api.respondMcp) return;
    const respond = api.respondMcp;
    // Una richiesta alla volta: due modifiche concorrenti sulla stessa mappa si pesterebbero i piedi.
    let queue: Promise<void> = Promise.resolve();
    return api.onMcpRequest((request) => {
      queue = queue.then(async () => {
        let reply: McpRendererReply;
        try {
          reply = await handleRequest(request, latest.current, announced);
        } catch (err: unknown) {
          reply = { requestId: request.requestId, ok: false, error: err instanceof Error ? err.message : String(err) };
        }
        respond(reply);
      });
    });
  }, []);
}

async function handleRequest(
  request: McpRendererRequest,
  options: McpBridgeOptions,
  announced: { current: boolean }
): Promise<McpRendererReply> {
  const { controller } = options;
  const { requestId, tool, args } = request;

  if (tool === MCP_DESCRIBE) {
    const wb = controller.workbook();
    return {
      requestId,
      ok: true,
      text: '',
      info: wb ? { fileName: wb.fileName, path: wb.path, dirty: controller.isDirty() } : null,
    };
  }

  const definition = AGENT_TOOLS.find((candidate) => candidate.name === tool);
  if (!definition || definition.scope === 'host') throw new Error(`Strumento sconosciuto: ${tool}`);
  // Un titolo in corso di modifica va confermato prima: altrimenti la modifica di Claude lo perderebbe.
  if (!definition.readOnly) await flushInPlaceEdit();

  if (definition.scope === 'app') return { requestId, ok: true, text: await saveForAgent(options) };

  const result = await runAgentTool(controller, tool, args, {
    activeSheetIndex: options.activeSheetIndex,
    selectedTopicIds: options.selectedTopicIds,
  });
  if (result.changed) {
    options.refreshState();
    if (!announced.current) {
      announced.current = true;
      options.addToast('info', 'Claude sta modificando la mappa: ogni modifica si annulla con Ctrl+Z.');
    }
  }
  if (result.focusTopicId) showTopic(options, result.focusTopicId);
  return { requestId, ok: true, text: result.text };
}

/** Seleziona il blocco e, se serve, passa al suo foglio. */
function showTopic(options: McpBridgeOptions, topicId: string): void {
  const sheet = options.controller.workbook()?.sheets.find((s) => s.topics.some((t) => t.id === topicId));
  if (!sheet) return;
  if (sheet.index !== options.activeSheetIndex) options.setActiveSheetIndex(sheet.index);
  options.selectSingle(topicId);
}

/**
 * "Salva" per conto di Claude: mai dialoghi che l'utente non ha chiesto. Senza
 * file di destinazione o con XMind aperto si rifiuta e lo si dice a Claude.
 */
async function saveForAgent(options: McpBridgeOptions): Promise<string> {
  const { controller } = options;
  const wb = controller.workbook();
  if (!wb) throw new Error('Nessuna mappa aperta in questa finestra.');
  if (wb.path === null && !options.hasCloudFile) {
    throw new Error('La mappa non ha ancora un file: l\'utente deve salvarla la prima volta dall\'app (Salva con nome).');
  }
  if (!controller.isDirty()) return 'Nessuna modifica da salvare.';
  const running = (await window.electronAPI?.checkXMindRunning()) ?? [];
  if (running.length > 0) {
    throw new Error(`XMind è aperto (${running.join(', ')}): salvataggio bloccato. Chiudi XMind o salva dall'app.`);
  }
  const saved = await options.writeWorkbook(false, false);
  if (!saved) throw new Error('Salvataggio non riuscito: il motivo è nel messaggio mostrato nell\'app.');
  return `Mappa salvata in ${wb.path ?? 'Nextcloud'}.`;
}
