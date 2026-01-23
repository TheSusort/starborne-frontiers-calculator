-- Function to get live traffic stats (users active in last 60 seconds)
CREATE OR REPLACE FUNCTION get_live_traffic()
RETURNS TABLE (
  active_sessions bigint,
  authenticated_users bigint,
  anonymous_sessions bigint,
  top_pages jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH recent AS (
    SELECT DISTINCT ON (session_id)
      session_id,
      user_id,
      page_path
    FROM heartbeats
    WHERE created_at > now() - interval '60 seconds'
    ORDER BY session_id, created_at DESC
  )
  SELECT
    COUNT(DISTINCT r.session_id)::bigint AS active_sessions,
    COUNT(DISTINCT r.user_id) FILTER (WHERE r.user_id IS NOT NULL)::bigint AS authenticated_users,
    COUNT(*) FILTER (WHERE r.user_id IS NULL)::bigint AS anonymous_sessions,
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object('path', t.page_path, 'count', t.cnt))
       FROM (
         SELECT page_path, COUNT(*) as cnt
         FROM recent
         GROUP BY page_path
         ORDER BY cnt DESC
         LIMIT 5
       ) t),
      '[]'::jsonb
    ) AS top_pages
  FROM recent r;
END;
$$;

-- Grant execute to authenticated users (admin check happens in RLS)
GRANT EXECUTE ON FUNCTION get_live_traffic() TO authenticated;
