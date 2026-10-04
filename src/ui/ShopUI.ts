import { WEAPON_REGISTRY, ALL_WEAPON_IDS, DEFAULT_WEAPON, MONEY_KILL, MONEY_DEATH } from '../weapons/WeaponRegistry';
import { WeaponId } from '../weapons/WeaponDef';
import { Worm } from '../engine/Worm';

const SPELLS = [...ALL_WEAPON_IDS].sort((a, b) => WEAPON_REGISTRY[a].price - WEAPON_REGISTRY[b].price);

/**
 * Grimoire: pick a spell before each (re)spawn. The last spell is pre-selected,
 * so respawning is a single click / Enter.
 */
export class ShopUI {
  private el: HTMLElement;
  private worm: Worm | null = null;
  private selected: WeaponId = DEFAULT_WEAPON;
  private lastChoice: WeaponId = DEFAULT_WEAPON;
  private onChoose: ((id: WeaponId) => void) | null = null;
  private visible = false;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'shop-overlay';
    container.appendChild(this.el);

    window.addEventListener('keydown', (e) => {
      if (!this.visible || e.repeat) return;
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault();
        this.confirm();
      }
    });
  }

  public show(worm: Worm, onChoose: (id: WeaponId) => void) {
    this.worm = worm;
    this.onChoose = onChoose;
    this.selected = this.canAfford(this.lastChoice) ? this.lastChoice : DEFAULT_WEAPON;
    this.visible = true;
    this.el.classList.add('open');
    this.render();
  }

  public hide() {
    this.visible = false;
    this.el.classList.remove('open');
    this.worm = null;
  }

  public isVisible() {
    return this.visible;
  }

  private canAfford(id: WeaponId): boolean {
    return !!this.worm && this.worm.money >= WEAPON_REGISTRY[id].price;
  }

  private render() {
    if (!this.worm) return;
    const money = this.worm.money;
    const sel = WEAPON_REGISTRY[this.selected];

    this.el.innerHTML = `
      <div class="shop">
        <div class="shop-head">
          <h2>Choisis ton sort</h2>
          <span class="money">✨ ${money} or</span>
        </div>
        <div class="spell-grid">
          ${SPELLS.map(id => {
            const d = WEAPON_REGISTRY[id];
            const cls = [id === this.selected ? 'selected' : '', money < d.price ? 'locked' : ''].join(' ');
            return `
              <button class="spell ${cls}" data-id="${id}" style="--spell-color:${d.elementColor}">
                <span class="icon">${d.icon}</span>
                <span class="sname">${d.name}</span>
                <span class="price ${d.price === 0 ? 'free' : ''}">${d.price === 0 ? 'Gratuit' : `${d.price} or`}</span>
              </button>`;
          }).join('')}
        </div>
        <div class="spell-detail">
          <span class="icon">${sel.icon}</span>
          <div class="txt">
            <b>${sel.name}</b>
            ${sel.description}
            <div class="stats">${sel.spellSchool}${sel.damage > 0 ? ` · Dégâts ${sel.damage}${sel.pelletCount ? ` × ${sel.pelletCount}` : ''}` : ''} · ${sel.clipSize} charge${sel.clipSize > 1 ? 's' : ''}</div>
          </div>
          <button class="btn btn-primary btn-big" id="shop-go">Entrer dans l'arène</button>
        </div>
        <div class="hint">Double-clic ou <kbd>Entrée</kbd> pour valider · +${MONEY_KILL} or par sorcier vaincu, +${MONEY_DEATH} or par mort</div>
      </div>`;

    this.el.querySelectorAll<HTMLElement>('.spell').forEach(btn => {
      const id = btn.dataset.id as WeaponId;
      btn.addEventListener('click', () => {
        if (!this.canAfford(id)) return;
        this.selected = id;
        this.render();
      });
      btn.addEventListener('dblclick', () => {
        if (!this.canAfford(id)) return;
        this.selected = id;
        this.confirm();
      });
    });
    this.el.querySelector('#shop-go')?.addEventListener('click', () => this.confirm());
  }

  private confirm() {
    if (!this.worm || !this.onChoose) return;
    const id = this.canAfford(this.selected) ? this.selected : DEFAULT_WEAPON;
    this.lastChoice = id;
    const cb = this.onChoose;
    this.hide();
    cb(id);
  }
}
