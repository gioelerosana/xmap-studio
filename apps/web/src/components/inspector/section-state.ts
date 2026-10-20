// Stato aperto/chiuso delle sezioni, ricordato tra una selezione e l'altra
// (in memoria e in localStorage); il default vale solo finché l'utente non sceglie.
const SECTIONS_STORAGE_KEY = 'xmap-studio.inspector-sections';
let sectionState: Record<string, boolean> | null = null;

export function loadSectionState(): Record<string, boolean> {
  if (sectionState) return sectionState;
  const state: Record<string, boolean> = {};
  sectionState = state;
  try {
    const raw = window.localStorage.getItem(SECTIONS_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object') {
      for (const [k, v] of Object.entries(parsed)) if (typeof v === 'boolean') state[k] = v;
    }
  } catch {
    // localStorage non disponibile o contenuto corrotto: si riparte dai default.
  }
  return state;
}

export function saveSectionState(key: string, open: boolean) {
  const state = loadSectionState();
  state[key] = open;
  try {
    window.localStorage.setItem(SECTIONS_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Salvataggio best-effort: lo stato in memoria resta valido.
  }
}
