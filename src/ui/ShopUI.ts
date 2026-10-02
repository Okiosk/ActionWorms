/**
 * ShopUI — Écran de boutique d'armes affiché entre la mort et le respawn.
 *
 * Fonctionnement :
 *  - S'affiche quand le ver local meurt (respawnTimer démarre dans Game).
 *  - Montre le solde actuel, un countdown de respawn, et la liste de toutes
 *    les armes avec leur prix.
 *  - Le joueur sélectionne une arme et clique "Acheter & Respawn".
 *  - L'arme est appliquée immédiatement ; si le joueur n'a pas assez d'argent
 *    il doit choisir une arme gratuite.
 */

import { WEAPON_REGISTRY, ALL_WEAPON_IDS, MONEY_KILL, MONEY_DEATH } from '../weapons/WeaponRegistry';
import { WeaponId } from '../weapons/WeaponDef';
import { Worm } from '../engine/Worm';

type OnBuyCallback = (weaponId: WeaponId) => void;

export class ShopUI {
  private el: HTMLElement;
  private worm: Worm | null = null;
  private countdown: number = 0;
  private selectedId: WeaponId | null = null;
  private onBuy: OnBuyCallback | null = null;
  private animFrame: number = 0;
  private visible: boolean = false;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'shop-overlay';
    this.el.style.display = 'none';
    container.appendChild(this.el);
  }

  /** Affiche la boutique pour le ver donné, avec un timer de respawn en frames. */
  public show(worm: Worm, respawnFrames: number, onBuy: OnBuyCallback) {
    this.worm = worm;
    this.countdown = respawnFrames;
    this.onBuy = onBuy;
    this.selectedId = null;
    this.visible = true;
    this.el.style.display = 'flex';
    this.render();
  }

  /** Cache la boutique. */
  public hide() {
    this.visible = false;
    this.el.style.display = 'none';
    this.worm = null;
  }

  public isVisible() { return this.visible; }

  /** Appelé chaque frame par Game.ts pour mettre à jour le countdown. */
  public tick() {
    if (!this.visible || !this.worm) return;
    this.countdown = Math.max(0, this.countdown - 1);
    this.renderCountdown();
    if (this.countdown <= 0) {
      // Auto-respawn avec bazooka si rien choisi
      this._confirmPurchase(this.selectedId ?? 'bazooka');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────────────

  private render() {
    if (!this.worm) return;
    const w = this.worm;
    const secs = Math.ceil(this.countdown / 60);

    const rows = ALL_WEAPON_IDS.map(id => {
      const def = WEAPON_REGISTRY[id];
      const canAfford = w.money >= def.price;
      const isFree = def.price === 0;
      const isSelected = id === this.selectedId;

      return `
        <div class="shop-row${isSelected ? ' selected' : ''}${canAfford ? '' : ' cant-afford'}"
             data-id="${id}">
          <span class="shop-icon">${def.icon}</span>
          <div class="shop-info">
            <span class="shop-name">${def.name}</span>
            <span class="shop-desc">${def.description}</span>
          </div>
          <span class="shop-price ${isFree ? 'free' : canAfford ? 'ok' : 'expensive'}">
            ${isFree ? '🆓 GRATUIT' : `💰 ${def.price}`}
          </span>
        </div>`;
    }).join('');

    this.el.innerHTML = `
      <div class="shop-panel">
        <div class="shop-header">
          <div class="shop-title">⚔️ ARMURERIE</div>
          <div class="shop-balance">💰 Solde : <b>${w.money}</b></div>
          <div class="shop-hint">Kill +${MONEY_KILL} · Mort +${MONEY_DEATH}</div>
        </div>
        <div class="shop-list" id="shop-list">${rows}</div>
        <div class="shop-footer">
          <div class="shop-countdown">Respawn dans <b id="shop-secs">${secs}</b>s</div>
          <button class="shop-btn" id="shop-confirm" ${this.selectedId ? '' : 'disabled'}>
            ${this.selectedId ? `Acheter ${WEAPON_REGISTRY[this.selectedId].icon} ${WEAPON_REGISTRY[this.selectedId].name} → Spawn !` : 'Sélectionnez une arme'}
          </button>
        </div>
      </div>`;

    // Events
    this.el.querySelectorAll('.shop-row').forEach(row => {
      row.addEventListener('click', () => {
        const id = (row as HTMLElement).dataset.id as WeaponId;
        const def = WEAPON_REGISTRY[id];
        if (w.money >= def.price) {
          this.selectedId = id;
          this.render();
        }
      });
    });

    const confirmBtn = this.el.querySelector('#shop-confirm') as HTMLButtonElement;
    confirmBtn?.addEventListener('click', () => {
      if (this.selectedId) this._confirmPurchase(this.selectedId);
    });
  }

  private renderCountdown() {
    const secsEl = this.el.querySelector('#shop-secs');
    if (secsEl) secsEl.textContent = String(Math.ceil(this.countdown / 60));
  }

  private _confirmPurchase(id: WeaponId) {
    if (!this.worm || !this.onBuy) return;
    const def = WEAPON_REGISTRY[id];
    // Déduire le coût si non gratuit
    if (def.price > 0) {
      const canAfford = this.worm.money >= def.price;
      if (!canAfford) {
        // Fallback bazooka
        this.onBuy('bazooka');
        this.hide();
        return;
      }
      this.worm.money -= def.price;
    }
    this.onBuy(id);
    this.hide();
  }
}
