/**
 * World forces shared by everything that moves (host simulation, client prediction, particles):
 * gravity anomalies (multiplier, negative = upwards) and the storm wind (acceleration per tick).
 */
export const WORLD_ENV = {
  gravityAt: (_x: number, _y: number): number => 1,
  wind: 0
};
