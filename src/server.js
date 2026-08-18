'use strict';
const { createApp } = require('./app');
const config = require('./config');
const { seed } = require('./db/seed');
const { startCleanup } = require('./services/sessionStore');

seed();

const app = createApp();
const server = app.listen(config.port, () => {
  console.log('Bazaar démarré sur ' + config.baseUrl);
});

startCleanup();

// Arrêt propre (utile en production / lors des tests).
process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
