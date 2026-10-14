/**
 * Render layers. The cell is built on `far`, which the cameras that see everything enable; each real
 * mirror (mirror.ts) draws only its own view layer, where the rooms around it are as well, and layer
 * 0, where everything added later goes (players, anomalies). `mirror` holds things seen only in the
 * hall mirror, `self` our own full figure, which only the mirrors show (self.ts).
 */
export const LAYERS = { far: 1, mirror: 2, hallView: 3, bathView: 4, bedroomView: 5, self: 6 };
