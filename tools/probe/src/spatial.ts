// Minimal D-pad navigation: move focus to the nearest element in the pressed direction.

export type Direction = "up" | "down" | "left" | "right";

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Picks the index of the best candidate box from `from` in `direction`, or -1 when nothing lies that way.
 * Candidates must be fully past the current box's edge; distance along the axis counts once,
 * and sideways offset counts double so focus prefers staying in the same row or column.
 */
export function nextIndex(from: Box, candidates: Box[], direction: Direction): number {
  const fromCx = from.left + from.width / 2;
  const fromCy = from.top + from.height / 2;
  let best = -1;
  let bestScore = Infinity;

  candidates.forEach((box, i) => {
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    let along: number;
    let across: number;
    switch (direction) {
      case "up":
        along = from.top - (box.top + box.height);
        across = Math.abs(cx - fromCx);
        break;
      case "down":
        along = box.top - (from.top + from.height);
        across = Math.abs(cx - fromCx);
        break;
      case "left":
        along = from.left - (box.left + box.width);
        across = Math.abs(cy - fromCy);
        break;
      case "right":
        along = box.left - (from.left + from.width);
        across = Math.abs(cy - fromCy);
        break;
    }
    // Allow a pixel of overlap for elements that share an edge.
    if (along < -1) return;
    const score = Math.max(along, 0) + across * 2;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

/** Arrow key codes, plus the codes some TV remotes send instead. */
export function directionForKey(keyCode: number): Direction | null {
  switch (keyCode) {
    case 37:
      return "left";
    case 38:
      return "up";
    case 39:
      return "right";
    case 40:
      return "down";
    default:
      return null;
  }
}
