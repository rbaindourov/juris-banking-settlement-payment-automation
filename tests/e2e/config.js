/**
 * Juris Banking - E2E Testing Configuration
 */

module.exports = {
  apiUrl: process.env.TEST_API_URL || 'http://localhost:5000',
  mongoUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/juris_banking_test',
  sftp: {
    host: process.env.SFTP_HOST || 'localhost',
    port: parseInt(process.env.SFTP_PORT || '2222', 10),
    username: process.env.SFTP_USER || 'juris_test_user',
    password: process.env.SFTP_PASSWORD || 'juris_test_password',
  },
  timeouts: {
    short: 5000,
    medium: 15000,
    long: 30000,
    realWorld: 60000,
  },
};
