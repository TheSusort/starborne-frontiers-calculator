-- Saved Autogear ship selections (name + ordered ship ids).
-- Row-per-team rather than one JSONB blob per user: saves and deletes are then
-- independent writes, and the unique index enforces no-duplicate-names in the
-- database rather than only in the form.
CREATE TABLE autogear_teams (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT        NOT NULL,
    ship_ids   JSONB       NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE autogear_teams ENABLE ROW LEVEL SECURITY;

CREATE INDEX autogear_teams_user_id_idx ON autogear_teams (user_id);
CREATE UNIQUE INDEX autogear_teams_user_name_idx ON autogear_teams (user_id, name);

CREATE POLICY "Users can manage their own autogear teams"
    ON autogear_teams
    USING      (public.has_profile_access(user_id))
    WITH CHECK (public.has_profile_access(user_id));
