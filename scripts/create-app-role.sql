-- The grant-app script creates/updates the login with the application URL password.
GRANT USAGE ON SCHEMA public TO cekis_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO cekis_app;
ALTER DEFAULT PRIVILEGES FOR ROLE cekis_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cekis_app;
