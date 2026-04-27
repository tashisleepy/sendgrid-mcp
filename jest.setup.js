import * as dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// SAFETY GATE: these are integration tests that hit the live SendGrid API
// and mutate the account (create lists, add contacts, delete them). To prevent
// accidental damage to a production account, require an explicit opt-in flag.
if (!process.env.RUN_INTEGRATION) {
  throw new Error(
    'Integration tests are disabled by default to prevent accidental mutation of production data. ' +
    'Set RUN_INTEGRATION=1 along with SENDGRID_API_KEY (ideally a dedicated sandbox account) to run them.'
  );
}

// Ensure SENDGRID_API_KEY is set
if (!process.env.SENDGRID_API_KEY) {
  throw new Error('SENDGRID_API_KEY environment variable is required for tests. See README.md for setup instructions.');
}
