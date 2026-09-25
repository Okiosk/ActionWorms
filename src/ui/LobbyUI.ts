import { ALL_WEAPON_IDS, WEAPON_REGISTRY, DEFAULT_LOADOUT } from '../weapons/WeaponRegistry';
import { WeaponId } from '../weapons/WeaponDef';
import { MatchModifiers, DEFAULT_MODIFIERS, LobbyPlayerInfo, MapType } from '../net/Protocol';
import { CONFIG } from '../config';
import { Terrain } from '../engine/Terrain';

export const MAP_METAS: Record<MapType, { name: string; icon: string; desc: string }> = {
  cave: {
    name: 'Cavernes',
    icon: '🕳️',
    desc: 'Tunnels sinueux et grandes cavernes forées dans la roche indestructible.'
  },
  volcano: {
    name: 'Volcan',
    icon: '🌋',
    desc: 'Immense lac d’acide au fond, colonnes de roche et stalactites suspendues.'
  },
  swiss: {
    name: 'Fromage Suisse',
    icon: '🧀',
    desc: 'Réseau dense de 40+ chambres circulaires autonomes à forer ou grappiner.'
  },
  fortress: {
    name: 'Forteresse',
    icon: '🏰',
    desc: 'Étages fortifiés horizontaux, corridors et fossés d’acide piégés.'
  },
  open: {
    name: 'Terrain Ouvert',
    icon: '🌄',
    desc: 'Surface vallonnée à ciel ouvert avec îles rocheuses flottantes.'
  }
};

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
  public previewSeed: number = Math.floor(Math.random() * 1000000);

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
            <span>Arsenal actif (5 / 19 armes)</span>
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
        <p class="subtitle">Sélectionnez 5 armes parmi les 19 disponibles pour votre paquetage de combat.</p>

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

        <!-- Two Columns: Modifiers on Left, Map Selection + Preview on Right -->
        <div class="lobby-columns">
          <!-- LEFT COLUMN: Modificateurs -->
          <div class="lobby-section column-modifiers">
            <div class="section-title">⚙️ Règles & Modificateurs</div>
            <div class="modifiers-grid">
              <div class="mod-item">
                <label>🎮 Mode de Jeu</label>
                <select id="mod-gamemode">
                  <option value="ffa" ${this.modifiers.gameMode === 'ffa' ? 'selected' : ''}>⚔️ Deathmatch (FFA)</option>
                  <option value="teams" ${this.modifiers.gameMode === 'teams' ? 'selected' : ''}>👥 Équipes (2 teams)</option>
                  <option value="koth" ${this.modifiers.gameMode === 'koth' ? 'selected' : ''}>👑 Roi de la Colline</option>
                </select>
              </div>

              <div class="mod-item">
                <label>🌍 Gravité</label>
                <select id="mod-gravity">
                  <option value="1.0" ${this.modifiers.gravity === 1.0 ? 'selected' : ''}>Normale (1.0x)</option>
                  <option value="0.35" ${this.modifiers.gravity === 0.35 ? 'selected' : ''}>🌙 Lunaire (0.35x)</option>
                  <option value="1.8" ${this.modifiers.gravity === 1.8 ? 'selected' : ''}>⚓ Élevée (1.8x)</option>
                  <option value="0.0" ${this.modifiers.gravity === 0.0 ? 'selected' : ''}>🚀 Zéro-G (Spatiale)</option>
                </select>
              </div>

              <div class="mod-item">
                <label>🪢 Grappin Ninja</label>
                <select id="mod-rope">
                  <option value="normal" ${this.modifiers.ropeReach === 'normal' ? 'selected' : ''}>Normale (220px)</option>
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
                <label>♾️ Munitions</label>
                <select id="mod-ammo">
                  <option value="standard" ${!this.modifiers.unlimitedAmmo ? 'selected' : ''}>Standard (Clips)</option>
                  <option value="unlimited" ${this.modifiers.unlimitedAmmo ? 'selected' : ''}>💥 Illimitées (No Reload)</option>
                </select>
              </div>

              <div class="mod-item">
                <label>🏆 Objectif (Score/Frags)</label>
                <select id="mod-frags">
                  <option value="5" ${this.modifiers.fragLimit === 5 ? 'selected' : ''}>5 Points</option>
                  <option value="10" ${this.modifiers.fragLimit === 10 ? 'selected' : ''}>10 Points (Défaut)</option>
                  <option value="15" ${this.modifiers.fragLimit === 15 ? 'selected' : ''}>15 Points</option>
                  <option value="20" ${this.modifiers.fragLimit === 20 ? 'selected' : ''}>20 Points</option>
                  <option value="30" ${this.modifiers.fragLimit === 30 ? 'selected' : ''}>30 Points</option>
                </select>
              </div>

              <div class="mod-item">
                <label>⚔️ Dégâts</label>
                <select id="mod-damage">
                  <option value="1.0" ${this.modifiers.damageScale === 1.0 ? 'selected' : ''}>Normaux (1x)</option>
                  <option value="0.5" ${this.modifiers.damageScale === 0.5 ? 'selected' : ''}>💛 Doux (0.5x)</option>
                  <option value="2.0" ${this.modifiers.damageScale === 2.0 ? 'selected' : ''}>🔴 Double (2x)</option>
                  <option value="3.0" ${this.modifiers.damageScale === 3.0 ? 'selected' : ''}>💀 Triple (3x)</option>
                </select>
              </div>

              <div class="mod-item">
                <label>💊 Régénération</label>
                <select id="mod-regen">
                  <option value="0" ${this.modifiers.regenRate === 0 ? 'selected' : ''}>Aucune</option>
                  <option value="1" ${this.modifiers.regenRate === 1 ? 'selected' : ''}>🟡 Lente (1 HP/s)</option>
                  <option value="3" ${this.modifiers.regenRate === 3 ? 'selected' : ''}>🟢 Rapide (3 HP/s)</option>
                </select>
              </div>

              <div class="mod-item">
                <label>💣 Explosions</label>
                <select id="mod-explosion">
                  <option value="1.0" ${this.modifiers.explosionScale === 1.0 ? 'selected' : ''}>Normale (1x)</option>
                  <option value="0.5" ${this.modifiers.explosionScale === 0.5 ? 'selected' : ''}>🔹 Petite (0.5x)</option>
                  <option value="2.0" ${this.modifiers.explosionScale === 2.0 ? 'selected' : ''}>🔴 Grande (2x)</option>
                </select>
              </div>

              <div class="mod-item">
                <label>🛡️ Dégâts Propres</label>
                <select id="mod-selfdmg">
                  <option value="false" ${!this.modifiers.noSelfDamage ? 'selected' : ''}>Actif (Normal)</option>
                  <option value="true" ${this.modifiers.noSelfDamage ? 'selected' : ''}>🛡️ Immunité</option>
                </select>
              </div>

              <div class="mod-item">
                <label>🧪 Acide sur la Map</label>
                <select id="mod-acid">
                  <option value="true" ${this.modifiers.acidEnabled ? 'selected' : ''}>🧪 Activé</option>
                  <option value="false" ${!this.modifiers.acidEnabled ? 'selected' : ''}>Désactivé</option>
                </select>
              </div>
            </div>
          </div>

          <!-- RIGHT COLUMN: Choix de la Map + Preview -->
          <div class="lobby-section column-map">
            <div class="section-title">🗺️ Choix de la Carte</div>

            <div class="map-selection-content">
              <div class="map-cards-selector">
                ${(Object.keys(MAP_METAS) as MapType[]).map(mKey => {
                  const meta = MAP_METAS[mKey];
                  const isSelected = (this.modifiers.mapType || 'cave') === mKey;
                  return `
                    <button type="button" class="map-select-btn ${isSelected ? 'active' : ''}" data-map="${mKey}">
                      <span class="map-btn-icon">${meta.icon}</span>
                      <span class="map-btn-title">${meta.name}</span>
                    </button>
                  `;
                }).join('')}
              </div>

              <div class="map-preview-card">
                <div class="map-preview-top">
                  <span class="preview-badge" id="preview-map-title">${(MAP_METAS[this.modifiers.mapType || 'cave'] || MAP_METAS.cave).icon} ${(MAP_METAS[this.modifiers.mapType || 'cave'] || MAP_METAS.cave).name}</span>
                  <button type="button" class="btn btn-secondary btn-sm" id="btn-random-map-seed" title="Générer une autre variante de cette carte">🔄 Autre graine</button>
                </div>

                <div class="map-canvas-wrapper">
                  <canvas id="map-preview-canvas" width="300" height="188"></canvas>
                </div>

                <p class="map-desc-text" id="preview-map-desc">
                  ${(MAP_METAS[this.modifiers.mapType || 'cave'] || MAP_METAS.cave).desc}
                </p>
              </div>
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
    bindSelect('#mod-gamemode', 'gameMode');
    bindSelect('#mod-damage', 'damageScale', true);
    bindSelect('#mod-regen', 'regenRate', true);
    bindSelect('#mod-explosion', 'explosionScale', true);

    const noSelfEl = this.container.querySelector('#mod-selfdmg') as HTMLSelectElement;
    noSelfEl?.addEventListener('change', () => {
      const val = noSelfEl.value === 'true';
      (this.modifiers as any).noSelfDamage = val;
      this.callbacks.onModifierChanged({ noSelfDamage: val });
    });
    const acidEl = this.container.querySelector('#mod-acid') as HTMLSelectElement;
    acidEl?.addEventListener('change', () => {
      const val = acidEl.value === 'true';
      (this.modifiers as any).acidEnabled = val;
      this.callbacks.onModifierChanged({ acidEnabled: val });
      this.updateMapPreview();
    });

    // Map selection buttons
    this.container.querySelectorAll('.map-select-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mapType = (btn as HTMLElement).dataset.map as MapType;
        if (!mapType) return;
        this.modifiers.mapType = mapType;
        this.callbacks.onModifierChanged({ mapType });
        this.updateMapPreview();
      });
    });

    // Randomize seed button
    this.container.querySelector('#btn-random-map-seed')?.addEventListener('click', () => {
      this.previewSeed = Math.floor(Math.random() * 1000000);
      this.updateMapPreview();
    });

    this.container.querySelector('#btn-start-match')?.addEventListener('click', () => {
      this.callbacks.onStartMatch();
      this.hide();
    });

    this.container.querySelector('#btn-cancel-host')?.addEventListener('click', () => {
      this.callbacks.onReturnToMenu();
      this.showMainMenu();
    });

    // Initial map preview render
    this.updateMapPreview();

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

        <div class="lobby-columns">
          <div class="lobby-section column-modifiers">
            <div class="section-title">⚙️ Règles Choisies par l'Hôte</div>
            <div class="modifiers-summary" id="client-modifiers-summary">
              ${this.renderModifiersSummary()}
            </div>
          </div>

          <div class="lobby-section column-map">
            <div class="section-title">🗺️ Carte de Combat</div>
            <div class="map-preview-card">
              <div class="map-preview-top">
                <span class="preview-badge" id="preview-map-title">${(MAP_METAS[this.modifiers.mapType || 'cave'] || MAP_METAS.cave).icon} ${(MAP_METAS[this.modifiers.mapType || 'cave'] || MAP_METAS.cave).name}</span>
              </div>
              <div class="map-canvas-wrapper">
                <canvas id="map-preview-canvas" width="300" height="188"></canvas>
              </div>
              <p class="map-desc-text" id="preview-map-desc">
                ${(MAP_METAS[this.modifiers.mapType || 'cave'] || MAP_METAS.cave).desc}
              </p>
            </div>
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

    this.updateMapPreview();
  }

  public updateMapPreview() {
    const canvas = this.container.querySelector('#map-preview-canvas') as HTMLCanvasElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const currentMap = this.modifiers.mapType || 'cave';
    const acidOn = this.modifiers.acidEnabled !== false;

    // Fast generation for the preview
    const terrain = new Terrain(CONFIG.MAP_WIDTH, CONFIG.MAP_HEIGHT);
    terrain.generateMap(this.previewSeed, currentMap, acidOn);

    // Draw scaled down to preview canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = CONFIG.COLORS.SKY;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.drawImage(terrain.dirtCanvas, 0, 0, canvas.width, canvas.height);
    ctx.drawImage(terrain.rockCanvas, 0, 0, canvas.width, canvas.height);
    if (acidOn) {
      ctx.drawImage(terrain.acidCanvas, 0, 0, canvas.width, canvas.height);
    }

    // Update text
    const meta = MAP_METAS[currentMap] || MAP_METAS.cave;
    const titleEl = this.container.querySelector('#preview-map-title');
    if (titleEl) titleEl.textContent = `${meta.icon} ${meta.name}`;
    const descEl = this.container.querySelector('#preview-map-desc');
    if (descEl) descEl.textContent = meta.desc;

    // Highlight active button
    this.container.querySelectorAll('.map-select-btn').forEach(btn => {
      const isSelected = (btn as HTMLElement).dataset.map === currentMap;
      btn.classList.toggle('active', isSelected);
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
      // Host click listener to toggle player teams
      if (this.isHost && this.modifiers.gameMode === 'teams') {
        listEl.querySelectorAll('.team-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const pid = (btn as HTMLElement).dataset.pid;
            if (!pid) return;
            const curTeam = this.modifiers.teams[pid] ?? 0;
            const newTeam = curTeam === 0 ? 1 : 0;
            this.modifiers.teams[pid] = newTeam;
            this.callbacks.onModifierChanged({ teams: { ...this.modifiers.teams } });
            this.updateLobbyState(this.connectedPlayers, this.modifiers);
          });
        });
      }
    }

    const summaryEl = this.container.querySelector('#client-modifiers-summary');
    if (summaryEl) {
      summaryEl.innerHTML = this.renderModifiersSummary();
    }

    this.updateMapPreview();
  }

  private renderPlayersList(): string {
    const isTeams = this.modifiers.gameMode === 'teams';

    if (this.connectedPlayers.length === 0) {
      const myTeam = this.modifiers.teams[this.playerName] ?? 0;
      const teamBadge = isTeams
        ? `<span class="team-badge ${myTeam === 0 ? 'team-red' : 'team-blue'}" style="margin-left:auto; cursor:pointer;" id="toggle-my-team">${myTeam === 0 ? '🔴 Rouge' : '🔵 Bleu'}</span>`
        : '';
      return `
        <div class="player-slot active">
          <span class="player-color-dot" style="background:${CONFIG.PLAYER_COLORS[0]}"></span>
          <span class="player-slot-name">${this.escapeHtml(this.playerName)}</span>
          ${teamBadge}
        </div>
      `;
    }

    return this.connectedPlayers.map((p, idx) => {
      // Default teams: alternate if not set (0, 2, 4 -> 0; 1, 3, 5 -> 1)
      const pTeam = this.modifiers.teams[p.id] !== undefined ? this.modifiers.teams[p.id] : idx % 2;
      const teamBadge = isTeams
        ? `<button class="team-btn ${pTeam === 0 ? 'team-red' : 'team-blue'}" data-pid="${p.id}" ${!this.isHost ? 'disabled' : ''} style="margin-left:auto; padding:2px 8px; font-size:12px; cursor:${this.isHost ? 'pointer' : 'default'}">${pTeam === 0 ? '🔴 Équipe 1' : '🔵 Équipe 2'}</button>`
        : '';
      return `
        <div class="player-slot active">
          <span class="player-color-dot" style="background:${p.color}"></span>
          <span class="player-slot-name">${this.escapeHtml(p.name)} ${p.isHost ? '(Hôte)' : ''}</span>
          ${teamBadge}
        </div>
      `;
    }).join('') + Array.from({ length: Math.max(0, CONFIG.MAX_PLAYERS - this.connectedPlayers.length) }).map((_, i) => `
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
    const modeLabel = this.modifiers.gameMode === 'teams' ? '👥 Équipes' : this.modifiers.gameMode === 'koth' ? '👑 KOTH' : '⚔️ FFA';
    const mapLabel = ({ cave: '🕳️ Cavernes', volcano: '🌋 Volcan', swiss: '🧀 Suisse', fortress: '🏰 Forteresse', open: '🌄 Ouvert' } as Record<string, string>)[this.modifiers.mapType] || '🕳️ Cavernes';

    return `
      <div class="mod-summary-pill">Mode: <b>${modeLabel}</b></div>
      <div class="mod-summary-pill">Map: <b>${mapLabel}</b></div>
      <div class="mod-summary-pill">Gravité: <b>${gravLabel}</b></div>
      <div class="mod-summary-pill">Grappin: <b>${ropeLabel}</b></div>
      <div class="mod-summary-pill">Vitesse: <b>${speedLabel}</b></div>
      <div class="mod-summary-pill">Santé: <b>${this.modifiers.maxHealth} PV</b></div>
      <div class="mod-summary-pill">Munitions: <b>${ammoLabel}</b></div>
      <div class="mod-summary-pill">Frags: <b>${this.modifiers.fragLimit}</b></div>
      <div class="mod-summary-pill">Dégâts: <b>${this.modifiers.damageScale}x</b></div>
      ${this.modifiers.regenRate > 0 ? `<div class="mod-summary-pill">Regen: <b>${this.modifiers.regenRate} HP/s</b></div>` : ''}
      ${this.modifiers.explosionScale !== 1.0 ? `<div class="mod-summary-pill">Explosions: <b>${this.modifiers.explosionScale}x</b></div>` : ''}
      ${this.modifiers.noSelfDamage ? `<div class="mod-summary-pill">🛡️ <b>No Self-Damage</b></div>` : ''}
      ${!this.modifiers.acidEnabled ? `<div class="mod-summary-pill">Acide: <b>Désactivé</b></div>` : ''}
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
