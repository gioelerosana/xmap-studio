import { describe, expect, it } from 'vitest';
import { isXmindInvocation } from '../src/index.js';

describe('isXmindInvocation', () => {
  it('riconosce XMind anche se apre un file nella cartella di XMap Studio', () => {
    expect(isXmindInvocation('xmind /home/u/progetti/xmap-studio/x.xmind')).toBe(true);
    expect(isXmindInvocation(['/opt/Xmind/xmind', '/home/u/xmap-studio/demo.xmind'])).toBe(true);
  });

  it('riconosce il Flatpak e i suoi lanciatori', () => {
    expect(isXmindInvocation('/app/main/xmind --type=renderer')).toBe(true);
    expect(isXmindInvocation('bwrap --args 34 /app/main/xmind /some/file.xmind')).toBe(true);
    expect(isXmindInvocation('/usr/bin/flatpak run net.xmind.XMind')).toBe(true);
    expect(isXmindInvocation('/usr/bin/flatpak run net.xmind.XMind//stable')).toBe(true);
  });

  it('esclude la nostra app e i suoi nomi storici', () => {
    expect(isXmindInvocation('/home/u/progetti/xmap-studio/target/debug/xmap-studio')).toBe(false);
    expect(isXmindInvocation('/home/u/xmind-LaTeX/target/debug/xmind-equation-studio')).toBe(false);
    expect(isXmindInvocation('/tmp/appimage_extracted_abc/xmind')).toBe(false);
  });

  it('ignora processi che hanno XMind solo negli argomenti', () => {
    expect(isXmindInvocation('vim xmind')).toBe(false);
    expect(isXmindInvocation('/usr/bin/node gen.mjs /tmp/net.xmind.XMind/x')).toBe(false);
    expect(isXmindInvocation('/usr/bin/flatpak run org.other.App net.xmind.XMind.txt')).toBe(false);
    expect(isXmindInvocation('/usr/lib/firefox/firefox')).toBe(false);
    expect(isXmindInvocation([])).toBe(false);
  });
});
