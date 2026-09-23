import { ALL_WEAPON_IDS, WEAPON_REGISTRY, DEFAULT_LOADOUT } from '../weapons/WeaponRegistry';
import { WeaponId } from '../weapons/WeaponDef';
import { GameMode } from '../engine/Game';

export interface LobbyCallbacks {
  onStartSolo: (loadout: WeaponId[]) => void;
  onStartLocal2P: (p1Loadout: WeaponId[], p2Loadout: WeaponId[]) => void;
  onHostOnline: (loadout: WeaponId[]) => Promise<string>;
  onJoinOnline: (roomId: string, loadout: WeaponId[]) => Promise<void>;
  onRematch: () => void;
  onReturnToMenu: () => void;
}

export class LobbyUI {
  private container: HTMLElement;
  private callbacks: LobbyCallbacks;

  // Selected 5-weapon loadout
  public selectedLoadout: WeaponId[] = [...DEFAULT_LOADOUT];

  constructor(container: HTMLElement, callbacks: LobbyCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.showMainMenu();
  }

  public showMainMenu() {
    this.container.innerHTML = `
      <div class="menu-card main-menu">
        <h1 class="game-title">ACTION WORMS</h1>
        <p class="subtitle">L'arène souterraine en temps réel • Multijoueur P2P & Solo</p>

        <div class="menu-buttons">
          <button class="btn btn-primary" id="btn-solo">🤖 Partie Solo vs IA</button>
          <button class="btn btn-secondary" id="btn-local">👥 2 Joueurs Local (1 Clavier)</button>
          <div class="divider"><span>EN LIGNE (PEER-TO-PEER)</span></div>
          <button class="btn btn-accent" id="btn-host">🌐 Créer un Salon P2P (Hôte)</button>
          <div class="join-row">
            <input type="text" id="input-room-code" placeholder="Code du salon (ex: liero-xxx)" />
            <button class="btn btn-join" id="btn-join">Rejoindre</button>
          </div>
        </div>

        <div class="loadout-preview">
          <div class="loadout-header">
            <span>Arsenal actuel (5 armes)</span>
            <button class="btn-text" id="btn-edit-loadout">Modifier l'arsenal ⚙️</button>
          </div>
          <div class="loadout-icons" id="loadout-icons-preview">
            ${this.renderLoadoutIcons()}
          </div>
        </div>

        <div class="footer-tip">
          100% sans serveur • Connexion directe WebRTC entre navigateurs
        </div>
      </div>
    `;

    this.container.querySelector('#btn-solo')?.addEventListener('click', () => {
      this.hide();
      this.callbacks.onStartSolo(this.selectedLoadout);
    });

    this.container.querySelector('#btn-local')?.addEventListener('click', () => {
      this.hide();
      this.callbacks.onStartLocal2P(this.selectedLoadout, [...DEFAULT_LOADOUT]);
    });

    this.container.querySelector('#btn-host')?.addEventListener('click', async () => {
      this.showHostLobby();
    });

    this.container.querySelector('#btn-join')?.addEventListener('click', async () => {
      const input = this.container.querySelector('#input-room-code') as HTMLInputElement;
      const code = input.value.trim();
      if (!code) {
        alert('Veuillez entrer un code de salon.');
        return;
      }
      this.showConnectingModal(code);
    });

    this.container.querySelector('#btn-edit-loadout')?.addEventListener('click', () => {
      this.showWeaponSelectModal();
    });
  }

  public showWeaponSelectModal() {
    this.container.innerHTML = `
      <div class="menu-card weapon-select-card">
        <h2>Choisissez vos 5 Armes</h2>
        <p class="subtitle">Sélectionnez exactement 5 armes pour constituer votre paquetage de combat.</p>

        <div class="weapon-grid">
          ${ALL_WEAPON_IDS.map(id => {
            const wep = WEAPON_REGISTRY[id];
            const isSelected = this.selectedLoadout.includes(id);
            return `
              <div class="weapon-card ${isSelected ? 'selected' : ''}" data-id="${id}">
                <div class="weapon-card-icon">${wep.icon}</div>
                <div class="weapon-card-body">
                  <div class="weapon-card-title">${wep.name}</div>
                  <div class="weapon-card-desc">${wep.description}</div>
                  <div class="weapon-card-stats">
                    <span>Dégâts : ${wep.damage}</span>
                    <span>Cratère : ${wep.craterRadius}px</span>
                  </div>
                </div>
                <div class="weapon-check">${isSelected ? '✓' : '+'}</div>
              </div>
            `;
          }).join('')}
        </div>

        <div class="weapon-select-footer">
          <span id="loadout-counter">Armes sélectionnées : ${this.selectedLoadout.length} / 5</span>
          <button class="btn btn-primary" id="btn-save-loadout" ${this.selectedLoadout.length === 5 ? '' : 'disabled'}>Confirmer l'arsenal</button>
        </div>
      </div>
    `;

    const cards = this.container.querySelectorAll('.weapon-card');
    cards.forEach(c => {
      c.addEventListener('click', () => {
        const id = c.getAttribute('data-id') as WeaponId;
        const idx = this.selectedLoadout.indexOf(id);

        if (idx !== -1) {
          if (this.selectedLoadout.length > 1) {
            this.selectedLoadout.splice(idx, 1);
          }
        } else {
          if (this.selectedLoadout.length < 5) {
            this.selectedLoadout.push(id);
          }
        }
        this.showWeaponSelectModal();
      });
    });

    this.container.querySelector('#btn-save-loadout')?.addEventListener('click', () => {
      this.showMainMenu();
    });
  }

  public async showHostLobby() {
    this.container.innerHTML = `
      <div class="menu-card lobby-card">
        <h2>Salon Multijoueur P2P</h2>
        <p class="subtitle">En attente de connexion du pair...</p>

        <div class="room-code-box">
          <span class="room-label">Code du salon :</span>
          <span class="room-code-val" id="room-code-display">Génération...</span>
          <button class="btn btn-secondary btn-sm" id="btn-copy-link">📋 Copier le lien d'invitation</button>
        </div>

        <div class="connection-status" id="lobby-status">
          <div class="spinner"></div>
          <span>Création du canal WebRTC...</span>
        </div>

        <div class="menu-buttons">
          <button class="btn btn-secondary" id="btn-cancel-host">Annuler</button>
        </div>
      </div>
    `;

    this.container.querySelector('#btn-cancel-host')?.addEventListener('click', () => {
      this.callbacks.onReturnToMenu();
      this.showMainMenu();
    });

    try {
      const roomId = await this.callbacks.onHostOnline(this.selectedLoadout);
      const codeDisplay = this.container.querySelector('#room-code-display');
      const statusDisplay = this.container.querySelector('#lobby-status');

      if (codeDisplay) codeDisplay.textContent = roomId;
      if (statusDisplay) {
        statusDisplay.innerHTML = `
          <div class="status-badge waiting">En attente d'un adversaire...</div>
          <p class="share-hint">Envoyez le code ou le lien à votre ami pour qu'il rejoigne la partie.</p>
        `;
      }

      const copyBtn = this.container.querySelector('#btn-copy-link');
      copyBtn?.addEventListener('click', () => {
        const fullUrl = `${window.location.origin}${window.location.pathname}#room=${roomId}`;
        navigator.clipboard.writeText(fullUrl);
        copyBtn.textContent = '✅ Lien copié !';
        setTimeout(() => {
          if (copyBtn) copyBtn.textContent = '📋 Copier le lien d\'invitation';
        }, 2000);
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      alert('Impossible d\'ouvrir le salon : ' + errorMsg);
      this.showMainMenu();
    }
  }

  public notifyPeerJoined(peerId: string) {
    const statusDisplay = this.container.querySelector('#lobby-status');
    if (statusDisplay) {
      statusDisplay.innerHTML = `
        <div class="status-badge" style="background:#1d4a25; color:#44ff66; border:1px solid #33aa44; padding:6px 14px; border-radius:4px; font-size:18px;">
          ✅ Adversaire connecté (${peerId}) ! Lancement du combat...
        </div>
      `;
      setTimeout(() => {
        this.hide();
      }, 1200);
    } else {
      this.hide();
    }
  }

  public async showConnectingModal(roomId: string) {
    this.container.innerHTML = `
      <div class="menu-card lobby-card">
        <h2>Connexion au Salon</h2>
        <p class="subtitle">Connexion directe P2P vers <b>${roomId}</b></p>

        <div class="connection-status">
          <div class="spinner"></div>
          <span>Établissement du tunnel WebRTC...</span>
        </div>

        <div class="menu-buttons">
          <button class="btn btn-secondary" id="btn-cancel-join">Annuler</button>
        </div>
      </div>
    `;

    this.container.querySelector('#btn-cancel-join')?.addEventListener('click', () => {
      this.callbacks.onReturnToMenu();
      this.showMainMenu();
    });

    try {
      await this.callbacks.onJoinOnline(roomId, this.selectedLoadout);
      this.hide();
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      alert('Échec de la connexion : ' + errorMsg);
      this.showMainMenu();
    }
  }

  public showGameOverModal(winnerName: string, isVictory: boolean) {
    this.container.style.display = 'flex';
    this.container.innerHTML = `
      <div class="menu-card gameover-card">
        <h1 class="${isVictory ? 'victory-title' : 'defeat-title'}">${isVictory ? '🏆 VICTOIRE !' : '💀 DÉFAITE !'}</h1>
        <p class="subtitle"><b>${winnerName}</b> a remporté la partie !</p>

        <div class="menu-buttons">
          <button class="btn btn-primary" id="btn-rematch">🔄 Revanche immédiate</button>
          <button class="btn btn-secondary" id="btn-menu">🏠 Retour au menu principal</button>
        </div>
      </div>
    `;

    this.container.querySelector('#btn-rematch')?.addEventListener('click', () => {
      this.hide();
      this.callbacks.onRematch();
    });

    this.container.querySelector('#btn-menu')?.addEventListener('click', () => {
      this.callbacks.onReturnToMenu();
      this.showMainMenu();
    });
  }

  public hide() {
    this.container.style.display = 'none';
  }

  public show() {
    this.container.style.display = 'flex';
  }

  private renderLoadoutIcons(): string {
    return this.selectedLoadout.map(id => {
      const wep = WEAPON_REGISTRY[id];
      return `<div class="loadout-icon-badge" title="${wep.name}">${wep.icon} <span>${wep.name}</span></div>`;
    }).join('');
  }
}
