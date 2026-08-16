'use strict';
const { db } = require('../db/connection');

function subscribe(email) {
  db.prepare('INSERT OR IGNORE INTO newsletter (email) VALUES (?)').run(email);
}

module.exports = { subscribe };
