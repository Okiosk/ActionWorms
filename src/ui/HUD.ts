import { Game } from '../engine/Game';
import { Worm } from '../engine/Worm';

export class HUD {
  private container: HTMLElement;
  private p1Name: HTMLElement;
  private p1HpBar: HTMLElement;
  private p1HpText: HTMLElement;
  private p1AmmoText: HTMLElement;
  private p1WeaponName: HTMLElement;
  private p1WeaponSlots: HTMLElement;
  private p1Frags: HTMLElement;
  private p1ColorDot: HTMLElement;

  private scoreboardEl: HTMLElement;
  private killFeedEl: HTMLElement;
  private killFeedTimeout: number | null = null;
  private netBadgeEl: HTMLElement;
  private matchRuleBadgeEl: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.innerHTML = `
      <div class="hud-top">
        <!-- Local Player HUD (Left) -->
        <div class="hud-player p1-hud">
          <div class="hud-row">
            <span class="hud-player-dot" id="hud-p1-dot"></span>
            <span class="hud-name" id="hud-p1-name">Moi</span>
            <div class="hud-bar-bg">
              <div class="hud-bar-fill" id="hud-p1-hp" style="width: 100%;"></div>
            </div>
            <span class="hud-hp-val" id="hud-p1-hp-text">100</span>
            <span class="hud-frags" id="hud-p1-frags">🏆 0</span>
          </div>
          <div class="hud-weapon-row">
            <span class="hud-weapon-active" id="hud-p1-weapon">Bazooka</span>
            <span class="hud-ammo-val" id="hud-p1-ammo">● 1/1</span>
          </div>
          <div class="hud-slots" id="hud-p1-slots"></div>
        </div>

        <!-- Center: Kill Feed, Net Badge & Rule Banner -->
        <div class="hud-center">
          <div class="hud-killfeed" id="hud-killfeed"></div>
          <div class="hud-net-badge" id="hud-net-badge" style="display:none;"></div>
          <div class="hud-rule-badge" id="hud-rule-badge"></div>
          <button class="btn-fullscreen" id="btn-toggle-fullscreen" title="Plein Écran">⛶ Plein Écran</button>
        </div>

        <!-- Multi-player Leaderboard (Right, up to 7 opponents) -->
        <div class="hud-scoreboard" id="hud-scoreboard"></div>
      </div>
    `;

    this.container.querySelector('#btn-toggle-fullscreen')?.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    });

    this.p1Name = this.container.querySelector('#hud-p1-name')!;
    this.p1ColorDot = this.container.querySelector('#hud-p1-dot')!;
    this.p1HpBar = this.container.querySelector('#hud-p1-hp')!;
    this.p1HpText = this.container.querySelector('#hud-p1-hp-text')!;
    this.p1AmmoText = this.container.querySelector('#hud-p1-ammo')!;
    this.p1WeaponName = this.container.querySelector('#hud-p1-weapon')!;
    this.p1WeaponSlots = this.container.querySelector('#hud-p1-slots')!;
    this.p1Frags = this.container.querySelector('#hud-p1-frags')!;

    this.scoreboardEl = this.container.querySelector('#hud-scoreboard')!;
    this.killFeedEl = this.container.querySelector('#hud-killfeed')!;
    this.netBadgeEl = this.container.querySelector('#hud-net-badge')!;
    this.matchRuleBadgeEl = this.container.querySelector('#hud-rule-badge')!;
  }

  public showKill(killer: string, victim: string) {
    this.killFeedEl.textContent = `${killer} 💥 ${victim}`;
    this.killFeedEl.classList.add('visible');

    if (this.killFeedTimeout) clearTimeout(this.killFeedTimeout);
    this.killFeedTimeout = window.setTimeout(() => {
      this.killFeedEl.classList.remove('visible');
    }, 2500);
  }

  public update(game: Game) {
    if (!game.isRunning || game.worms.length === 0) return;

    // Network Diagnostics HUD
    this.netBadgeEl.style.display = 'block';
    const now = performance.now();
    const timeSinceLastPacket = now - game.net.lastPacketTime;
    const isStalled = game.net.isConnected && game.net.lastPacketTime > 0 && timeSinceLastPacket > 1500;

    if (!game.net.isConnected) {
      this.netBadgeEl.style.background = 'rgba(200, 30, 30, 0.8)';
      this.netBadgeEl.style.color = '#fff';
      this.netBadgeEl.textContent = '🔴 Déconnecté';
    } else if (isStalled) {
      this.netBadgeEl.style.background = 'rgba(220, 150, 10, 0.85)';
      this.netBadgeEl.style.color = '#fff';
      this.netBadgeEl.textContent = `🟡 En attente de l'hôte (${Math.round(timeSinceLastPacket / 1000)}s)...`;
    } else if (game.mode === 'online_host') {
      const ping = game.net.pingMs ? `${game.net.pingMs}ms` : '<1ms';
      this.netBadgeEl.style.background = 'rgba(20, 140, 40, 0.8)';
      this.netBadgeEl.style.color = '#fff';
      this.netBadgeEl.textContent = `🟢 Hôte P2P | ${game.worms.length}/8 Vers | Ping: ${ping}`;
    } else {
      const ping = game.net.pingMs ? `${game.net.pingMs}ms` : '<1ms';
      this.netBadgeEl.style.background = 'rgba(20, 140, 40, 0.8)';
      this.netBadgeEl.style.color = '#fff';
      this.netBadgeEl.textContent = `🟢 Client P2P | ${game.worms.length}/8 Vers | Ping: ${ping}`;
    }

    // Match Rules Banner
    const mods = game.modifiers;
    let ruleText = `Objectif: ${game.fragLimit} Frags`;
    if (mods.gravity === 0.35) ruleText += ` • 🌙 Gravité Lunaire`;
    if (mods.gravity === 0.0) ruleText += ` • 🚀 Zéro-G`;
    if (mods.ropeReach === 'infinite') ruleText += ` • ♾️ Grappin Infini`;
    if (mods.unlimitedAmmo) ruleText += ` • 💥 Tirs Illimités`;
    if (mods.wormSpeed === 1.5) ruleText += ` • 🔥 Turbo`;
    // KOTH score indicator
    if (mods.gameMode === 'koth' && (game as any).kothScores) {
      const scores = (game as any).kothScores as number[];
      ruleText = `👑 KOTH | 🔴 ${scores[0]} - ${scores[1]} 🔵 | Objectif: ${game.fragLimit}`;
    }
    this.matchRuleBadgeEl.textContent = ruleText;

    // Identify local player
    const p1 = game.getLocalWorm() || game.worms[0];

    if (p1) {
      const myTeam = mods.gameMode === 'teams' ? (mods.teams[p1.id] === 0 ? ' 🔴' : ' 🔵') : '';
      this.p1Name.textContent = `${p1.name}${myTeam}`;
      this.p1ColorDot.style.background = p1.color;

      // HP Bar
      const maxHp = p1.maxHealth || 100;
      const hpPct = Math.max(0, Math.min(100, (p1.health / maxHp) * 100));
      this.p1HpBar.style.width = `${hpPct}%`;
      this.p1HpBar.className = `hud-bar-fill ${hpPct < 30 ? 'critical' : hpPct < 60 ? 'warning' : ''}`;
      this.p1HpText.textContent = `${Math.ceil(p1.health)}`;
      this.p1Frags.textContent = `🏆 ${p1.frags}`;

      // Current Weapon & Ammo
      const curWep = p1.getCurrentWeapon();
      this.p1WeaponName.textContent = `${curWep.icon} ${curWep.name}`;

      if (p1.modifiers.unlimitedAmmo) {
        this.p1AmmoText.textContent = `● ∞`;
        this.p1AmmoText.style.color = '#44ffaa';
      } else if (p1.clipReloadCooldown > 0) {
        this.p1AmmoText.textContent = `⏳ Rechargement...`;
        this.p1AmmoText.style.color = '#ffaa33';
      } else {
        this.p1AmmoText.textContent = `● ${p1.clipAmmo} / ${curWep.clipSize}`;
        this.p1AmmoText.style.color = '#ffffff';
      }

      // Weapon Slots
      let slotsHtml = '';
      p1.weapons.forEach((w, idx) => {
        const isSelected = idx === p1.currentWeaponIndex;
        slotsHtml += `
          <div class="hud-slot ${isSelected ? 'active' : ''}" data-idx="${idx}">
            <span class="slot-num">${idx + 1}</span>
            <span class="slot-icon">${w.icon}</span>
          </div>
        `;
      });
      if (this.p1WeaponSlots.innerHTML !== slotsHtml) {
        this.p1WeaponSlots.innerHTML = slotsHtml;
      }
    }

    // Opponents Scoreboard (All worms except local player)
    const opponents = game.worms.filter(w => w !== p1);
    if (opponents.length > 0) {
      this.scoreboardEl.style.display = 'flex';
      let scoreHtml = '';
      for (const opp of opponents) {
        const maxHp = opp.maxHealth || 100;
        const hpPct = Math.max(0, Math.min(100, (opp.health / maxHp) * 100));
        const team = mods.gameMode === 'teams' ? (mods.teams[opp.id] === 0 ? ' 🔴' : ' 🔵') : '';
        scoreHtml += `
          <div class="scoreboard-row">
            <span class="score-dot" style="background:${opp.color}"></span>
            <span class="score-name">${this.escapeHtml(opp.name)}${team}</span>
            <div class="score-bar-bg">
              <div class="score-bar-fill ${hpPct < 30 ? 'critical' : hpPct < 60 ? 'warning' : ''}" style="width:${hpPct}%"></div>
            </div>
            <span class="score-hp">${Math.ceil(opp.health)}</span>
            <span class="score-frags">🏆 ${opp.frags}</span>
          </div>
        `;
      }
      if (this.scoreboardEl.innerHTML !== scoreHtml) {
        this.scoreboardEl.innerHTML = scoreHtml;
      }
    } else {
      this.scoreboardEl.style.display = 'none';
    }
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
