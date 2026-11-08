// Drag-to-reorder built on Pointer Events rather than HTML5 drag-and-drop.
//
// HTML5 drag fires no events for touch, so a phone gets nothing from it — and
// the phone is the main way photos get added here. Pointer Events are one API
// for touch, mouse, and stylus, which is why this is hand-rolled rather than
// the four-line draggable version.

import { insertionIndexFor } from "./list.js";

const EDGE_ZONE_PX = 96;
const EDGE_STEP_PX = 14;
// A press is not a drag until it travels: without this a tap picked a tile up
// and dropped it wherever the finger happened to be.
const DRAG_THRESHOLD_PX = 6;

/**
 * Makes the rows of `list` draggable by their handles.
 *
 * `onLift` runs once when a drag begins, before anything moves, so the caller
 * can change what is rendered (this page expands to the whole gallery, so a
 * photo is not trapped on the page it started on). The list is re-read after
 * it, and the pointer is captured on the list itself rather than the row, so
 * a re-render mid-drag does not drop the gesture.
 */
export function enableDragReorder({ list, rowSelector, handleSelector, onLift, onDrop, onEnd }) {
  let pointerId = null;
  let pending = null;
  let row = null;
  let startX = 0;
  let startY = 0;
  let edgeTimer = null;
  let lastX = 0;
  let lastY = 0;

  const indicator = document.createElement("li");
  indicator.className = "drop-indicator";
  indicator.setAttribute("aria-hidden", "true");

  function rows() {
    return [...list.querySelectorAll(rowSelector)].filter((item) => item !== row);
  }

  function stopEdgeScroll() {
    if (edgeTimer === null) return;
    clearInterval(edgeTimer);
    edgeTimer = null;
  }

  // A phone screen holds a handful of rows, so a drag of any distance needs
  // the page to come to the finger.
  function updateEdgeScroll(clientY) {
    // visualViewport is what is actually on screen: on iOS the browser
    // toolbars overlay the layout viewport, so measuring against innerHeight
    // puts the bottom trigger zone underneath the toolbar, out of reach.
    const view = window.visualViewport;
    const viewTop = view ? view.offsetTop : 0;
    const viewHeight = view ? view.height : window.innerHeight;
    const top = clientY < viewTop + EDGE_ZONE_PX;
    const bottom = clientY > viewTop + viewHeight - EDGE_ZONE_PX;
    if (!top && !bottom) {
      stopEdgeScroll();
      return;
    }
    if (edgeTimer !== null) return;
    edgeTimer = setInterval(() => {
      const before = window.scrollY;
      // Explicitly instant: the site sets `scroll-behavior: smooth`, which
      // makes a plain scrollBy animate, so scrollY has not moved yet when the
      // check below runs and the scroll stops after a single step.
      window.scrollBy({ top: top ? -EDGE_STEP_PX : EDGE_STEP_PX, behavior: "instant" });
      // At either end of the page there is nothing left to scroll; stop rather
      // than spinning a timer for the rest of the drag.
      if (window.scrollY === before) {
        stopEdgeScroll();
        return;
      }
      // The tile is positioned from where the drag started, and that origin
      // has just moved with the page.
      startY -= window.scrollY - before;
      place(lastX, lastY);
    }, 16);
  }

  function place(clientX, clientY) {
    row.style.transform =
      `translate(${clientX - startX}px, ${clientY - startY}px)`;

    // Measured with the indicator out of the way: it takes a cell of its own,
    // so leaving it in shifts the very tiles being measured and the target
    // slides away as you approach it — dragging to the end landed one short.
    indicator.remove();
    const others = rows();
    const index = insertionIndexFor(
      others.map((item) => item.getBoundingClientRect()),
      clientX,
      clientY,
    );
    const before = others[index] ?? null;
    if (before) list.insertBefore(indicator, before);
    else list.append(indicator);
  }

  function finish(commit) {
    stopEdgeScroll();
    const from = [...list.querySelectorAll(rowSelector)].indexOf(row);
    const to = [...list.children]
      .filter((item) => item === indicator || item.matches(rowSelector))
      .indexOf(indicator);

    indicator.remove();
    row.style.transform = "";
    row.classList.remove("is-dragging");
    list.classList.remove("is-reordering");
    document.body.classList.remove("is-dragging-row");

    const dragged = row;
    row = null;
    // Removing the row before reinserting shifts every later slot up by one.
    const target = to > from ? to - 1 : to;
    if (commit && from >= 0 && to >= 0 && target !== from) {
      onDrop(from, target, dragged.dataset.id);
    }
    // Always: a gesture that moved nothing still changed the layout, and the
    // caller has captions to re-measure and a bar to update.
    onEnd?.();
  }

  /** Turns a press that has travelled far enough into an actual drag. */
  function lift(event) {
    onLift?.();
    // Re-read after onLift: the list may have been re-rendered.
    row = list.querySelector(`${rowSelector}[data-id="${CSS.escape(pending.id)}"]`);
    if (!row) return false;

    // The tile follows the finger from where it is now, not from where the
    // press started, so it does not jump on the first movement.
    startX = event.clientX;
    startY = event.clientY;
    lastX = event.clientX;
    lastY = event.clientY;
    row.classList.add("is-dragging");
    list.classList.add("is-reordering");
    document.body.classList.add("is-dragging-row");
    place(event.clientX, event.clientY);
    return true;
  }

  function release() {
    if (pointerId !== null) {
      try {
        list.releasePointerCapture(pointerId);
      } catch {
        // Never captured, or the pointer is already gone.
      }
    }
    pointerId = null;
    pending = null;
  }

  list.addEventListener("pointerdown", (event) => {
    if (pointerId !== null || !event.isPrimary) return;
    const handle = event.target.closest(handleSelector);
    if (!handle || !list.contains(handle)) return;

    const id = handle.closest(rowSelector)?.dataset.id;
    if (!id) return;

    // Stops the page scrolling with the finger, and text being selected.
    event.preventDefault();
    pointerId = event.pointerId;
    pending = { id, x: event.clientX, y: event.clientY };
    try {
      list.setPointerCapture(pointerId);
    } catch {
      // The pointer is already gone, or is synthetic. The move and up handlers
      // below still fire on the list, so the drag works without capture.
    }
  });

  list.addEventListener("pointermove", (event) => {
    if (pointerId === null || event.pointerId !== pointerId) return;

    if (!row) {
      if (!pending) return;
      const travelled = Math.hypot(event.clientX - pending.x, event.clientY - pending.y);
      if (travelled < DRAG_THRESHOLD_PX) return;
      if (!lift(event)) {
        release();
        return;
      }
    }

    event.preventDefault();
    lastX = event.clientX;
    lastY = event.clientY;
    place(event.clientX, event.clientY);
    updateEdgeScroll(event.clientY);
  });

  list.addEventListener("pointerup", (event) => {
    if (pointerId === null || event.pointerId !== pointerId) return;
    // A press that never travelled is a tap: nothing was picked up, so
    // nothing moves and nothing changes.
    if (!row) {
      release();
      return;
    }
    finish(true);
    release();
  });

  list.addEventListener("pointercancel", (event) => {
    if (pointerId === null || event.pointerId !== pointerId) return;
    if (row) finish(false);
    release();
  });
}
