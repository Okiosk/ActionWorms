import { Game } from './engine/Game';
import { GameTicker } from './engine/GameTicker';
import { NetworkManager } from './net/NetworkManager';
import { HUD } from './ui/HUD';
import { LobbyUI, normalizeRoomId } from './ui/LobbyUI';
import { WeaponId } from './weapons/WeaponDef';
import { DEFAULT_LOADOUT } from './weapons/WeaponRegistry';

window.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const hudContainer = document.getElementById('hud-overlay') as HTMLElement;
  const menuContainer = document.getElementById('menu-overlay') as HTMLElement;

  const net = new NetworkManager();
  const game = new Game(canvas, net);
  const hud = new HUD(hudContainer);

  (window as any).game = game;
  (window as any).net = net;

  let currentLoadout: WeaponId[] = [...DEFAULT_LOADOUT];

  // Track raw mouse screen position (world coords computed per-frame via screenToWorld)
  let mouseScreenX = 0;
  let mouseScreenY = 0;

  window.addEventListener('mousemove', (e) => {
    mouseScreenX = e.clientX;
    mouseScreenY = e.clientY;
  });

  let isMouseDownLeft = false;
  let isMouseDownRight = false;

  // Prevent right-click context menu on canvas
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('mousedown', (e) => {
    if (e.button === 0) isMouseDownLeft = true;
    if (e.button === 2) isMouseDownRight = true;
  });

  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) isMouseDownLeft = false;
    if (e.button === 2) isMouseDownRight = false;
  });

  // Mouse wheel weapon switching
  window.addEventListener('wheel', (e) => {
    if (game.worms.length > 0 && game.isRunning) {
      const localWorm = game.getLocalWorm();
      if (localWorm && localWorm.isAlive()) {
        const nextIdx = e.deltaY > 0
          ? (localWorm.currentWeaponIndex + 1) % localWorm.weapons.length
          : (localWorm.currentWeaponIndex - 1 + localWorm.weapons.length) % localWorm.weapons.length;
        localWorm.selectWeapon(nextIdx);
        game.localP1Input.weaponSlot = nextIdx;
      }
    }
  });

  // Keyboard state tracking (supports AZERTY and QWERTY)
  const keys: Record<string, boolean> = {};

  window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].includes(e.code)) {
      const slot = parseInt(e.code.replace('Digit', '')) - 1;
      game.localP1Input.weaponSlot = slot;
    }
  });

  window.addEventListener('keyup', (e) => {
    keys[e.code] = false;
    if (['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].includes(e.code)) {
      game.localP1Input.weaponSlot = undefined;
    }
  });

  function processLocalInputs() {
    if (!game.isRunning || game.worms.length === 0) return;

    const localWorm = game.getLocalWorm();

    // Mouse Aim Angle: convert screen pixels → world coords via camera transform
    let p1AimAngle: number | undefined = undefined;
    if (localWorm && localWorm.isAlive()) {
      const world = game.screenToWorld(mouseScreenX, mouseScreenY);
      p1AimAngle = Math.atan2(world.y - localWorm.y, world.x - localWorm.x);
    }

    // Local Player Input (WASD / ZQSD / Arrow keys + Mouse)
    game.localP1Input = {
      left: !!(keys['KeyA'] || keys['KeyQ'] || keys['ArrowLeft']),
      right: !!(keys['KeyD'] || keys['ArrowRight']),
      up: !!(keys['KeyW'] || keys['KeyZ'] || keys['ArrowUp']),
      down: !!(keys['KeyS'] || keys['ArrowDown']),
      jump: !!(keys['KeyW'] || keys['KeyZ'] || keys['Space'] || keys['ArrowUp']),
      fire: isMouseDownLeft || !!keys['KeyF'] || !!keys['Enter'],
      rope: isMouseDownRight || !!keys['KeyE'] || !!keys['ShiftLeft'] || !!keys['ShiftRight'],
      weaponSlot: game.localP1Input.weaponSlot,
      aimAngle: p1AimAngle
    };
  }

  // Setup Lobby UI
  const lobby = new LobbyUI(menuContainer, {
    onHostOnline: async (name, loadout, modifiers) => {
      currentLoadout = loadout;
      const roomId = await net.hostRoom();
      game.initMatch('online_host', loadout, name, modifiers);
      return roomId;
    },
    onJoinOnline: async (rawRoomId, name, loadout) => {
      const roomId = normalizeRoomId(rawRoomId);
      currentLoadout = loadout;
      await net.joinRoom(roomId);
      game.initMatch('online_client', loadout, name);

      // Return a Promise that resolves when WELCOME is received from Host
      return new Promise<void>((resolve, reject) => {
        let welcomeReceived = false;

        const timeout = setTimeout(() => {
          if (!welcomeReceived) {
            reject(new Error('Délai dépassé (8s) : L\'hôte n\'a pas répondu au handshake.'));
          }
        }, 8000);

        game.onWelcomeReceived = () => {
          welcomeReceived = true;
          clearTimeout(timeout);
          resolve();
        };

        const sendJoin = () => {
          if (!welcomeReceived && net.isConnected) {
            net.broadcast({
              type: 'JOIN',
              name,
              loadout
            });
            setTimeout(sendJoin, 300);
          }
        };
        sendJoin();
      });
    },
    onStartMatch: () => {
      game.startHostMatch();
    },
    onModifierChanged: (mods) => {
      game.setModifiers(mods);
    },
    onRematch: () => {
      if (game.mode === 'online_host') {
        game.startHostMatch();
      }
    },
    onReturnToMenu: () => {
      game.isRunning = false;
      net.close();
    }
  });

  // Callbacks from Game Engine & Network
  game.onLobbyUpdate = (players, modifiers) => {
    lobby.updateLobbyState(players, modifiers);
  };

  game.onStartMatchReceived = (_modifiers) => {
    lobby.hide();
  };

  game.onKillFeed = (killer, victim) => {
    hud.showKill(killer, victim);
  };

  game.onMatchEnd = (winner) => {
    const isP1Winner = winner.id === net.myPeerId;
    lobby.showGameOverModal(winner.name, isP1Winner);
  };

  // Check URL hash for direct room invite: #room=liero-xyz
  const hash = window.location.hash;
  if (hash.includes('room=')) {
    const targetRoom = normalizeRoomId(hash);
    if (targetRoom) {
      lobby.showConnectingModal(targetRoom);
    }
  }

  // Unthrottled 60Hz physics and network ticker
  const ticker = new GameTicker(() => {
    if (game.isRunning) {
      processLocalInputs();
      game.update();
    }
  });
  ticker.start();

  // Rendering loop (runs on requestAnimationFrame, decoupled from physics)
  function renderLoop() {
    if (game.isRunning) {
      game.updateCamera(); // smooth camera follow (render-rate, not physics-rate)
      game.render();
      hud.update(game);
    }
    requestAnimationFrame(renderLoop);
  }

  requestAnimationFrame(renderLoop);
});
