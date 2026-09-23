import { Game } from '../engine/Game';
import { Worm } from '../engine/Worm';

export class HUD {
  private container: HTMLElement;
  private p1HpBar: HTMLElement;
  private p1HpText: HTMLElement;
  private p1AmmoText: HTMLElement;
  private p1WeaponName: HTMLElement;
  private p1WeaponSlots: HTMLElement;
  private p1Frags: HTMLElement;

  private p2Container: HTMLElement;
  private p2Name: HTMLElement;
  private p2HpBar: HTMLElement;
  private p2HpText: HTMLElement;
  private p2Frags: HTMLElement;

  private killFeedEl: HTMLElement;
  private killFeedTimeout: number | null = null;
  private netBadgeEl: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.innerHTML = `
      <div class="hud-top">
        <!-- Player 1 HUD -->
        <div class="hud-player p1-hud">
          <div class="hud-row">
            <span class="hud-name" id="hud-p1-name">P1</span>
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

        <!-- Kill Feed & Info -->
        <div class="hud-center">
          <div class="hud-killfeed" id="hud-killfeed"></div>
          <div class="hud-net-badge" id="hud-net-badge" style="display:none; font-size:11px; padding:3px 10px; border-radius:12px; margin-bottom:5px; font-weight:600; font-family:monospace; box-shadow:0 2px 6px rgba(0,0,0,0.4); text-align:center;"></div>
          <button class="btn-fullscreen" id="btn-toggle-fullscreen" title="Plein Écran">⛶ Plein Écran</button>
        </div>

        <!-- Player 2 / Opponent HUD -->
        <div class="hud-player p2-hud" id="hud-p2-container">
          <div class="hud-row">
            <span class="hud-frags" id="hud-p2-frags">🏆 0</span>
            <span class="hud-hp-val" id="hud-p2-hp-text">100</span>
            <div class="hud-bar-bg">
              <div class="hud-bar-fill" id="hud-p2-hp" style="width: 100%;"></div>
            </div>
            <span class="hud-name" id="hud-p2-name">P2</span>
          </div>
        </div>
      </div>

      <!-- Controls Quick Guide at bottom -->
      <div class="hud-controls-hint" id="hud-controls-hint">
        🎮 <b>Contrôles :</b> [Q / D] Déplacement | [Z / Espace] Sauter | [Souris / Visée] Tirer [Clic G] | [Clic D / E] Grappin | [1-5 / Molette] Armes | [⛶] Plein Écran
      </div>
    `;

    this.container.querySelector('#btn-toggle-fullscreen')?.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    });

    this.p1HpBar = this.container.querySelector('#hud-p1-hp')!;
    this.p1HpText = this.container.querySelector('#hud-p1-hp-text')!;
    this.p1AmmoText = this.container.querySelector('#hud-p1-ammo')!;
    this.p1WeaponName = this.container.querySelector('#hud-p1-weapon')!;
    this.p1WeaponSlots = this.container.querySelector('#hud-p1-slots')!;
    this.p1Frags = this.container.querySelector('#hud-p1-frags')!;

    this.p2Container = this.container.querySelector('#hud-p2-container')!;
    this.p2Name = this.container.querySelector('#hud-p2-name')!;
    this.p2HpBar = this.container.querySelector('#hud-p2-hp')!;
    this.p2HpText = this.container.querySelector('#hud-p2-hp-text')!;
    this.p2Frags = this.container.querySelector('#hud-p2-frags')!;

    this.killFeedEl = this.container.querySelector('#hud-killfeed')!;
    this.netBadgeEl = this.container.querySelector('#hud-net-badge')!;
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
    if (game.mode === 'online_host' || game.mode === 'online_client') {
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
        this.netBadgeEl.textContent = `🟢 Hôte P2P | ${game.net.packetsReceivedPerSec} pkt/s | Ping: ${ping}`;
      } else {
        const ping = game.net.pingMs ? `${game.net.pingMs}ms` : '<1ms';
        this.netBadgeEl.style.background = 'rgba(20, 140, 40, 0.8)';
        this.netBadgeEl.style.color = '#fff';
        this.netBadgeEl.textContent = `🟢 Client P2P | ${game.net.packetsReceivedPerSec} pkt/s | Ping: ${ping}`;
      }
    } else {
      this.netBadgeEl.style.display = 'none';
    }

    // Identify local player and opponent
    const p1 = game.worms.find(w => w.id === 'p1' || (game.net.myPeerId && w.id === game.net.myPeerId)) || game.worms[0];
    const p2 = game.worms.find(w => w !== p1) || null;

    if (p1) {
      // HP Bar
      const hpPct = Math.max(0, Math.min(100, p1.health));
      this.p1HpBar.style.width = `${hpPct}%`;
      this.p1HpBar.className = `hud-bar-fill ${hpPct < 30 ? 'critical' : hpPct < 60 ? 'warning' : ''}`;
      this.p1HpText.textContent = `${Math.ceil(p1.health)}`;
      this.p1Frags.textContent = `🏆 ${p1.frags}`;

      // Current Weapon & Ammo
      const curWep = p1.getCurrentWeapon();
      this.p1WeaponName.textContent = `${curWep.icon} ${curWep.name}`;

      if (p1.clipReloadCooldown > 0) {
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

    if (p2) {
      this.p2Container.style.display = 'flex';
      this.p2Name.textContent = p2.name;
      const hpPct = Math.max(0, Math.min(100, p2.health));
      this.p2HpBar.style.width = `${hpPct}%`;
      this.p2HpBar.className = `hud-bar-fill ${hpPct < 30 ? 'critical' : hpPct < 60 ? 'warning' : ''}`;
      this.p2HpText.textContent = `${Math.ceil(p2.health)}`;
      this.p2Frags.textContent = `🏆 ${p2.frags}`;
    } else {
      this.p2Container.style.display = 'none';
    }
  }
}
