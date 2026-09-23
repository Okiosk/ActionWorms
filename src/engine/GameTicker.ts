/**
 * GameTicker: A 60Hz unthrottled ticker powered by a dedicated Web Worker.
 * 
 * Unlike requestAnimationFrame or window.setInterval, Web Workers run in a
 * separate OS thread and are NOT throttled or suspended to 0 FPS when a browser
 * tab is in the background or loses focus.
 * 
 * This ensures that a Host tab running in the background continues to simulate physics
 * and broadcast game state packets uninterrupted, allowing 2 sessions on the same PC
 * or background tabs to function seamlessly.
 */
export class GameTicker {
  private worker: Worker | null = null;
  private onTick: () => void;
  private isRunning: boolean = false;
  private fallbackInterval: number | null = null;

  constructor(onTick: () => void) {
    this.onTick = onTick;
    this.initWorker();
  }

  private initWorker() {
    try {
      const workerCode = `
        let timer = null;
        self.onmessage = function(e) {
          if (e.data === 'start') {
            if (!timer) {
              timer = setInterval(function() {
                postMessage('tick');
              }, 1000 / 60);
            }
          } else if (e.data === 'stop') {
            if (timer) {
              clearInterval(timer);
              timer = null;
            }
          }
        };
      `;

      const blob = new Blob([workerCode], { type: 'application/javascript' });
      const workerUrl = URL.createObjectURL(blob);
      this.worker = new Worker(workerUrl);

      this.worker.onmessage = (e) => {
        if (e.data === 'tick' && this.isRunning) {
          this.onTick();
        }
      };

      this.worker.onerror = (err) => {
        console.warn('GameTicker Web Worker error, falling back to window interval:', err);
        this.destroyWorker();
        this.startFallback();
      };
    } catch (err) {
      console.warn('Could not initialize Web Worker ticker, falling back to interval:', err);
      this.destroyWorker();
    }
  }

  private destroyWorker() {
    if (this.worker) {
      try {
        this.worker.terminate();
      } catch {
        // ignore termination errors
      }
      this.worker = null;
    }
  }

  private startFallback() {
    if (this.fallbackInterval === null && this.isRunning) {
      this.fallbackInterval = window.setInterval(() => {
        if (this.isRunning) {
          this.onTick();
        }
      }, 1000 / 60);
    }
  }

  public start() {
    if (this.isRunning) return;
    this.isRunning = true;

    if (this.worker) {
      this.worker.postMessage('start');
    } else {
      this.startFallback();
    }
  }

  public stop() {
    this.isRunning = false;

    if (this.worker) {
      this.worker.postMessage('stop');
    }

    if (this.fallbackInterval !== null) {
      clearInterval(this.fallbackInterval);
      this.fallbackInterval = null;
    }
  }
}
