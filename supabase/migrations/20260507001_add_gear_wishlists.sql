CREATE TABLE gear_wishlists (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    entries    JSONB       NOT NULL DEFAULT '[]',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE gear_wishlists ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX gear_wishlists_user_id_idx ON gear_wishlists (user_id);

CREATE POLICY "Users can manage their own wishlist"
    ON gear_wishlists
    USING  (public.has_profile_access(user_id))
    WITH CHECK (public.has_profile_access(user_id));
