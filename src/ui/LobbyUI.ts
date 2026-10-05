import { CONFIG } from '../config';
import { Game, MatchResult } from '../engine/Game';
import { Terrain } from '../engine/Terrain';
import { GameMode, MapType, MatchModifiers } from '../net/Protocol';

const MAPS: Record<MapType, { name: string; icon: string; desc: string }> = {
  cave: { name: 'Grottes', icon: '💎', desc: 'Cavernes organiques, lacs souterrains et filons de cristal à faire exploser pour de l\'or.' },
  volcano: { name: 'Volcan', icon: '🌋', desc: 'Lac de lave, cône à percer jusqu\'à la cheminée de magma, ponts de bois inflammables.' },
  forest: { name: 'Forêt', icon: '🌳', desc: 'Arbres géants, rivière, terriers et champignons-trampolines.' },
  citadel: { name: 'Citadelle', icon: '🏰', desc: 'Deux châteaux symétriques, douves, pont-levis et salle au trésor.' },
  glacier: { name: 'Glacier', icon: '🏔️', desc: 'Pentes de glace glissantes, lacs gelés et grottes de glace.' },
  sky: { name: 'Archipel', icon: '☁️', desc: 'Îles flottantes au-dessus de l\'océan : grappin indispensable.' }
};

const MODES: { id: GameMode; name: string; desc: string }[] = [
  { id: 'ffa', name: '⚔️ Mêlée', desc: 'Chacun pour soi' },
  { id: 'teams', name: '🛡️ Équipes', desc: 'Rouge contre Bleu' },
  { id: 'koth', name: '👑 Colline', desc: 'Tenir la zone' }
];

type Opt = [unknown, string];
interface Setting { key: keyof MatchModifiers; label: string; options: Opt[] }

const ADVANCED: Setting[] = [
  { key: 'gravity', label: 'Gravité', options: [[1, 'Normale'], [0.35, 'Lunaire'], [1.8, 'Forte'], [0, 'Zéro-G']] },
  { key: 'ropeReach', label: 'Grappin', options: [['normal', 'Normal (220 px)'], ['infinite', 'Portée infinie']] },
  { key: 'wormSpeed', label: 'Vitesse', options: [[1, 'Normale'], [1.5, 'Rapide'], [0.75, 'Lente']] },
  { key: 'maxHealth', label: 'Points de vie', options: [[100, '100 PV'], [50, '50 PV'], [200, '200 PV']] },
  { key: 'damageScale', label: 'Dégâts', options: [[1, '×1'], [0.5, '×0,5'], [2, '×2'], [3, '×3']] },
  { key: 'explosionScale', label: 'Taille des explosions', options: [[1, '×1'], [0.5, '×0,5'], [2, '×2']] },
  { key: 'regenRate', label: 'Régénération', options: [[0, 'Aucune'], [1, '1 PV/s'], [3, '3 PV/s']] },
  { key: 'noSelfDamage', label: 'Auto-dégâts', options: [[false, 'Oui'], [true, 'Non']] },
  { key: 'acidEnabled', label: 'Acide et lave', options: [[true, 'Oui'], [false, 'Non']] }
];

const FRAG_LIMITS = [5, 10, 15, 20, 30];

export interface MenuCallbacks {
  onHost: (name: string) => Promise<string>;
  onJoin: (code: string, name: string) => Promise<void>;
  onLeave: () => void;
}

export function normalizeRoomId(raw: string): string {
  let id = (raw || '').trim();
  const m = id.match(/room=([^&?/#\s]+)/);
  if (m) id = m[1];
  return id.split(/[&?/#\s]/)[0].trim().toLowerCase();
}

function esc(str: string): string {
  return str.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/** Main menu, lobby, game over and pause screens. */
export class LobbyUI {
  private el: HTMLElement;
  private game: Game;
  private cb: MenuCallbacks;
  public playerName: string;
  public roomCode = '';
  private screen: 'main' | 'connecting' | 'lobby' | 'over' | 'pause' | 'disconnected' | 'hidden' = 'main';
  private previewKey = '';

  constructor(container: HTMLElement, game: Game, callbacks: MenuCallbacks) {
    this.el = container;
    this.game = game;
    this.cb = callbacks;
    let saved = '';
    try {
      saved = localStorage.getItem('action_worms_nickname') || '';
    } catch {
      // storage unavailable
    }
    this.playerName = saved || 'Sorcier';
  }

  public get currentScreen() {
    return this.screen;
  }

  private setName(name: string) {
    this.playerName = name.trim().slice(0, 16) || 'Sorcier';
    try {
      localStorage.setItem('action_worms_nickname', this.playerName);
    } catch {
      // storage unavailable
    }
  }

  private show(html: string, screen: typeof this.screen, transparent = false) {
    this.screen = screen;
    this.el.style.display = 'flex';
    this.el.classList.toggle('transparent', transparent);
    this.el.innerHTML = html;
  }

  public hide() {
    this.screen = 'hidden';
    this.el.style.display = 'none';
    this.el.innerHTML = '';
  }

  private $(sel: string): HTMLElement | null {
    return this.el.querySelector(sel);
  }

  private on(sel: string, event: string, fn: (e: Event) => void) {
    this.$(sel)?.addEventListener(event, fn);
  }

  // ════════════════════════════════════════════════════════════════════════
  // Main menu
  // ════════════════════════════════════════════════════════════════════════

  public showMainMenu(error?: string) {
    this.show(`
      <div class="card">
        <div>
          <div class="title">ARCANE WORMS</div>
          <p class="tagline">Duel de petits sorciers · jusqu'à 8 joueurs</p>
        </div>

        <label class="field">
          <span>Ton nom</span>
          <input type="text" id="name" maxlength="16" value="${esc(this.playerName)}" placeholder="Ex : Merlin" />
        </label>

        <button class="btn btn-primary btn-big" id="host">Créer une partie</button>

        <div class="divider">ou rejoindre un ami</div>

        <div class="row">
          <input type="text" id="code" placeholder="Code ou lien d'invitation" />
          <button class="btn" id="join">Rejoindre</button>
        </div>

        ${error ? `<div class="error">${esc(error)}</div>` : ''}

        <div class="controls">
          <span><kbd>Q</kbd> <kbd>D</kbd></span><b>Se déplacer</b>
          <span><kbd>Z</kbd> / <kbd>Espace</kbd></span><b>Sauter</b>
          <span>Souris</span><b>Viser</b>
          <span>Clic gauche</span><b>Lancer le sort</b>
          <span>Clic droit (maintenir)</span><b>Grappin — <kbd>Z</kbd>/<kbd>S</kbd> pour monter/descendre</b>
          <span><kbd>Échap</kbd></span><b>Menu</b>
        </div>
      </div>
    `, 'main');

    const nameInput = this.$('#name') as HTMLInputElement;
    const codeInput = this.$('#code') as HTMLInputElement;
    nameInput.addEventListener('input', () => this.setName(nameInput.value));

    this.on('#host', 'click', () => this.host());
    const join = () => {
      const code = normalizeRoomId(codeInput.value);
      if (!code) {
        this.showMainMenu("Entre le code de salon (ex : liero-ab12cd) ou colle le lien d'invitation.");
        return;
      }
      this.join(code);
    };
    this.on('#join', 'click', join);
    codeInput.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') join();
    });
  }

  private async host() {
    this.showStatus('Création du salon…');
    try {
      this.roomCode = await this.cb.onHost(this.playerName);
      this.showLobby();
    } catch (err) {
      this.cb.onLeave();
      this.showMainMenu(err instanceof Error ? err.message : String(err));
    }
  }

  public async join(code: string) {
    this.roomCode = code;
    this.showStatus(`Connexion au salon <b>${esc(code)}</b>…`);
    try {
      await this.cb.onJoin(code, this.playerName);
      if (this.screen === 'connecting') this.showLobby();
    } catch (err) {
      if (this.screen !== 'connecting') return; // cancelled
      this.cb.onLeave();
      this.showMainMenu(err instanceof Error ? err.message : String(err));
    }
  }

  private showStatus(html: string) {
    this.show(`
      <div class="card">
        <div class="status"><div class="spinner"></div><span>${html}</span></div>
        <button class="btn btn-ghost" id="cancel">Annuler</button>
      </div>
    `, 'connecting');
    this.on('#cancel', 'click', () => {
      this.cb.onLeave();
      this.showMainMenu();
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // Lobby (same screen for host and guests; guests see read-only settings)
  // ════════════════════════════════════════════════════════════════════════

  public showLobby() {
    const isHost = this.game.role === 'host';
    const dis = isHost ? '' : 'disabled';

    this.show(`
      <div class="card wide">
        <div class="lobby-head">
          <h2>Salon</h2>
          <div class="room-code">
            <span class="hint">Code</span>
            <code>${esc(this.roomCode)}</code>
            <button class="btn btn-sm" id="copy">Copier le lien</button>
          </div>
        </div>

        <div class="lobby-grid">
          <div class="stack">
            <div class="panel">
              <div class="label">Joueurs <span id="count"></span></div>
              <div class="players" id="players"></div>
              <div class="hint" id="team-hint"></div>
            </div>
            <div class="panel">
              <div class="label">Mode de jeu</div>
              <div class="segmented" id="modes">
                ${MODES.map(m => `<button class="seg" data-mode="${m.id}" ${dis}>${m.name}<small>${m.desc}</small></button>`).join('')}
              </div>
              <label class="field">
                <span id="goal-label">Objectif</span>
                <select id="fragLimit" ${dis}></select>
              </label>
            </div>
          </div>

          <div class="stack">
            <div class="panel">
              <div class="label">Carte</div>
              <div class="segmented maps" id="maps">
                ${(Object.keys(MAPS) as MapType[]).map(k => `<button class="seg" data-map="${k}" ${dis}><span>${MAPS[k].icon}</span>${MAPS[k].name}</button>`).join('')}
              </div>
              <div class="preview">
                <canvas id="preview" width="400" height="250"></canvas>
                ${isHost ? '<button class="btn btn-sm" id="reroll" title="Générer une autre carte">🎲 Autre carte</button>' : ''}
              </div>
              <div class="hint" id="map-desc"></div>
            </div>
            <div class="panel">
              <details class="advanced">
                <summary>Options avancées</summary>
                <div class="settings-grid">
                  ${ADVANCED.map(s => `
                    <label class="field">
                      <span>${s.label}</span>
                      <select data-key="${s.key}" ${dis}>
                        ${s.options.map(([v, l]) => `<option value='${JSON.stringify(v)}'>${l}</option>`).join('')}
                      </select>
                    </label>`).join('')}
                </div>
              </details>
            </div>
          </div>
        </div>

        <div class="lobby-foot">
          <button class="btn btn-ghost" id="leave">Quitter le salon</button>
          ${isHost
            ? '<button class="btn btn-primary btn-big" id="start">Lancer la partie</button>'
            : `<div class="status"><div class="spinner"></div><span>En attente de l'hôte…</span></div>`}
        </div>
      </div>
    `, 'lobby');

    this.on('#copy', 'click', (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      const url = `${location.origin}${location.pathname}#room=${this.roomCode}`;
      navigator.clipboard?.writeText(url).then(
        () => { btn.textContent = 'Lien copié ✓'; },
        () => { btn.textContent = url; }
      );
      setTimeout(() => { btn.textContent = 'Copier le lien'; }, 2000);
    });
    this.on('#leave', 'click', () => {
      this.cb.onLeave();
      this.showMainMenu();
    });

    if (isHost) {
      this.on('#start', 'click', () => this.game.startMatch());
      this.on('#reroll', 'click', () => this.game.newMapSeed());
      this.el.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(b =>
        b.addEventListener('click', () => this.game.setModifiers({ gameMode: b.dataset.mode as GameMode })));
      this.el.querySelectorAll<HTMLButtonElement>('[data-map]').forEach(b =>
        b.addEventListener('click', () => this.game.setModifiers({ mapType: b.dataset.map as MapType })));
      this.on('#fragLimit', 'change', (e) =>
        this.game.setModifiers({ fragLimit: Number((e.target as HTMLSelectElement).value) }));
      this.el.querySelectorAll<HTMLSelectElement>('select[data-key]').forEach(sel =>
        sel.addEventListener('change', () =>
          this.game.setModifiers({ [sel.dataset.key!]: JSON.parse(sel.value) } as Partial<MatchModifiers>)));
      this.$('#players')?.addEventListener('click', (e) => {
        const chip = (e.target as HTMLElement).closest<HTMLElement>('[data-team]');
        if (chip) this.game.toggleTeam(chip.dataset.team!);
      });
    }

    this.previewKey = '';
    this.refreshLobby();
  }

  /** Updates the lobby in place (keeps open dropdowns and the advanced section state). */
  public refreshLobby() {
    if (this.screen !== 'lobby') return;
    const g = this.game;
    const mods = g.modifiers;
    const isHost = g.role === 'host';
    const teams = mods.gameMode === 'teams';

    (this.$('#count') as HTMLElement).textContent = `(${g.players.length}/${CONFIG.MAX_PLAYERS})`;
    (this.$('#players') as HTMLElement).innerHTML = g.players.map(p => {
      const t = g.teamOf(p.id);
      const chip = !teams ? '' : isHost
        ? `<button class="team-chip t${t}" data-team="${esc(p.id)}">${CONFIG.TEAM_NAMES[t]}</button>`
        : `<span class="team-chip t${t}">${CONFIG.TEAM_NAMES[t]}</span>`;
      return `
        <div class="player ${p.id === g.localId ? 'me' : ''}">
          <span class="dot" style="background:${p.color};color:${p.color}"></span>
          <span class="name">${esc(p.name)}</span>
          ${p.isHost ? '<span class="badge">Hôte</span>' : ''}
          ${p.id === g.localId ? '<span class="badge">Toi</span>' : ''}
          ${chip}
        </div>`;
    }).join('');
    (this.$('#team-hint') as HTMLElement).textContent =
      g.players.length < 2 ? 'Partage le lien pour inviter des amis.'
        : teams && isHost ? "Clique sur l'équipe d'un joueur pour le changer de camp." : '';

    this.el.querySelectorAll<HTMLElement>('[data-mode]').forEach(b =>
      b.classList.toggle('active', b.dataset.mode === mods.gameMode));
    this.el.querySelectorAll<HTMLElement>('[data-map]').forEach(b =>
      b.classList.toggle('active', b.dataset.map === mods.mapType));

    // Objective depends on the mode
    const goal = this.$('#fragLimit') as HTMLSelectElement;
    const koth = mods.gameMode === 'koth';
    (this.$('#goal-label') as HTMLElement).textContent =
      koth ? 'Temps à tenir la zone' : teams ? "Frags d'équipe pour gagner" : 'Frags pour gagner';
    goal.innerHTML = FRAG_LIMITS.map(v =>
      `<option value="${v}">${koth ? `${(v * CONFIG.KOTH_SECONDS_PER_POINT) / 60} min` : v}</option>`).join('');
    goal.value = String(mods.fragLimit);

    this.el.querySelectorAll<HTMLSelectElement>('select[data-key]').forEach(sel => {
      sel.value = JSON.stringify(mods[sel.dataset.key as keyof MatchModifiers]);
    });

    (this.$('#map-desc') as HTMLElement).textContent = MAPS[mods.mapType]?.desc ?? '';
    this.drawPreview();
  }

  private drawPreview() {
    const mods = this.game.modifiers;
    const zone = mods.gameMode === 'koth' ? CONFIG.KOTH_ZONE_RADIUS : 0;
    const key = `${mods.mapSeed}|${mods.mapType}|${mods.acidEnabled}|${zone}`;
    if (key === this.previewKey) return;
    this.previewKey = key;
    const canvas = this.$('#preview') as HTMLCanvasElement | null;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const t = new Terrain();
    t.generateMap(mods.mapSeed, mods.mapType, mods.acidEnabled, zone);
    t.drawPreview(ctx, canvas.width, canvas.height);
  }

  // ════════════════════════════════════════════════════════════════════════
  // In-game screens
  // ════════════════════════════════════════════════════════════════════════

  public showGameOver(result: MatchResult) {
    const g = this.game;
    const isHost = g.role === 'host';
    const koth = g.modifiers.gameMode === 'koth';
    const rows = result.standings.map((w, i) => `
      <tr class="${w.id === g.localId ? 'me' : ''}">
        <td>${i + 1}</td>
        <td><span class="dot" style="display:inline-block;background:${w.color};color:${w.color};margin-right:8px"></span>${esc(w.name)}</td>
        <td class="num">${koth ? `${Math.floor(w.score / 60)} s` : w.frags}</td>
        <td class="num">${w.deaths}</td>
      </tr>`).join('');

    this.show(`
      <div class="card">
        <div class="result-title ${result.isLocalWinner ? 'win' : 'lose'}">${result.isLocalWinner ? 'Victoire !' : 'Défaite'}</div>
        <p class="tagline"><b>${esc(result.winnerName)}</b> remporte la partie</p>
        <table class="standings">
          <tr><th>#</th><th>Sorcier</th><th class="num">${koth ? 'Zone' : 'Frags'}</th><th class="num">Morts</th></tr>
          ${rows}
        </table>
        ${isHost ? `
          <div class="stack">
            <button class="btn btn-primary btn-big" id="rematch">Revanche</button>
            <div class="row">
              <button class="btn" id="lobby" style="flex:1">Retour au salon</button>
              <button class="btn btn-ghost" id="leave" style="flex:1">Quitter</button>
            </div>
          </div>` : `
          <div class="status"><div class="spinner"></div><span>L'hôte choisit la suite…</span></div>
          <button class="btn btn-ghost" id="leave">Quitter</button>`}
      </div>
    `, 'over', true);

    this.on('#rematch', 'click', () => g.rematch());
    this.on('#lobby', 'click', () => g.returnToLobby());
    this.on('#leave', 'click', () => {
      this.cb.onLeave();
      this.showMainMenu();
    });
  }

  public showPause() {
    this.show(`
      <div class="card">
        <h2>Pause</h2>
        <p class="tagline">La partie continue pour les autres joueurs.</p>
        <button class="btn btn-primary btn-big" id="resume">Reprendre</button>
        <button class="btn" id="gfx">Graphismes : ${this.game.smoothActive ? 'lisses' : 'pixel'}</button>
        ${this.game.role === 'host' ? '<button class="btn" id="lobby">Arrêter et revenir au salon</button>' : ''}
        <button class="btn btn-ghost" id="leave">Quitter la partie</button>
      </div>
    `, 'pause', true);
    this.on('#resume', 'click', () => this.hide());
    this.on('#gfx', 'click', (e) => {
      const smooth = this.game.setSmoothTerrain(!this.game.smoothActive);
      (e.currentTarget as HTMLButtonElement).textContent = `Graphismes : ${smooth ? 'lisses' : 'pixel'}`;
    });
    this.on('#lobby', 'click', () => this.game.returnToLobby());
    this.on('#leave', 'click', () => {
      this.cb.onLeave();
      this.showMainMenu();
    });
  }

  public showDisconnected() {
    this.show(`
      <div class="card">
        <h2>Connexion perdue</h2>
        <p class="tagline">L'hôte a quitté la partie ou la connexion a été interrompue.</p>
        <button class="btn btn-primary" id="menu">Retour au menu</button>
      </div>
    `, 'disconnected');
    this.on('#menu', 'click', () => {
      this.cb.onLeave();
      this.showMainMenu();
    });
  }
}
