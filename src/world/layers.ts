/**
 * Render layers. Whatever the hall mirror can't show is moved to `far`, so its reflection draws only
 * the rooms around it (the cameras that see everything enable `far`); `mirror` holds things seen only
 * in the mirror.
 */
export const LAYERS = { far: 1, mirror: 2 };
