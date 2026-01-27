-- Function to get live traffic stats (users active in last 60 seconds)
CREATE OR REPLACE FUNCTION get_live_traffic()
RETURNS TABLE (
  active_sessions bigint,
  authenticated_users bigint,
  anonymous_sessions bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::bigint AS active_sessions,
    COUNT(user_id)::bigint AS authenticated_users,
    COUNT(*) FILTER (WHERE user_id IS NULL)::bigint AS anonymous_sessions
  FROM heartbeats
  WHERE last_seen > now() - interval '60 seconds';
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION get_live_traffic() TO authenticated;
