/**
 * ShopUI — Écran de Grimoire Magique & Sanctuaire des Sorts.
 *
 * Affiché avant le premier spawn et entre chaque réincarnation.
 * Le joueur peut prendre tout son temps pour choisir son sort.
 * Le respawn se déclenche uniquement en confirmant l'incantation.
 */

import { WEAPON_REGISTRY, ALL_WEAPON_IDS, MONEY_KILL, MONEY_DEATH } from '../weapons/WeaponRegistry';
import { WeaponId } from '../weapons/WeaponDef';
import { Worm } from '../engine/Worm';

type OnBuyCallback = (weaponId: WeaponId) => void;

export class ShopUI {
  private el: HTMLElement;
  private worm: Worm | null = null;
  private selectedId: WeaponId | null = null;
  private onBuy: OnBuyCallback | null = null;
  private visible: boolean = false;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'shop-overlay';
    this.el.style.display = 'none';
    container.appendChild(this.el);
  }

  /** Affiche le Grimoire pour le sorcier. Pas de compte à rebours. */
  public show(worm: Worm, onBuy: OnBuyCallback) {
    this.worm = worm;
    this.onBuy = onBuy;
    this.selectedId = null;
    this.visible = true;
    this.el.style.display = 'flex';
    this.render();
  }

  /** Cache le Grimoire. */
  public hide() {
    this.visible = false;
    this.el.style.display = 'none';
    this.worm = null;
  }

  public isVisible() { return this.visible; }

  public tick() {
    // Pas de compte à rebours automatique
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────────────

  private render() {
    if (!this.worm) return;
    const w = this.worm;

    const rows = ALL_WEAPON_IDS.map(id => {
      const def = WEAPON_REGISTRY[id];
      const canAfford = w.money >= def.price;
      const isFree = def.price === 0;
      const isSelected = id === this.selectedId;
      const elemColor = def.elementColor || '#ffd700';

      return `
        <div class="shop-row${isSelected ? ' selected' : ''}${canAfford ? '' : ' cant-afford'}"
             data-id="${id}" style="${isSelected ? `border-color: ${elemColor}; box-shadow: 0 0 10px ${elemColor}44;` : ''}">
          <span class="shop-icon">${def.icon}</span>
          <div class="shop-info">
            <div class="shop-name-row">
              <span class="shop-name">${def.name}</span>
              ${def.spellSchool ? `<span class="spell-school-tag" style="color: ${elemColor}; border-color: ${elemColor}66;">${def.spellSchool}</span>` : ''}
            </div>
            <span class="shop-desc">${def.description}</span>
          </div>
          <span class="shop-price ${isFree ? 'free' : canAfford ? 'ok' : 'expensive'}">
            ${isFree ? '✨ INNÉ' : `✨ ${def.price}`}
          </span>
        </div>`;
    }).join('');

    this.el.innerHTML = `
      <div class="shop-panel">
        <div class="shop-header">
          <div class="shop-title">🧙‍♂️ GRIMOIRE ARCANIQUE — SANCTUAIRE DES SORTS</div>
          <div class="shop-balance">✨ Réserve de Mana : <b>${w.money}</b></div>
          <div class="shop-hint">Sorcier terrassé +${MONEY_KILL} ✨ · Réincarnation +${MONEY_DEATH} ✨</div>
        </div>
        <div class="shop-list" id="shop-list">${rows}</div>
        <div class="shop-footer">
          <button class="shop-btn" id="shop-confirm" ${this.selectedId ? '' : 'disabled'}>
            ${this.selectedId
              ? `${WEAPON_REGISTRY[this.selectedId].icon} Invoquer "${WEAPON_REGISTRY[this.selectedId].name}" → Entrer dans l'Arène !`
              : 'Sélectionnez un sort à imprégner dans votre bâton'}
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

  private _confirmPurchase(id: WeaponId) {
    if (!this.worm || !this.onBuy) return;
    const def = WEAPON_REGISTRY[id];
    // Déduire le mana
    if (def.price > 0) {
      if (this.worm.money < def.price) {
        // Fallback sort gratuit (bazooka = Boule de Feu)
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
