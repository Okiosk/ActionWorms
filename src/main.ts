import { Game } from './engine/Game';
import { GameTicker } from './engine/GameTicker';
import { EMPTY_INPUT } from './engine/Worm';
import { NetworkManager } from './net/NetworkManager';
import { HUD } from './ui/HUD';
import { LobbyUI, normalizeRoomId } from './ui/LobbyUI';
import { ShopUI } from './ui/ShopUI';

window.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const hudContainer = document.getElementById('hud-overlay') as HTMLElement;
  const menuContainer = document.getElementById('menu-overlay') as HTMLElement;

  const net = new NetworkManager();
  const game = new Game(canvas, net);
  const hud = new HUD(hudContainer);
  const shop = new ShopUI(hudContainer);
  if (import.meta.env.DEV) Object.assign(window, { game, net }); // console debugging

  // ── Menus ────────────────────────────────────────────────────────────────
  let joinRetry: number | null = null;
  const stopJoinRetry = () => {
    if (joinRetry !== null) clearInterval(joinRetry);
    joinRetry = null;
  };

  const menu = new LobbyUI(menuContainer, game, {
    onHost: async (name) => {
      const code = await net.hostRoom();
      game.openHostLobby(name);
      return code;
    },
    onJoin: async (code, name) => {
      game.prepareClient();
      await net.joinRoom(code);
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          stopJoinRetry();
          reject(new Error("L'hôte ne répond pas."));
        }, 8000);
        game.onWelcome = () => {
          clearTimeout(timeout);
          stopJoinRetry();
          game.onWelcome = undefined;
          resolve();
        };
        const sendJoin = () => net.broadcast({ type: 'JOIN', name });
        sendJoin();
        joinRetry = window.setInterval(sendJoin, 700);
      });
    },
    onLeave: () => {
      stopJoinRetry();
      game.leave();
      shop.hide();
      hud.setVisible(false);
      history.replaceState(null, '', location.pathname + location.search);
    }
  });

  game.onLobbyUpdate = () => menu.refreshLobby();

  game.onMatchStart = () => {
    menu.hide();
    hud.clearKills();
    hud.setVisible(true);
  };

  game.onLocalDeath = (worm) => {
    shop.show(worm, (weaponId) => game.chooseWeapon(weaponId), game.rules.freeSpells);
  };

  game.onKill = (killer, victim, cause, killerId, victimId) =>
    hud.showKill(killer, victim, cause, killerId === game.localId, victimId === game.localId);

  game.onMatchOver = (result) => {
    shop.hide();
    menu.showGameOver(result);
  };

  game.onReturnToLobby = () => {
    shop.hide();
    hud.setVisible(false);
    menu.showLobby();
  };

  game.onDisconnected = () => {
    shop.hide();
    hud.setVisible(false);
    menu.showDisconnected();
  };

  // ── Input ────────────────────────────────────────────────────────────────
  let mouseX = 0;
  let mouseY = 0;
  let mouseLeft = false;
  let mouseRight = false;
  const keys: Record<string, boolean> = {};

  window.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
  });
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) mouseLeft = true;
    if (e.button === 2) mouseRight = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) mouseLeft = false;
    if (e.button === 2) mouseRight = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  const typing = (e: KeyboardEvent) => e.target instanceof HTMLInputElement;
  window.addEventListener('keydown', (e) => {
    if (typing(e)) return;
    keys[e.code] = true;
    if (game.isInMatch() && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      e.preventDefault();
    }
    if (e.code === 'Escape' && game.phase === 'playing') {
      if (menu.currentScreen === 'pause') menu.hide();
      else if (menu.currentScreen === 'hidden') menu.showPause();
    }
  });
  window.addEventListener('keyup', (e) => {
    keys[e.code] = false;
  });
  // Releasing keys while the window is unfocused would leave them stuck
  window.addEventListener('blur', () => {
    for (const k of Object.keys(keys)) keys[k] = false;
    mouseLeft = mouseRight = false;
  });

  function readInput() {
    const local = game.getLocalWorm();
    const blocked = shop.isVisible() || menu.currentScreen !== 'hidden';
    if (!local || !local.isAlive() || blocked) {
      game.localInput = { ...EMPTY_INPUT };
      return;
    }
    const world = game.screenToWorld(mouseX, mouseY);
    game.localInput = {
      left: !!(keys.KeyA || keys.KeyQ || keys.ArrowLeft),
      right: !!(keys.KeyD || keys.ArrowRight),
      up: !!(keys.KeyW || keys.KeyZ || keys.ArrowUp),
      down: !!(keys.KeyS || keys.ArrowDown),
      jump: !!(keys.KeyW || keys.KeyZ || keys.Space || keys.ArrowUp),
      fire: mouseLeft || !!keys.KeyF,
      rope: mouseRight || !!keys.KeyE || !!keys.ShiftLeft || !!keys.ShiftRight,
      aimAngle: Math.atan2(world.y - local.y, world.x - local.x)
    };
  }

  // ── Loops ────────────────────────────────────────────────────────────────
  // Fixed 60 Hz simulation in a worker timer (keeps running in background tabs)
  new GameTicker(() => {
    readInput();
    game.update();
  }).start();

  // Rendering at the display refresh rate, interpolated between ticks
  const renderLoop = (now: number) => {
    if (game.isInMatch()) {
      game.render(now);
      hud.update(game);
    }
    requestAnimationFrame(renderLoop);
  };
  requestAnimationFrame(renderLoop);

  // ── Start ────────────────────────────────────────────────────────────────
  const invite = normalizeRoomId(location.hash.includes('room=') ? location.hash : '');
  if (invite) menu.join(invite);
  else menu.showMainMenu();
});
