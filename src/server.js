'use strict';
const { createApp } = require('./app');
const config = require('./config');
const { seed } = require('./db/seed');

seed();

const app = createApp();
app.listen(config.port, () => {
  console.log('Bazaar démarré sur ' + config.baseUrl);
});
