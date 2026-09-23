import { Game } from './engine/Game';
import { NetworkManager } from './net/NetworkManager';
import { HUD } from './ui/HUD';
import { LobbyUI } from './ui/LobbyUI';
import { WeaponId } from './weapons/WeaponDef';
import { DEFAULT_LOADOUT } from './weapons/WeaponRegistry';

window.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const hudContainer = document.getElementById('hud-overlay') as HTMLElement;
  const menuContainer = document.getElementById('menu-overlay') as HTMLElement;

  const net = new NetworkManager();
  const game = new Game(canvas, net);
  const hud = new HUD(hudContainer);

  let currentP1Loadout: WeaponId[] = [...DEFAULT_LOADOUT];
  let currentP2Loadout: WeaponId[] = [...DEFAULT_LOADOUT];

  // Mouse aim coordinates
  let mouseCanvasX = 0;
  let mouseCanvasY = 0;
  let isMouseDownLeft = false;
  let isMouseDownRight = false;

  // Prevent right-click context menu on canvas
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // Track mouse coordinates mapped to 800x500 canvas resolution
  window.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    mouseCanvasX = (e.clientX - rect.left) * scaleX;
    mouseCanvasY = (e.clientY - rect.top) * scaleY;
  });

  window.addEventListener('mousedown', (e) => {
    if (e.target === canvas) {
      if (e.button === 0) isMouseDownLeft = true;
      if (e.button === 2) isMouseDownRight = true;
    }
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

    // Number keys 1-5 for quick weapon select
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
    const isP2Mode = game.mode === 'local2p';

    // Player 1 Mouse Aim Angle relative to local worm
    let p1AimAngle: number | undefined = undefined;
    if (localWorm && localWorm.isAlive()) {
      p1AimAngle = Math.atan2(mouseCanvasY - localWorm.y, mouseCanvasX - localWorm.x);
    }

    // Player 1 Input (Q/D/Z/S or A/D/W/S + Mouse / Keyboard)
    game.localP1Input = {
      left: !!(keys['KeyA'] || keys['KeyQ'] || (!isP2Mode && keys['ArrowLeft'])),
      right: !!(keys['KeyD'] || (!isP2Mode && keys['ArrowRight'])),
      up: !!(keys['KeyW'] || keys['KeyZ'] || (!isP2Mode && keys['ArrowUp'])),
      down: !!(keys['KeyS'] || (!isP2Mode && keys['ArrowDown'])),
      jump: !!(keys['KeyW'] || keys['KeyZ'] || keys['Space'] || (!isP2Mode && keys['ArrowUp'])),
      fire: isMouseDownLeft || !!keys['Space'] || !!keys['KeyF'] || (!isP2Mode && keys['Enter']),
      rope: isMouseDownRight || !!keys['KeyE'] || !!keys['ShiftLeft'],
      weaponSlot: game.localP1Input.weaponSlot,
      aimAngle: p1AimAngle
    };

    // Player 2 Input (For Local 2P couch play)
    if (isP2Mode) {
      game.localP2Input = {
        left: !!keys['ArrowLeft'],
        right: !!keys['ArrowRight'],
        up: !!keys['ArrowUp'] || !!keys['Numpad8'] || !!keys['KeyI'],
        down: !!keys['ArrowDown'] || !!keys['Numpad2'] || !!keys['KeyK'],
        jump: !!keys['ArrowUp'] || !!keys['Numpad5'],
        fire: !!keys['Enter'] || !!keys['NumpadEnter'] || !!keys['KeyP'],
        rope: !!keys['Numpad0'] || !!keys['ShiftRight'] || !!keys['KeyO'],
        weaponSlot: keys['Numpad1'] ? 0 : keys['Numpad2'] ? 1 : keys['Numpad3'] ? 2 : undefined
      };
    }
  }

  // Setup Lobby UI
  const lobby = new LobbyUI(menuContainer, {
    onStartSolo: (loadout) => {
      currentP1Loadout = loadout;
      game.initMatch('singleplayer', loadout, [...DEFAULT_LOADOUT]);
    },
    onStartLocal2P: (p1Loadout, p2Loadout) => {
      currentP1Loadout = p1Loadout;
      currentP2Loadout = p2Loadout;
      game.initMatch('local2p', p1Loadout, p2Loadout);
    },
    onHostOnline: async (loadout) => {
      currentP1Loadout = loadout;
      const roomId = await net.hostRoom();
      game.initMatch('online_host', loadout);
      return roomId;
    },
    onJoinOnline: async (roomId, loadout) => {
      currentP1Loadout = loadout;
      await net.joinRoom(roomId);
      game.initMatch('online_client', loadout);

      // Reliable handshake retry until WELCOME packet is confirmed
      let welcomeReceived = false;
      game.onWelcomeReceived = () => {
        welcomeReceived = true;
        lobby.hide();
      };

      const sendJoin = () => {
        if (!welcomeReceived && net.isConnected) {
          net.broadcast({
            type: 'JOIN',
            name: 'Invité',
            loadout
          });
          setTimeout(sendJoin, 350);
        }
      };
      sendJoin();
    },
    onRematch: () => {
      game.initMatch(game.mode, currentP1Loadout, currentP2Loadout);
    },
    onReturnToMenu: () => {
      game.isRunning = false;
      net.close();
    }
  });

  // Callbacks from Game Engine & Network
  net.onPeerJoined = (peerId) => {
    lobby.notifyPeerJoined(peerId);
  };

  game.onKillFeed = (killer, victim) => {
    hud.showKill(killer, victim);
  };

  game.onMatchEnd = (winner) => {
    const isP1Winner = winner.id === 'p1' || winner.id === net.myPeerId;
    lobby.showGameOverModal(winner.name, isP1Winner);
  };

  // Check URL hash for direct room invite: #room=liero-xyz
  const hash = window.location.hash;
  if (hash.startsWith('#room=')) {
    const targetRoom = hash.replace('#room=', '').trim();
    if (targetRoom) {
      lobby.showConnectingModal(targetRoom);
    }
  }

  // Main 60 FPS Game Loop
  function gameLoop() {
    processLocalInputs();
    game.update();
    game.render();
    hud.update(game);

    requestAnimationFrame(gameLoop);
  }

  requestAnimationFrame(gameLoop);
});
