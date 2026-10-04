/**
 * 60 Hz ticker driven by a Web Worker timer.
 *
 * Unlike requestAnimationFrame, worker timers keep running when the tab is in the
 * background, so a host in a hidden tab keeps simulating and broadcasting the game.
 */
export class GameTicker {
  private onTick: () => void;

  constructor(onTick: () => void) {
    this.onTick = onTick;
  }

  public start() {
    try {
      const code = `setInterval(() => postMessage(0), ${1000 / 60});`;
      const worker = new Worker(URL.createObjectURL(new Blob([code], { type: 'application/javascript' })));
      worker.onmessage = () => this.onTick();
      worker.onerror = () => {
        worker.terminate();
        this.startFallback();
      };
    } catch {
      this.startFallback();
    }
  }

  private startFallback() {
    window.setInterval(() => this.onTick(), 1000 / 60);
  }
}
