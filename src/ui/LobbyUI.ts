import { ALL_WEAPON_IDS, WEAPON_REGISTRY, DEFAULT_LOADOUT } from '../weapons/WeaponRegistry';
import { WeaponId } from '../weapons/WeaponDef';
import { MatchModifiers, DEFAULT_MODIFIERS, LobbyPlayerInfo } from '../net/Protocol';
import { CONFIG } from '../config';

export interface LobbyCallbacks {
  onHostOnline: (name: string, loadout: WeaponId[], modifiers: MatchModifiers) => Promise<string>;
  onJoinOnline: (roomId: string, name: string, loadout: WeaponId[]) => Promise<void>;
  onStartMatch: () => void;
  onModifierChanged: (mods: Partial<MatchModifiers>) => void;
  onRematch: () => void;
  onReturnToMenu: () => void;
}

export function normalizeRoomId(raw: string): string {
  let id = (raw || '').trim();
  if (id.includes('#room=')) {
    id = id.split('#room=')[1];
  } else if (id.includes('room=')) {
    id = id.split('room=')[1];
  }
  return id.split('&')[0].split('?')[0].split('/')[0].trim().toLowerCase();
}

export class LobbyUI {
  private container: HTMLElement;
  private callbacks: LobbyCallbacks;

  public playerName: string = localStorage.getItem('action_worms_nickname') || 'Guerrier';
  public selectedLoadout: WeaponId[] = [...DEFAULT_LOADOUT];
  public modifiers: MatchModifiers = { ...DEFAULT_MODIFIERS };
  public connectedPlayers: LobbyPlayerInfo[] = [];
  public currentRoomId: string = '';
  public isHost: boolean = false;

  constructor(container: HTMLElement, callbacks: LobbyCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.showMainMenu();
  }

  public setPlayerName(name: string) {
    this.playerName = name.trim() || 'Guerrier';
    try {
      localStorage.setItem('action_worms_nickname', this.playerName);
    } catch {}
  }

  public showMainMenu() {
    this.isHost = false;
    this.connectedPlayers = [];
    this.container.style.display = 'flex';
    this.container.innerHTML = `
      <div class="menu-card main-menu">
        <h1 class="game-title">ACTION WORMS</h1>
        <p class="subtitle">L'arène souterraine 100% P2P WebRTC • Jusqu'à 8 Joueurs</p>

        <div class="player-name-row">
          <label for="input-player-name">🪱 Votre Pseudo :</label>
          <input type="text" id="input-player-name" maxlength="16" value="${this.escapeHtml(this.playerName)}" placeholder="Votre nom de ver" />
        </div>

        <div class="menu-buttons">
          <button class="btn btn-accent" id="btn-host">🌐 Créer un Salon (Hôte)</button>
          <div class="divider"><span>OU REJOINDRE DES AMIS</span></div>
          <div class="join-row">
            <input type="text" id="input-room-code" placeholder="Code (ex: liero-abc) ou lien" />
            <button class="btn btn-join" id="btn-join">Rejoindre</button>
          </div>
        </div>

        <div class="loadout-preview">
          <div class="loadout-header">
            <span>Arsenal actif (5 / 13 armes)</span>
            <button class="btn-text" id="btn-edit-loadout">Modifier l'arsenal ⚙️</button>
          </div>
          <div class="loadout-icons" id="loadout-icons-preview">
            ${this.renderLoadoutIcons()}
          </div>
        </div>

        <div class="footer-tip">
          Connexion directe entre navigateurs • Jusqu'à 8 joueurs en simultané • 0 serveur de jeu
        </div>
      </div>
    `;

    const nameInput = this.container.querySelector('#input-player-name') as HTMLInputElement;
    nameInput?.addEventListener('input', () => {
      this.setPlayerName(nameInput.value);
    });

    this.container.querySelector('#btn-host')?.addEventListener('click', async () => {
      this.setPlayerName(nameInput ? nameInput.value : this.playerName);
      this.showHostLobby();
    });

    this.container.querySelector('#btn-join')?.addEventListener('click', async () => {
      this.setPlayerName(nameInput ? nameInput.value : this.playerName);
      const input = this.container.querySelector('#input-room-code') as HTMLInputElement;
      const code = normalizeRoomId(input.value);
      if (!code) {
        alert('Veuillez entrer un code de salon valide (ex: liero-xxxx).');
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
        <p class="subtitle">Sélectionnez 5 armes parmi les 13 disponibles pour votre paquetage de combat.</p>

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
    this.isHost = true;
    this.container.innerHTML = `
      <div class="menu-card host-lobby-card">
        <h2>Salon Multijoueur P2P (Hôte)</h2>
        <p class="subtitle">Configurez la partie et invitez jusqu'à 7 amis !</p>

        <div class="room-code-box">
          <span class="room-label">Code du salon :</span>
          <span class="room-code-val" id="room-code-display">Génération...</span>
          <button class="btn btn-secondary btn-sm" id="btn-copy-link">📋 Copier le lien d'invitation</button>
        </div>

        <!-- Connected Players list (1..8) -->
        <div class="lobby-section">
          <div class="section-title">👥 Joueurs Connectés (<span id="player-count">1</span>/8)</div>
          <div class="players-list" id="players-list-container">
            <div class="player-slot active">
              <span class="player-color-dot" style="background:${CONFIG.PLAYER_COLORS[0]}"></span>
              <span class="player-slot-name">${this.escapeHtml(this.playerName)} (Hôte - Vous)</span>
            </div>
          </div>
        </div>

        <!-- Modifiers Panel -->
        <div class="lobby-section">
          <div class="section-title">⚙️ Modificateurs de Partie (Règles Spéciales)</div>
          <div class="modifiers-grid">
            <div class="mod-item">
              <label>🌍 Gravité</label>
              <select id="mod-gravity">
                <option value="1.0" ${this.modifiers.gravity === 1.0 ? 'selected' : ''}>Normale (1.0x)</option>
                <option value="0.35" ${this.modifiers.gravity === 0.35 ? 'selected' : ''}>🌙 Lunaire (Basse - 0.35x)</option>
                <option value="1.8" ${this.modifiers.gravity === 1.8 ? 'selected' : ''}>⚓ Élevée (1.8x)</option>
                <option value="0.0" ${this.modifiers.gravity === 0.0 ? 'selected' : ''}>🚀 Zéro-G (Spatiale)</option>
              </select>
            </div>

            <div class="mod-item">
              <label>🪢 Grappin Ninja</label>
              <select id="mod-rope">
                <option value="normal" ${this.modifiers.ropeReach === 'normal' ? 'selected' : ''}>Portée Normale (220px)</option>
                <option value="infinite" ${this.modifiers.ropeReach === 'infinite' ? 'selected' : ''}>♾️ Portée Infinie</option>
              </select>
            </div>

            <div class="mod-item">
              <label>⚡ Vitesse des Vers</label>
              <select id="mod-speed">
                <option value="1.0" ${this.modifiers.wormSpeed === 1.0 ? 'selected' : ''}>Normale (1.0x)</option>
                <option value="1.5" ${this.modifiers.wormSpeed === 1.5 ? 'selected' : ''}>🔥 Turbo (1.5x)</option>
                <option value="0.75" ${this.modifiers.wormSpeed === 0.75 ? 'selected' : ''}>🐢 Tactique (0.75x)</option>
              </select>
            </div>

            <div class="mod-item">
              <label>❤️ Santé Max</label>
              <select id="mod-health">
                <option value="100" ${this.modifiers.maxHealth === 100 ? 'selected' : ''}>100 PV (Standard)</option>
                <option value="50" ${this.modifiers.maxHealth === 50 ? 'selected' : ''}>💀 50 PV (Hardcore)</option>
                <option value="200" ${this.modifiers.maxHealth === 200 ? 'selected' : ''}>🛡️ 200 PV (Titans)</option>
              </select>
            </div>

            <div class="mod-item">
              <label>♾️ Munitions & Rechargement</label>
              <select id="mod-ammo">
                <option value="standard" ${!this.modifiers.unlimitedAmmo ? 'selected' : ''}>Standard (Clips & Recharge)</option>
                <option value="unlimited" ${this.modifiers.unlimitedAmmo ? 'selected' : ''}>💥 Tirs Illimités (No Reload)</option>
              </select>
            </div>

            <div class="mod-item">
              <label>🏆 Objectif de Frags</label>
              <select id="mod-frags">
                <option value="5" ${this.modifiers.fragLimit === 5 ? 'selected' : ''}>5 Frags</option>
                <option value="10" ${this.modifiers.fragLimit === 10 ? 'selected' : ''}>10 Frags (Défaut)</option>
                <option value="15" ${this.modifiers.fragLimit === 15 ? 'selected' : ''}>15 Frags</option>
                <option value="20" ${this.modifiers.fragLimit === 20 ? 'selected' : ''}>20 Frags</option>
                <option value="30" ${this.modifiers.fragLimit === 30 ? 'selected' : ''}>30 Frags</option>
              </select>
            </div>
          </div>
        </div>

        <div class="menu-buttons">
          <button class="btn btn-primary btn-lg" id="btn-start-match">⚔️ LANCER LA PARTIE</button>
          <button class="btn btn-secondary" id="btn-cancel-host">Quitter le salon</button>
        </div>
      </div>
    `;

    // Hook modifier selects
    const bindSelect = (id: string, prop: keyof MatchModifiers, isNum: boolean = false, isBool: boolean = false) => {
      const el = this.container.querySelector(id) as HTMLSelectElement;
      el?.addEventListener('change', () => {
        let val: any = el.value;
        if (isNum) val = parseFloat(val);
        if (isBool) val = val === 'unlimited';
        (this.modifiers as any)[prop] = val;
        this.callbacks.onModifierChanged({ [prop]: val });
      });
    };

    bindSelect('#mod-gravity', 'gravity', true);
    bindSelect('#mod-rope', 'ropeReach');
    bindSelect('#mod-speed', 'wormSpeed', true);
    bindSelect('#mod-health', 'maxHealth', true);
    bindSelect('#mod-ammo', 'unlimitedAmmo', false, true);
    bindSelect('#mod-frags', 'fragLimit', true);

    this.container.querySelector('#btn-start-match')?.addEventListener('click', () => {
      this.callbacks.onStartMatch();
      this.hide();
    });

    this.container.querySelector('#btn-cancel-host')?.addEventListener('click', () => {
      this.callbacks.onReturnToMenu();
      this.showMainMenu();
    });

    try {
      const roomId = await this.callbacks.onHostOnline(this.playerName, this.selectedLoadout, this.modifiers);
      this.currentRoomId = roomId;
      const codeDisplay = this.container.querySelector('#room-code-display');
      if (codeDisplay) codeDisplay.textContent = roomId;

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

  public showClientLobby(roomId: string) {
    this.isHost = false;
    this.currentRoomId = roomId;
    this.container.innerHTML = `
      <div class="menu-card host-lobby-card">
        <h2>Salon Multijoueur P2P</h2>
        <p class="subtitle">Connecté au salon <b>${this.escapeHtml(roomId)}</b></p>

        <div class="lobby-section">
          <div class="section-title">👥 Joueurs Connectés (<span id="player-count">${this.connectedPlayers.length || 1}</span>/8)</div>
          <div class="players-list" id="players-list-container">
            ${this.renderPlayersList()}
          </div>
        </div>

        <div class="lobby-section">
          <div class="section-title">⚙️ Règles & Modificateurs Choisis par l'Hôte</div>
          <div class="modifiers-summary" id="client-modifiers-summary">
            ${this.renderModifiersSummary()}
          </div>
        </div>

        <div class="connection-status" id="lobby-status">
          <div class="spinner"></div>
          <span>En attente que l'hôte lance la partie...</span>
        </div>

        <div class="menu-buttons">
          <button class="btn btn-secondary" id="btn-cancel-join">Quitter le salon</button>
        </div>
      </div>
    `;

    this.container.querySelector('#btn-cancel-join')?.addEventListener('click', () => {
      this.callbacks.onReturnToMenu();
      this.showMainMenu();
    });
  }

  public updateLobbyState(players: LobbyPlayerInfo[], modifiers: MatchModifiers) {
    this.connectedPlayers = players;
    this.modifiers = { ...modifiers };

    const countEl = this.container.querySelector('#player-count');
    if (countEl) countEl.textContent = String(players.length);

    const listEl = this.container.querySelector('#players-list-container');
    if (listEl) {
      listEl.innerHTML = this.renderPlayersList();
    }

    const summaryEl = this.container.querySelector('#client-modifiers-summary');
    if (summaryEl) {
      summaryEl.innerHTML = this.renderModifiersSummary();
    }
  }

  private renderPlayersList(): string {
    if (this.connectedPlayers.length === 0) {
      return `
        <div class="player-slot active">
          <span class="player-color-dot" style="background:${CONFIG.PLAYER_COLORS[0]}"></span>
          <span class="player-slot-name">${this.escapeHtml(this.playerName)}</span>
        </div>
      `;
    }

    return this.connectedPlayers.map((p, idx) => `
      <div class="player-slot active">
        <span class="player-color-dot" style="background:${p.color}"></span>
        <span class="player-slot-name">${this.escapeHtml(p.name)} ${p.isHost ? '(Hôte)' : ''}</span>
      </div>
    `).join('') + Array.from({ length: Math.max(0, CONFIG.MAX_PLAYERS - this.connectedPlayers.length) }).map((_, i) => `
      <div class="player-slot empty">
        <span class="player-color-dot empty"></span>
        <span class="player-slot-name">Emplacement libre ${this.connectedPlayers.length + i + 1}</span>
      </div>
    `).join('');
  }

  private renderModifiersSummary(): string {
    const gravLabel = this.modifiers.gravity === 1.0 ? 'Normale' : this.modifiers.gravity === 0.35 ? '🌙 Lunaire' : this.modifiers.gravity === 0.0 ? '🚀 Zéro-G' : 'Élevée';
    const ropeLabel = this.modifiers.ropeReach === 'infinite' ? '♾️ Portée Infinie' : 'Standard (220px)';
    const speedLabel = this.modifiers.wormSpeed === 1.5 ? '🔥 Turbo' : this.modifiers.wormSpeed === 0.75 ? 'Tactique' : 'Normale';
    const ammoLabel = this.modifiers.unlimitedAmmo ? '💥 Illimitées' : 'Standard';

    return `
      <div class="mod-summary-pill">Gravité: <b>${gravLabel}</b></div>
      <div class="mod-summary-pill">Grappin: <b>${ropeLabel}</b></div>
      <div class="mod-summary-pill">Vitesse: <b>${speedLabel}</b></div>
      <div class="mod-summary-pill">Santé: <b>${this.modifiers.maxHealth} PV</b></div>
      <div class="mod-summary-pill">Munitions: <b>${ammoLabel}</b></div>
      <div class="mod-summary-pill">Frags: <b>${this.modifiers.fragLimit}</b></div>
    `;
  }

  public async showConnectingModal(rawRoomId: string) {
    const roomId = normalizeRoomId(rawRoomId);
    this.container.style.display = 'flex';
    this.container.innerHTML = `
      <div class="menu-card lobby-card">
        <h2>Connexion au Salon</h2>
        <p class="subtitle">Connexion P2P directe vers <b>${this.escapeHtml(roomId)}</b></p>

        <div class="connection-status">
          <div class="spinner"></div>
          <span id="client-connect-status">Établissement du tunnel WebRTC...</span>
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
      const statusText = this.container.querySelector('#client-connect-status');
      if (statusText) statusText.textContent = 'Connexion à l\'hôte et synchronisation...';

      await this.callbacks.onJoinOnline(roomId, this.playerName, this.selectedLoadout);
      this.showClientLobby(roomId);
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
        <p class="subtitle"><b>${this.escapeHtml(winnerName)}</b> a remporté la partie !</p>

        <div class="menu-buttons">
          ${this.isHost ? '<button class="btn btn-primary" id="btn-rematch">🔄 Revanche immédiate</button>' : ''}
          <button class="btn btn-secondary" id="btn-menu">🏠 Retour au salon principal</button>
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
      if (!wep) return '';
      return `<div class="loadout-icon-badge" title="${wep.name}">${wep.icon} <span>${wep.name}</span></div>`;
    }).join('');
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
