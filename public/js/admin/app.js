// Admin page wiring. Cloudflare Access has already authenticated the visitor
// by the time this script runs, so there is no login, logout, or session
// logic here — a 401 from any request means the Access session expired.
//
// The parts where a mistake is silent — the id set sent to the reorder
// endpoint, the page arithmetic, the resize dimensions — live in ./list.js
// and ./resize.js and are tested directly. This file is the DOM and the
// network around them.

import {
  deletePhoto,
  getMe,
  listPhotos,
  patchPhoto,
  reorderFeatured,
  reorderPhotos,
  uploadPhoto,
} from "./api.js";
import {
  describeHomeGrid,
  mergeUploadedIds,
  moveInList,
  pageCount,
  pageSlice,
  pendingChanges,
} from "./list.js";
import { enableDragReorder } from "./drag.js";
import { UnsupportedImageError, resizeToWebp } from "./resize.js";
import { EncoderUnavailableError } from "./webp.js";

const PER_PAGE = 20;

const emailEl = document.getElementById("signed-in-email");
const errorEl = document.getElementById("admin-error");
const statusEl = document.getElementById("admin-status");
const photoList = document.getElementById("photo-list");
const fileInput = document.getElementById("admin-file-input");
const draftsPanel = document.getElementById("upload-drafts-panel");
const draftList = document.getElementById("upload-drafts");
const submitButton = document.getElementById("upload-submit");
const pager = document.getElementById("photo-pager");
const pagerPrev = document.getElementById("pager-prev");
const pagerNext = document.getElementById("pager-next");
const pagerStatus = document.getElementById("pager-status");
const reorderBar = document.getElementById("reorder-bar");
const reorderSave = document.getElementById("reorder-save");
const reorderUndo = document.getElementById("reorder-undo");
const reorderBarText = document.querySelector(".reorder-bar-text");
const arrangeButton = document.getElementById("arrange-photos");
const viewAllButton = document.getElementById("view-all");
const viewHomeButton = document.getElementById("view-home");
const homePageNote = document.getElementById("home-page-note");

/** Every photo, in gallery order. The admin list is that order, not a view of it. */
let photos = [];
/** The gallery as the server last described it — what changes are measured against. */
let baseline = [];
/** Marked for removal, still on screen until the changes are saved. */
let deletedIds = new Set();
let page = 1;

/** Picked files waiting for a description. */
let drafts = [];
let draftSeq = 0;
let resizing = false;
let uploading = false;

/* Nothing on this page writes as you touch it. Descriptions, home-page stars,
   removals and the order are all changed locally and committed together, so a
   handful of edits is one deliberate save rather than a scatter of silent
   writes. Adding photos is the exception: it is its own explicit action. */
let reordering = false;
let saving = false;

/** "all" is the portfolio; "home" is the home page, in its own order. */
let view = "all";

const onHomePage = (photo) => photo.featured > 0;

/** The photos the current view shows, in the order that view arranges. */
function visiblePhotos() {
  if (view === "all") return photos;
  return photos
    .filter(onHomePage)
    .sort((left, right) => left.featured - right.featured);
}

/* ---------------------------------------------------------------- messages */

function showError(message) {
  errorEl.textContent = message;
  statusEl.textContent = "";
}

let statusTimer = null;

function showStatus(message) {
  statusEl.textContent = message;
  errorEl.textContent = "";
  // Confirmations are news, not state: they go once they have been read.
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    statusEl.textContent = "";
  }, 5000);
}

function clearMessages() {
  clearTimeout(statusTimer);
  errorEl.textContent = "";
  statusEl.textContent = "";
}

function reportFailure(error, fallback) {
  if (error instanceof Error && error.message === "unauthorized") {
    showError("Your session has expired. Reload the page to sign in again.");
    return;
  }
  showError(error instanceof Error && error.message ? error.message : fallback);
}

/** Grows a description box to fit what is in it, so nothing is cut off. */
function autosize(field) {
  // A hidden field measures zero, and writing that height back leaves it
  // collapsed when it becomes visible again — which is what happened to every
  // caption after a rearrangement.
  if (!field.getClientRects().length) return;
  field.style.height = "auto";
  // scrollHeight covers content and padding but not the border, and these
  // boxes are border-box — without adding it back the last line is clipped.
  const border = field.offsetHeight - field.clientHeight;
  field.style.height = `${field.scrollHeight + border}px`;
}

function autosizeAll() {
  requestAnimationFrame(() => {
    for (const field of document.querySelectorAll(".photo-item-alt, .upload-draft-alt")) {
      autosize(field);
    }
  });
}

function mediaUrl(photo) {
  return `/media/${photo.r2_key.slice("photos/".length)}`;
}

function formatSize(bytes) {
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/* ------------------------------------------------------------ photo tiles */

function overlayButton(className, glyph, label) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `photo-item-overlay ${className}`;
  button.textContent = glyph;
  button.setAttribute("aria-label", label);
  return button;
}

// A tile, not a row: this page is a portfolio, so the photograph is the thing
// worth the space. The controls sit on the image, and the description reads as
// a caption until it is focused.
function photoItemElement(photo) {
  const item = document.createElement("li");
  item.className = "photo-item";
  item.dataset.id = String(photo.id);

  const frame = document.createElement("div");
  frame.className = "photo-item-frame";

  const image = document.createElement("img");
  image.src = mediaUrl(photo);
  image.alt = photo.alt;
  image.width = photo.width;
  image.height = photo.height;
  image.loading = "lazy";
  image.decoding = "async";
  image.draggable = false;

  // Pointer drag needs the gesture, so the browser must not claim it first.
  const handle = document.createElement("div");
  handle.className = "photo-item-handle";
  handle.setAttribute("aria-hidden", "true");
  handle.textContent = "⠿";

  const star = overlayButton("photo-item-star", onHomePage(photo) ? "★" : "☆", "");
  const setStar = (featured) => {
    star.textContent = featured ? "★" : "☆";
    star.setAttribute("aria-pressed", String(featured));
    star.setAttribute(
      "aria-label",
      featured ? `On the home page: ${photo.alt}` : `Show on the home page: ${photo.alt}`,
    );
    star.classList.toggle("is-on", featured);
  };
  setStar(onHomePage(photo));
  star.addEventListener("click", () => {
    if (onHomePage(photo)) {
      photo.featured = 0;
    } else {
      // Appended to the end, exactly as the server does it, so the two agree
      // before anything is saved.
      photo.featured =
        Math.max(0, ...photos.map((candidate) => candidate.featured)) + 1;
    }
    setStar(onHomePage(photo));
    clearMessages();
    renderPage();
    updatePendingBar();
  });

  const markedForRemoval = deletedIds.has(photo.id);
  const remove = overlayButton(
    "photo-item-delete",
    markedForRemoval ? "↺" : "✕",
    markedForRemoval ? `Keep: ${photo.alt}` : `Remove: ${photo.alt}`,
  );
  remove.addEventListener("click", () => {
    // Marked, not gone: nothing is deleted until the changes are saved, and
    // the tile stays on screen so it can be put back.
    if (deletedIds.has(photo.id)) deletedIds.delete(photo.id);
    else deletedIds.add(photo.id);
    clearMessages();
    renderPage();
    updatePendingBar();
  });

  frame.append(image, handle, star, remove);
  if (markedForRemoval) {
    item.classList.add("is-deleted");
    const flag = document.createElement("p");
    flag.className = "photo-item-deleted-flag";
    flag.textContent = "Removed on save";
    frame.append(flag);
  }

  const altInput = document.createElement("textarea");
  altInput.className = "photo-item-alt";
  altInput.rows = 1;
  altInput.value = photo.alt;
  altInput.setAttribute("aria-label", "Photo description");
  altInput.addEventListener("input", () => autosize(altInput));
  altInput.addEventListener("change", () => {
    const value = altInput.value.trim();
    if (value.length === 0) {
      // Every photo needs one: it is the alt text the website reads out.
      showError("Every photo needs a description.");
      altInput.value = photo.alt;
      autosize(altInput);
      return;
    }
    clearMessages();
    photo.alt = value;
    image.alt = value;
    updatePendingBar();
  });

  item.append(frame, altInput);
  return item;
}

/* --------------------------------------------------------------- rendering */

function renderPage() {
  const list = visiblePhotos();
  const homeCount = photos.filter(onHomePage).length;
  const lastPage = pageCount(list.length, PER_PAGE);
  page = Math.min(Math.max(page, 1), lastPage);

  viewAllButton.classList.toggle("is-current", view === "all");
  viewHomeButton.classList.toggle("is-current", view === "home");
  viewAllButton.setAttribute("aria-pressed", String(view === "all"));
  viewHomeButton.setAttribute("aria-pressed", String(view === "home"));
  viewHomeButton.textContent =
    homeCount > 0 ? `Home page (${homeCount})` : "Home page";

  // What an awkward number of photos will actually look like, rather than a
  // rule about six that nobody asked for.
  const note = view === "home" ? describeHomeGrid(list.length) : "";
  homePageNote.textContent = note;
  homePageNote.hidden = note === "";

  if (list.length === 0) {
    const empty = document.createElement("li");
    empty.className = "photo-list-empty";
    empty.textContent =
      view === "home"
        ? "Nothing on the home page yet. Star a photo in All photos to put it here."
        : "No photos yet. Add your first one above.";
    photoList.classList.remove("is-arranging");
    photoList.replaceChildren(empty);
    pager.hidden = true;
    arrangeButton.hidden = true;
    return;
  }

  // While arranging, everything is on screen — a photo that could only be
  // dragged within its own page could never leave it.
  photoList.classList.toggle("is-arranging", reordering);
  const onScreen = reordering ? list : pageSlice(list, page, PER_PAGE);
  photoList.replaceChildren(...onScreen.map(photoItemElement));
  autosizeAll();

  pager.hidden = reordering || lastPage === 1;
  arrangeButton.hidden = reordering || list.length < 2;
  pagerPrev.disabled = page === 1;
  pagerNext.disabled = page === lastPage;
  pagerStatus.textContent = `Page ${page} of ${lastPage}`;
}

async function loadPhotos({ keepEdits = false } = {}) {
  let fresh;
  try {
    fresh = await listPhotos();
  } catch (error) {
    reportFailure(error, "Could not load photos. Try reloading the page.");
    return false;
  }
  // The baseline is what the server says; the working copy is what is on
  // screen. After a failed save they differ, and the edits are worth keeping.
  baseline = fresh.map((photo) => ({ ...photo }));
  if (!keepEdits) photos = fresh.map((photo) => ({ ...photo }));
  renderPage();
  updatePendingBar();
  return true;
}

/* ------------------------------------------------------- pending changes */

function changes() {
  return pendingChanges(baseline, photos, deletedIds);
}

function describeChanges({ alt, featured, deleted, orderChanged, featuredOrderChanged }) {
  const parts = [];
  if (orderChanged) parts.push("new order");
  if (featuredOrderChanged) parts.push("new home-page order");
  if (alt.length > 0) {
    parts.push(alt.length === 1 ? "1 description" : `${alt.length} descriptions`);
  }
  if (featured.length > 0) {
    parts.push(
      featured.length === 1 ? "1 home-page change" : `${featured.length} home-page changes`,
    );
  }
  if (deleted.length > 0) {
    parts.push(deleted.length === 1 ? "1 photo removed" : `${deleted.length} photos removed`);
  }
  return `Unsaved: ${parts.join(", ")}.`;
}

function updatePendingBar() {
  const pending = changes();
  const anything = pending.count > 0;
  reorderBar.hidden = !anything && !reordering;
  reorderBarText.textContent = anything
    ? describeChanges(pending)
    : "Drag a photo to move it.";
  reorderSave.disabled = saving || !anything;
  reorderUndo.disabled = saving;
  arrangeButton.hidden = reordering || photos.length < 2;
}

function beginReorder() {
  if (reordering) return;
  reordering = true;
  renderPage();
  updatePendingBar();
}

function onDrop(from, to) {
  if (view === "all") {
    photos = moveInList(photos, from, to);
  } else {
    // The home page carries its own positions, so renumber the moved list
    // 1..n and write those numbers back onto the photos themselves.
    moveInList(visiblePhotos(), from, to).forEach((photo, index) => {
      photo.featured = index + 1;
    });
  }
  renderPage();
  updatePendingBar();
}

/** Re-measures captions after a drag, whether or not anything moved. */
function endDrag() {
  autosizeAll();
  updatePendingBar();
}

/**
 * Writes everything that is waiting, in the only order that works: removals
 * first, so the id set the reorder is checked against is the one that will
 * exist; then the field edits; then the order.
 */
async function saveChanges() {
  if (saving) return;
  const pending = changes();
  if (pending.count === 0) return;

  saving = true;
  updatePendingBar();
  clearMessages();

  try {
    for (const id of pending.deleted) {
      await deletePhoto(id);
    }
    for (const id of new Set([...pending.alt, ...pending.featured])) {
      const photo = photos.find((candidate) => candidate.id === id);
      await patchPhoto(id, { alt: photo.alt, featured: onHomePage(photo) });
    }
    const kept = photos.filter((photo) => !deletedIds.has(photo.id));
    if (pending.orderChanged || pending.deleted.length > 0) {
      await reorderPhotos(kept.map((photo) => photo.id));
    }
    // After the patches above, the server's home page holds exactly the photos
    // starred here, so its id set matches what this sends.
    if (pending.featuredOrderChanged || pending.featured.length > 0) {
      const home = kept
        .filter(onHomePage)
        .sort((left, right) => left.featured - right.featured)
        .map((photo) => photo.id);
      if (home.length > 0) await reorderFeatured(home);
    }

    deletedIds = new Set();
    reordering = false;
    saving = false;
    await loadPhotos();
    showStatus("Changes saved.");
  } catch (error) {
    // Whatever did not get through stays on screen to be tried again rather
    // than being thrown away with the failure.
    reportFailure(error, "Could not save your changes. They are still here.");
    saving = false;
    await loadPhotos({ keepEdits: true });
  }
  updatePendingBar();
}

function cancelChanges() {
  if (saving) return;
  const had = changes().count > 0;
  photos = baseline.map((photo) => ({ ...photo }));
  deletedIds = new Set();
  reordering = false;
  renderPage();
  updatePendingBar();
  if (had) showStatus("Changes discarded.");
}

/* ------------------------------------------------------------------ upload */

/** Marks one file as unusable, whatever went wrong, and never throws itself. */
function failDraft(draft, error) {
  try {
    // Both of these carry a message written for the person reading it. Anything
    // else is a bug, and "try a JPEG or PNG" is the best guess available.
    const explained =
      error instanceof UnsupportedImageError ||
      error instanceof EncoderUnavailableError;
    const message = explained
      ? `${draft.file.name}: ${error.message}`
      : `${draft.file.name} could not be prepared. Try a JPEG or PNG.`;
    setDraftNote(draft, message, true);
    draft.textarea.disabled = true;
  } catch {
    // The card is already beyond saving; keeping the queue moving matters more.
  }
}

function setDraftNote(draft, message, isError = false) {
  draft.note.textContent = message;
  draft.note.classList.toggle("is-error", isError);
}

function removeDraft(draft) {
  if (draft.thumbUrl) URL.revokeObjectURL(draft.thumbUrl);
  draft.element.remove();
  drafts = drafts.filter((candidate) => candidate !== draft);
  if (drafts.length === 0) draftsPanel.hidden = true;
  updateSubmitState();
}

function addDraft(file) {
  const draft = { key: ++draftSeq, file, alt: "", state: "waiting" };

  const item = document.createElement("li");
  item.className = "upload-draft";

  const thumb = document.createElement("div");
  thumb.className = "upload-draft-thumb";

  const field = document.createElement("div");
  field.className = "upload-draft-field";

  const textarea = document.createElement("textarea");
  textarea.className = "upload-draft-alt";
  textarea.rows = 2;
  textarea.addEventListener("input", () => autosize(textarea));
  textarea.placeholder = "A two-tier lemon cake with buttercream daisies…";
  textarea.setAttribute("aria-label", `Description for ${file.name}`);
  textarea.addEventListener("input", () => {
    draft.alt = textarea.value;
    updateSubmitState();
  });

  const note = document.createElement("p");
  note.className = "upload-draft-note";
  note.textContent = "Getting it ready…";

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "upload-draft-remove";
  remove.textContent = "×";
  remove.setAttribute("aria-label", `Don't add ${file.name}`);
  remove.addEventListener("click", () => removeDraft(draft));

  field.append(textarea, note);
  item.append(thumb, field, remove);
  draftList.append(item);

  Object.assign(draft, { element: item, thumb, note, textarea });
  drafts.push(draft);
}

async function processDrafts() {
  if (resizing) return;
  resizing = true;
  try {
    // Sequential on purpose: resizing is CPU-heavy and a phone handles one at
    // a time far better than several at once.
    for (;;) {
      const draft = drafts.find((candidate) => candidate.state === "waiting");
      if (!draft) break;
      draft.state = "sizing";
      try {
        const { blob, width, height } = await resizeToWebp(draft.file);
        Object.assign(draft, { blob, width, height, state: "ready" });
        draft.thumbUrl = URL.createObjectURL(blob);
        const image = document.createElement("img");
        image.src = draft.thumbUrl;
        image.alt = "";
        draft.thumb.replaceChildren(image);
        setDraftNote(draft, `Ready · ${formatSize(blob.size)}`);
      } catch (error) {
        // Anything at all that goes wrong with this file ends as a message on
        // its card. A failure with no state change would leave the card on
        // "Getting it ready…" for ever and stall every file behind it.
        draft.state = "failed";
        failDraft(draft, error);
      } finally {
        updateSubmitState();
      }
    }
  } finally {
    resizing = false;
  }
}

function updateSubmitState() {
  const ready = drafts.filter((draft) => draft.state === "ready");
  const pending = drafts.some(
    (draft) => draft.state === "waiting" || draft.state === "sizing",
  );
  const described = ready.every((draft) => draft.alt.trim().length > 0);

  submitButton.disabled = uploading || pending || ready.length === 0 || !described;
  submitButton.textContent = uploading
    ? "Adding…"
    : ready.length === 1
      ? "Add photo"
      : ready.length > 1
        ? `Add ${ready.length} photos`
        : "Add photos";
}

async function uploadDrafts() {
  const queue = drafts.filter((draft) => draft.state === "ready");
  if (queue.length === 0) return;

  uploading = true;
  updateSubmitState();
  clearMessages();

  // Captured before the batch: an id that was already here came back from a
  // re-upload of a photo the gallery has, and must not be treated as new.
  const existingIds = photos.map((photo) => photo.id);
  const uploadedIds = [];
  let added = 0;
  let already = 0;
  let failed = 0;

  for (const draft of queue) {
    draft.state = "uploading";
    setDraftNote(draft, "Adding…");
    try {
      const photo = await uploadPhoto({
        blob: draft.blob,
        alt: draft.alt.trim(),
        width: draft.width,
        height: draft.height,
      });
      uploadedIds.push(photo.id);
      draft.state = "done";
      if (existingIds.includes(photo.id)) {
        already += 1;
        setDraftNote(draft, "Already in the gallery.");
      } else {
        added += 1;
        setDraftNote(draft, "Added.");
      }
    } catch (error) {
      // One bad file does not stop the batch.
      failed += 1;
      draft.state = "error";
      setDraftNote(
        draft,
        error instanceof Error && error.message === "unauthorized"
          ? "Your session has expired. Reload the page to sign in again."
          : `${draft.file.name}: ${error instanceof Error ? error.message : "could not be added"}`,
        true,
      );
    }
  }

  const order = mergeUploadedIds(existingIds, uploadedIds);
  let orderSaved = true;
  // `existingIds` is the order on screen, so an unsaved rearrangement is part
  // of what gets written here — adding photos also saves the order.
  if (order.length !== existingIds.length || reordering) {
    try {
      await reorderPhotos(order);
    } catch {
      orderSaved = false;
    }
  }

  for (const draft of [...drafts]) {
    if (draft.state === "done") removeDraft(draft);
  }

  if (orderSaved) reordering = false;

  page = 1;
  uploading = false;
  await loadPhotos();
  updateSubmitState();
  announceUpload({ added, already, failed, orderSaved });
}

function announceUpload({ added, already, failed, orderSaved }) {
  const parts = [];
  if (added > 0) {
    parts.push(
      added === 1
        ? "1 photo added to the top of the gallery."
        : `${added} photos added to the top of the gallery.`,
    );
  }
  if (already > 0) {
    parts.push(
      already === 1
        ? "1 was already in the gallery."
        : `${already} were already in the gallery.`,
    );
  }

  if (!orderSaved) {
    showError(
      `${parts.join(" ")} They are saved, but at the bottom of the gallery — the new order did not save.`.trim(),
    );
    return;
  }
  if (failed > 0) {
    parts.push(
      failed === 1
        ? "1 could not be added — see the message on it."
        : `${failed} could not be added — see the messages on them.`,
    );
    showError(parts.join(" "));
    return;
  }
  if (parts.length > 0) showStatus(parts.join(" "));
}

/* -------------------------------------------------------------------- init */

fileInput.addEventListener("change", () => {
  const picked = [...fileInput.files];
  // Cleared so picking the same file again still fires a change event.
  fileInput.value = "";
  if (picked.length === 0) return;

  // Adding photos reloads the gallery from the server, which would take
  // unsaved edits with it.
  if (changes().count > 0) {
    showError("Save or discard your changes first, then add photos.");
    return;
  }

  clearMessages();
  for (const file of picked) addDraft(file);
  draftsPanel.hidden = false;
  updateSubmitState();
  processDrafts();
});

submitButton.addEventListener("click", uploadDrafts);

// Text that wrapped to three lines on a phone may take one on a rotated
// screen or a resized window; the boxes have to be measured again.
window.addEventListener("resize", autosizeAll);

enableDragReorder({
  list: photoList,
  rowSelector: ".photo-item",
  handleSelector: ".photo-item-handle",
  onLift: beginReorder,
  onDrop,
  onEnd: endDrag,
});

function switchView(next) {
  if (view === next) return;
  view = next;
  page = 1;
  reordering = false;
  renderPage();
  updatePendingBar();
}

viewAllButton.addEventListener("click", () => switchView("all"));
viewHomeButton.addEventListener("click", () => switchView("home"));

arrangeButton.addEventListener("click", () => {
  beginReorder();
  photoList.scrollIntoView({ block: "start", behavior: "smooth" });
});

reorderSave.addEventListener("click", saveChanges);
reorderUndo.addEventListener("click", cancelChanges);

// Unsaved edits live only in this tab.
window.addEventListener("beforeunload", (event) => {
  if (changes().count === 0) return;
  event.preventDefault();
  event.returnValue = "";
});

pagerPrev.addEventListener("click", () => {
  page -= 1;
  renderPage();
  photoList.scrollIntoView({ block: "start" });
});

pagerNext.addEventListener("click", () => {
  page += 1;
  renderPage();
  photoList.scrollIntoView({ block: "start" });
});

async function init() {
  try {
    const me = await getMe();
    emailEl.textContent = me.email;
  } catch (error) {
    reportFailure(error, "Could not load your account. Try reloading the page.");
    return;
  }
  await loadPhotos();
}

init();
