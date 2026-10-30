import React from 'react';
import { Modal } from '@xmap/ui-kit';
import { PrintPanel, type PrintPanelProps } from './PrintPanel.js';

export interface PrintModalProps extends Omit<PrintPanelProps, 'mode' | 'onDone'> {
  isOpen: boolean;
  onClose: () => void;
}

/** Finestra «Stampa mappa» (Ctrl+P). Il PDF si salva anche da «Esporta». */
export const PrintModal: React.FC<PrintModalProps> = ({ isOpen, onClose, ...panelProps }) => (
  <Modal isOpen={isOpen} onClose={onClose} title="Stampa mappa" size="lg">
    <PrintPanel mode="print" onDone={onClose} {...panelProps} />
  </Modal>
);
