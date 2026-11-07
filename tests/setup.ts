// Tests must not depend on a developer's .env, and must never touch a real
// project. These satisfy the env schema without reaching Supabase.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.ENABLE_JOBS = 'false';
process.env.SUPABASE_URL ??= 'https://test-project.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test_service_role_key_placeholder';
process.env.TOTP_ENCRYPTION_KEY ??= 'test_totp_encryption_key_at_least_32_chars';
