CREATE TABLE IF NOT EXISTS batches (
  id TEXT PRIMARY KEY NOT NULL,
  digest TEXT NOT NULL,
  votes TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS ranking (
  topic TEXT NOT NULL,
  member TEXT NOT NULL,
  wins INTEGER NOT NULL DEFAULT 0,
  appearances INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (topic, member)
) WITHOUT ROWID;
CREATE TRIGGER IF NOT EXISTS tally_batch AFTER INSERT ON batches
BEGIN
  INSERT INTO ranking (topic,member,wins,appearances)
  SELECT topic,member,SUM(win),COUNT(*) FROM (
    SELECT json_extract(value,'$[0]') AS topic,json_extract(value,'$[1]') AS member,1 AS win FROM json_each(NEW.votes)
    UNION ALL
    SELECT json_extract(value,'$[0]'),json_extract(value,'$[2]'),0 FROM json_each(NEW.votes)
  ) GROUP BY topic,member
  ON CONFLICT(topic,member) DO UPDATE SET wins=wins+excluded.wins, appearances=appearances+excluded.appearances;
  -- Keep a compact receipt for safe retries, not individual users' histories.
  UPDATE batches SET votes='[]' WHERE id=NEW.id;
END;
