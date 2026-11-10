-- Sodium. Private, not scored, opt-in per player (same shape as sugar).
ALTER TABLE food_entries ADD COLUMN sodium_mg INTEGER;   -- null = not estimated (logged before this existed)
ALTER TABLE players ADD COLUMN sodium_target INTEGER;    -- max mg of sodium a day; null = not tracking
