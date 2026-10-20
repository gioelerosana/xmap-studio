import { useCallback, useEffect, useState } from 'react';
import { INSPECTOR_PANEL, usePanelWidth } from '../components/usePanelWidth.js';
import { COMPACT_QUERY } from './constants.js';
import { useMediaQuery } from './useMediaQuery.js';

/**
 * Pannello dettagli (Inspector). Smartphone: il tap seleziona soltanto, il pannello
 * (bottom sheet) si apre su richiesta per non coprire la mappa a ogni tocco.
 * Su desktop la selezione apre i dettagli solo se l'impostazione lo chiede.
 */
export function useDetailsPanel(selectedTopicId: string | undefined, detailsOnSelect: boolean) {
  const [inspectorWidth, setInspectorWidth] = usePanelWidth(
    INSPECTOR_PANEL.storageKey,
    INSPECTOR_PANEL.defaultWidth,
    INSPECTOR_PANEL.min,
    INSPECTOR_PANEL.max,
  );
  const compact = useMediaQuery(COMPACT_QUERY);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsClosed, setDetailsClosed] = useState(false);
  const inspectorVisible = Boolean(selectedTopicId) && (compact ? detailsOpen : !detailsClosed && (detailsOpen || detailsOnSelect));

  useEffect(() => {
    setDetailsClosed(false);
    if (!selectedTopicId) setDetailsOpen(false);
  }, [selectedTopicId]);

  const showDetails = useCallback(() => {
    setDetailsClosed(false);
    setDetailsOpen(true);
  }, []);

  const hideDetails = useCallback(() => {
    setDetailsClosed(true);
    setDetailsOpen(false);
  }, []);

  const toggleDetails = useCallback(() => {
    if (!selectedTopicId) return;
    if (inspectorVisible) hideDetails();
    else showDetails();
  }, [selectedTopicId, inspectorVisible, hideDetails, showDetails]);

  return { inspectorWidth, setInspectorWidth, inspectorVisible, showDetails, hideDetails, toggleDetails };
}
