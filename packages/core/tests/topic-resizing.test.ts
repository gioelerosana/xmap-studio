import { describe, expect, it } from 'vitest';
import {
  AppController,
  CODE_INVALID_INPUT,
  CODE_TOPIC_NOT_FOUND,
  Topic,
  errorCode,
  estimateNodeSize,
  setTopicCustomWidth,
  setTopicImageSize,
} from '../src/index.js';
import { minimalXmind } from './helpers.js';

describe('funzioni pure setTopicCustomWidth e setTopicImageSize', () => {
  it('setTopicCustomWidth imposta e arrotonda la larghezza', () => {
    const topic: Topic = { id: 't1', title: 'Test', customProp: 'preserve-me' };
    setTopicCustomWidth(topic, 240.6);
    expect(topic.customWidth).toBe(241);
    expect(topic['customProp']).toBe('preserve-me');
  });

  it('setTopicCustomWidth con null o undefined rimuove customWidth', () => {
    const topic: Topic = { id: 't1', title: 'Test', customWidth: 300, unknownField: 42 };
    setTopicCustomWidth(topic, null);
    expect(topic.customWidth).toBeUndefined();
    expect('customWidth' in topic).toBe(false);
    expect(topic['unknownField']).toBe(42);

    topic.customWidth = 180;
    setTopicCustomWidth(topic, undefined);
    expect(topic.customWidth).toBeUndefined();
  });

  it('setTopicCustomWidth valida il parametro width', () => {
    const topic: Topic = { id: 't1', title: 'Test' };
    expect(() => setTopicCustomWidth(topic, 0)).toThrow();
    expect(() => setTopicCustomWidth(topic, -50)).toThrow();
    expect(() => setTopicCustomWidth(topic, NaN)).toThrow();
  });

  it('setTopicImageSize imposta larghezza e altezza preservando le altre chiavi di image', () => {
    const topic: Topic = {
      id: 't1',
      title: 'Immagine',
      image: {
        src: 'xap:resources/abc.png',
        align: 'center',
        lockRatio: true,
        customExtra: 'mantieni',
      },
    };
    setTopicImageSize(topic, { width: 320.4, height: 240.2 });
    expect(topic.image?.width).toBe(320);
    expect(topic.image?.height).toBe(240);
    expect(topic.image?.src).toBe('xap:resources/abc.png');
    expect(topic.image?.['align']).toBe('center');
    expect(topic.image?.['lockRatio']).toBe(true);
    expect(topic.image?.['customExtra']).toBe('mantieni');
  });

  it('setTopicImageSize fallisce su immagini MathJax (schema sacro)', () => {
    const topic: Topic = {
      id: 't1',
      title: 'Formula',
      image: {
        src: 'xap:resources/formula.png',
        isMathJaxImage: true,
      },
    };
    try {
      setTopicImageSize(topic, { width: 200, height: 100 });
      expect.fail('doveva lanciare un errore');
    } catch (err) {
      expect(errorCode(err)).toBe(CODE_INVALID_INPUT);
    }
  });

  it('setTopicImageSize fallisce se il topic non ha immagine o i valori sono non validi', () => {
    const topicWithoutImage: Topic = { id: 't1', title: 'Senza immagine' };
    expect(() => setTopicImageSize(topicWithoutImage, { width: 100, height: 100 })).toThrow();

    const topicWithImage: Topic = { id: 't2', image: { src: 'xap:resources/a.png' } };
    expect(() => setTopicImageSize(topicWithImage, { width: -10, height: 100 })).toThrow();
    expect(() => setTopicImageSize(topicWithImage, { width: 100, height: 0 })).toThrow();
    expect(() => setTopicImageSize(topicWithImage, { width: NaN, height: 100 })).toThrow();
  });
});

describe('AppController setTopicCustomWidth e setTopicImageSize', () => {
  it('modifica customWidth e supporta undo e redo in un solo passo', async () => {
    const ctrl = new AppController();
    await ctrl.open(await minimalXmind());

    const updated = ctrl.setTopicCustomWidth('a', 220);
    const view = updated.sheets[0].topics.find((t) => t.id === 'a');
    expect(view?.customWidth).toBe(220);

    // Rimozione tramite null
    const cleared = ctrl.setTopicCustomWidth('a', null);
    const viewCleared = cleared.sheets[0].topics.find((t) => t.id === 'a');
    expect(viewCleared?.customWidth).toBeUndefined();

    // Undo ripristina 220
    const undone = ctrl.undo();
    const viewUndone = undone.sheets[0].topics.find((t) => t.id === 'a');
    expect(viewUndone?.customWidth).toBe(220);

    // Undo torna allo stato iniziale
    const initial = ctrl.undo();
    expect(initial.sheets[0].topics.find((t) => t.id === 'a')?.customWidth).toBeUndefined();

    // Redo
    const redone = ctrl.redo();
    expect(redone.sheets[0].topics.find((t) => t.id === 'a')?.customWidth).toBe(220);
  });

  it('modifica dimensioni immagine e supporta undo', async () => {
    const ctrl = new AppController();
    await ctrl.open(
      await minimalXmind([
        {
          id: 's1',
          class: 'sheet',
          title: 'Foglio',
          rootTopic: {
            id: 'r',
            class: 'topic',
            title: 'Radice',
            children: {
              attached: [
                {
                  id: 'img-node',
                  title: '',
                  image: {
                    src: 'xap:resources/foto.png',
                    width: 150,
                    height: 100,
                    customKey: 'xmind-prop',
                  },
                },
              ],
            },
          },
        },
      ])
    );

    const updated = ctrl.setTopicImageSize('img-node', { width: 300, height: 200 });
    const view = updated.sheets[0].topics.find((t) => t.id === 'img-node');
    expect(view?.imageW).toBe(300);
    expect(view?.imageH).toBe(200);

    const undone = ctrl.undo();
    const viewUndone = undone.sheets[0].topics.find((t) => t.id === 'img-node');
    expect(viewUndone?.imageW).toBe(150);
    expect(viewUndone?.imageH).toBe(100);
  });

  it('lancia errore se il topic non esiste', async () => {
    const ctrl = new AppController();
    await ctrl.open(await minimalXmind());
    expect(() => ctrl.setTopicCustomWidth('non-esistente', 200)).toThrowError(
      expect.objectContaining({ code: CODE_TOPIC_NOT_FOUND })
    );
  });
});

describe('adattamento testo e misura layout', () => {
  it('senza customWidth il blocco si stringe perfettamente sul testo (nessuno spazio vuoto)', () => {
    // Parola breve: deve essere ben sotto la soglia fissa precedente di 96px
    const sizeShort = estimateNodeSize({ depth: 2, title: 'Ciao' });
    expect(sizeShort.w).toBeLessThan(60);
    expect(sizeShort.w).toBeGreaterThanOrEqual(40);
    expect(sizeShort.h).toBe(36);
  });

  it('per righe multiple senza customWidth il blocco è largo quanto la riga più lunga', () => {
    const multiLineWithNewline = estimateNodeSize({
      depth: 2,
      title: 'Riga uno breve\nSeconda riga molto più estesa ma entro limite',
    });
    // Non deve espandersi a 360 px, ma adattarsi alla riga più lunga (+ padding)
    expect(multiLineWithNewline.w).toBeLessThan(350);
    expect(multiLineWithNewline.w).toBeGreaterThan(180);
    expect(multiLineWithNewline.h).toBeGreaterThanOrEqual(52);
  });

  it('con customWidth il blocco mantiene la larghezza scelta e manda a capo il testo', () => {
    const longText = 'Questo è un testo abbastanza lungo da andare a capo se la larghezza viene ridotta';
    const autoFit = estimateNodeSize({ depth: 2, title: longText });
    
    // Riducendo la larghezza a 140px, il testo deve andare a capo aumentando l\'altezza
    const customFit = estimateNodeSize({ depth: 2, title: longText, customWidth: 140 });
    expect(customFit.w).toBe(140);
    expect(customFit.h).toBeGreaterThan(autoFit.h);
  });

  it('misura le immagini in base alle dimensioni specificate', () => {
    const size = estimateNodeSize({
      depth: 2,
      kind: 'image',
      imageW: 250,
      imageH: 180,
    });
    expect(size.w).toBe(250 + 24);
    expect(size.h).toBe(180 + 18);
  });
});
