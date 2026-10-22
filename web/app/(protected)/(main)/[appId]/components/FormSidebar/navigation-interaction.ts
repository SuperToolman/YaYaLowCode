export const NAVIGATION_DRAG_DELAY_MS = 100;

// Moving while waiting for the hold threshold must not cancel the drag.
export const NAVIGATION_DRAG_ACTIVATION = {
  delay: NAVIGATION_DRAG_DELAY_MS,
  tolerance: Number.POSITIVE_INFINITY,
};
