import { CONFIG } from '../config';
import { Game } from '../engine/Game';
import { sound } from '../engine/SoundEffects';

function esc(str: string): string {
  return str.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/** In-game overlay: objective, kill feed, scoreboard and the local wizard's status. */
export class HUD {
  private root: HTMLElement;
  private objective: HTMLElement;
  private killfeed: HTMLElement;
  private scoreboard: HTMLElement;
  private status: HTMLElement;
  private hpFill: HTMLElement;
  private hpVal: HTMLElement;
  private weaponIcon: HTMLElement;
  private weaponName: HTMLElement;
  private ammo: HTMLElement;
  private reloadFill: HTMLElement;
  private money: HTMLElement;
  private net: HTMLElement;
  private lastScoreHtml = '';

  constructor(container: HTMLElement) {
    this.root = container;
    const hud = document.createElement('div');
    hud.className = 'hud';
    hud.innerHTML = `
      <div class="hud-tools">
        <button class="hud-box icon-btn" id="hud-mute" title="Son (M)">🔊</button>
        <button class="hud-box icon-btn" id="hud-fs" title="Plein écran (F11)">⛶</button>
        <div class="hud-box net-pill" id="hud-net"><span class="led"></span><span></span></div>
      </div>
      <div class="hud-box hud-objective" id="hud-objective"></div>
      <div class="killfeed" id="hud-killfeed"></div>
      <div class="hud-box scoreboard" id="hud-scoreboard"></div>
      <div class="hud-box status-box" id="hud-status">
        <div class="hp-row">
          <span>❤️</span>
          <div class="bar"><div id="hud-hp"></div></div>
          <span class="hp-val" id="hud-hp-val"></span>
        </div>
        <div class="weapon-row">
          <span id="hud-wicon"></span>
          <span class="wname" id="hud-wname"></span>
          <span class="ammo" id="hud-ammo"></span>
        </div>
        <div class="reload"><div id="hud-reload"></div></div>
        <div class="money" id="hud-money"></div>
      </div>
    `;
    container.appendChild(hud);

    const q = (id: string) => hud.querySelector(id) as HTMLElement;
    this.objective = q('#hud-objective');
    this.killfeed = q('#hud-killfeed');
    this.scoreboard = q('#hud-scoreboard');
    this.status = q('#hud-status');
    this.hpFill = q('#hud-hp');
    this.hpVal = q('#hud-hp-val');
    this.weaponIcon = q('#hud-wicon');
    this.weaponName = q('#hud-wname');
    this.ammo = q('#hud-ammo');
    this.reloadFill = q('#hud-reload');
    this.money = q('#hud-money');
    this.net = q('#hud-net');

    const muteBtn = q('#hud-mute');
    const syncMute = () => { muteBtn.textContent = sound.enabled ? '🔊' : '🔇'; };
    syncMute();
    muteBtn.addEventListener('click', () => { sound.toggleMuted(); syncMute(); });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM' && !(e.target instanceof HTMLInputElement)) { sound.toggleMuted(); syncMute(); }
    });
    q('#hud-fs').addEventListener('click', () => {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
      else document.exitFullscreen().catch(() => {});
    });

    this.setVisible(false);
  }

  public setVisible(visible: boolean) {
    this.root.classList.toggle('hidden', !visible);
  }

  public clearKills() {
    this.killfeed.innerHTML = '';
  }

  public showKill(killer: string | null, victim: string, cause?: 'acid' | 'self') {
    const line = document.createElement('div');
    line.className = 'kill';
    if (killer) line.innerHTML = `<b>${esc(killer)}</b> ✦ ${esc(victim)}`;
    else if (cause === 'acid') line.innerHTML = `<b>${esc(victim)}</b> s'est dissous dans l'acide`;
    else line.innerHTML = `<b>${esc(victim)}</b> s'est fait exploser`;
    this.killfeed.prepend(line);
    while (this.killfeed.children.length > 4) this.killfeed.lastElementChild?.remove();
    setTimeout(() => line.classList.add('fade'), 4000);
    setTimeout(() => line.remove(), 4500);
  }

  public update(game: Game) {
    const mods = game.modifiers;
    const local = game.getLocalWorm();

    // Objective / score
    if (mods.gameMode === 'teams') {
      const [r, b] = game.teamScores;
      this.objective.innerHTML = `<span class="t0">Rouge ${r}</span> — <span class="t1">${b} Bleu</span> · objectif ${mods.fragLimit}`;
    } else if (mods.gameMode === 'koth') {
      const goal = mods.fragLimit * CONFIG.KOTH_SECONDS_PER_POINT;
      const mine = local ? Math.floor(local.score / 60) : 0;
      this.objective.textContent = `👑 Tiens la zone centrale seul · toi : ${mine} / ${goal} s`;
    } else {
      this.objective.textContent = `⚔️ Premier à ${mods.fragLimit} frags`;
    }

    // Network status
    const netText = this.net.lastElementChild as HTMLElement;
    const stalled = game.role === 'client' && performance.now() - game.net.lastPacketTime > 1500;
    this.net.classList.toggle('bad', !game.net.isConnected);
    this.net.classList.toggle('warn', game.net.isConnected && stalled);
    if (!game.net.isConnected) netText.textContent = 'Déconnecté';
    else if (stalled) netText.textContent = "L'hôte ne répond pas…";
    else if (game.role === 'host' && game.net.guestCount === 0) netText.textContent = 'Seul dans le salon';
    else netText.textContent = game.net.pingMs ? `${game.net.pingMs} ms` : 'Connecté';

    // Scoreboard
    const koth = mods.gameMode === 'koth';
    const html = game.getStandings().map(w => {
      const team = mods.gameMode === 'teams' ? CONFIG.TEAM_COLORS[game.teamOf(w.id)] : null;
      const val = koth ? `${Math.floor(w.score / 60)} s` : `${w.frags}`;
      return `<div class="sb-row ${w === local ? 'me' : ''} ${w.isAlive() ? '' : 'dead'}">
        <span class="dot" style="background:${w.color};color:${team ?? w.color}"></span>
        <span class="name">${esc(w.name)}</span>
        <span class="val">${val}</span>
      </div>`;
    }).join('');
    if (html !== this.lastScoreHtml) {
      this.scoreboard.innerHTML = html;
      this.lastScoreHtml = html;
    }

    // Local wizard
    this.status.style.display = local && local.isAlive() ? '' : 'none';
    if (!local || !local.isAlive()) return;
    const pct = Math.max(0, Math.min(100, (local.health / local.maxHealth) * 100));
    this.hpFill.style.width = `${pct}%`;
    this.hpFill.className = pct < 30 ? 'crit' : pct < 60 ? 'warn' : '';
    this.hpVal.textContent = String(Math.ceil(local.health));

    const w = local.weapon;
    this.weaponIcon.textContent = w.icon;
    this.weaponName.textContent = w.name;
    if (mods.unlimitedAmmo) {
      this.ammo.textContent = '∞';
      this.reloadFill.style.width = local.shotCooldown > 0 ? `${100 - (local.shotCooldown / w.reloadTime) * 100}%` : '100%';
    } else if (local.clipReloadCooldown > 0) {
      this.ammo.textContent = 'Recharge…';
      this.reloadFill.style.width = `${100 - (local.clipReloadCooldown / w.clipReloadTime) * 100}%`;
    } else {
      this.ammo.textContent = `${local.clipAmmo} / ${w.clipSize}`;
      this.reloadFill.style.width = local.shotCooldown > 0 ? `${100 - (local.shotCooldown / w.reloadTime) * 100}%` : '100%';
    }
    this.money.textContent = `✨ ${local.money} or`;
  }
}
