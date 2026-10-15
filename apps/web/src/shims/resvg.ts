export class Resvg {
  constructor() {
    throw new Error('Resvg is only available in Node/Desktop environments. The browser uses Canvas rasterization.');
  }
  render() {
    return { asPng: () => new Uint8Array() };
  }
}

export default { Resvg };
