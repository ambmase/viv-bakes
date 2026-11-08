CREATE TABLE photos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  r2_key      TEXT    NOT NULL UNIQUE,
  alt         TEXT    NOT NULL,
  width       INTEGER NOT NULL,
  height      INTEGER NOT NULL,
  sort_order  INTEGER NOT NULL,
  featured    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_photos_sort ON photos(sort_order);
