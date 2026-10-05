/**
 * Mutators: on/off switches chosen by the host in the lobby.
 * They are combined into simple numeric rules used by the simulation (`rulesOf`).
 */
export type MutatorId =
  | 'moon' | 'turbo' | 'superJump' | 'infiniteRope' | 'megaBlast' | 'ricochet'
  | 'vampire' | 'martyr' | 'frenzy' | 'chaos' | 'regen'
  | 'ghosts' | 'wind' | 'risingLava' | 'richMode'
  | 'noSelfDamage' | 'noHazards';

export interface MutatorInfo {
  id: MutatorId;
  icon: string;
  name: string;
  desc: string;
  group: 'move' | 'combat' | 'crazy' | 'rules';
}

export const MUTATOR_GROUPS: { id: MutatorInfo['group']; name: string }[] = [
  { id: 'move', name: 'Mouvement' },
  { id: 'combat', name: 'Combat' },
  { id: 'crazy', name: 'Délires' },
  { id: 'rules', name: 'Règles' }
];

export const MUTATORS: MutatorInfo[] = [
  { id: 'moon', icon: '🌙', name: 'Gravité lunaire', desc: 'Sauts immenses, chutes lentes.', group: 'move' },
  { id: 'turbo', icon: '⚡', name: 'Turbo', desc: 'Les sorciers courent 50 % plus vite.', group: 'move' },
  { id: 'superJump', icon: '🦘', name: 'Super-sauts', desc: 'Des bonds de kangourou.', group: 'move' },
  { id: 'infiniteRope', icon: '🪢', name: 'Grappin infini', desc: 'Le grappin s\'accroche à n\'importe quelle distance.', group: 'move' },

  { id: 'megaBlast', icon: '💥', name: 'Méga-explosions', desc: 'Cratères et souffles deux fois plus gros.', group: 'combat' },
  { id: 'frenzy', icon: '⏩', name: 'Frénésie', desc: 'Les sorts se relancent deux fois et demie plus vite.', group: 'combat' },
  { id: 'vampire', icon: '🧛', name: 'Vampirisme', desc: 'Chaque dégât infligé te soigne de moitié.', group: 'combat' },
  { id: 'regen', icon: '❤️', name: 'Régénération', desc: 'Les sorciers récupèrent 3 PV par seconde.', group: 'combat' },
  { id: 'ricochet', icon: '🎱', name: 'Ricochets', desc: 'Tous les sorts rebondissent 3 fois avant d\'exploser.', group: 'combat' },

  { id: 'chaos', icon: '🎲', name: 'Sorts aléatoires', desc: 'Après chaque lancer, ton sort change au hasard.', group: 'crazy' },
  { id: 'martyr', icon: '💣', name: 'Martyrs', desc: 'Les sorciers explosent en mourant. Gare aux kamikazes !', group: 'crazy' },
  { id: 'ghosts', icon: '👻', name: 'Fantômes', desc: 'Les ennemis sont invisibles… sauf quand ils lancent un sort ou sont touchés.', group: 'crazy' },
  { id: 'wind', icon: '🌬️', name: 'Tempête', desc: 'Un vent qui tourne pousse les sorts et les sorciers en l\'air.', group: 'crazy' },
  { id: 'risingLava', icon: '🌋', name: 'Lave montante', desc: 'Au bout de 30 s, la lave monte du fond de la carte. Grimpez !', group: 'crazy' },

  { id: 'richMode', icon: '💰', name: 'Grimoire ouvert', desc: 'Tous les sorts sont gratuits.', group: 'rules' },
  { id: 'noSelfDamage', icon: '🛡️', name: 'Pas d\'auto-dégâts', desc: 'Tes propres sorts ne te blessent pas.', group: 'rules' },
  { id: 'noHazards', icon: '🚫', name: 'Sans acide ni lave', desc: 'L\'acide disparaît et la lave devient de l\'eau.', group: 'rules' }
];

export const has = (mutators: readonly MutatorId[] | undefined, id: MutatorId) => !!mutators && mutators.includes(id);

/** Numbers the simulation needs (identical on every machine) */
export interface Rules {
  gravity: number;
  wormSpeed: number;
  jump: number;
  ropeReach: 'normal' | 'infinite';
  explosionScale: number;
  regenRate: number;       // HP per second
  cooldownScale: number;
  hazards: boolean;        // acid and lava
  noSelfDamage: boolean;
  freeSpells: boolean;
}

export function rulesOf(mutators: readonly MutatorId[] | undefined): Rules {
  const on = (id: MutatorId) => has(mutators, id);
  return {
    gravity: on('moon') ? 0.4 : 1,
    wormSpeed: on('turbo') ? 1.5 : 1,
    jump: on('superJump') ? 1.55 : 1,
    ropeReach: on('infiniteRope') ? 'infinite' : 'normal',
    explosionScale: on('megaBlast') ? 2 : 1,
    regenRate: on('regen') ? 3 : 0,
    cooldownScale: on('frenzy') ? 0.4 : 1,
    hazards: !on('noHazards'),
    noSelfDamage: on('noSelfDamage'),
    freeSpells: on('richMode')
  };
}
