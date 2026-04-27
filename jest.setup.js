import * as dotenv from 'dotenv';

// Load environment variables from .env file (used by integration tests).
dotenv.config();

// NOTE: integration tests are gated INSIDE the integration test file via
// `describeIntegration` so unit tests can run without RUN_INTEGRATION=1.
