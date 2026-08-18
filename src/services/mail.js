'use strict';
const config = require('../config');

// Transport e-mail configuré uniquement si SMTP est renseigné. nodemailer est
// chargé à la volée pour ne pas dépendre d'un SMTP absent en dev.
let transporter = null;
if (config.smtp.host && config.smtp.user && config.smtp.pass) {
  const nodemailer = require('nodemailer');
  transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: { user: config.smtp.user, pass: config.smtp.pass },
  });
}

function isConfigured() {
  return !!transporter;
}

// Envoie un e-mail texte simple. Lève une erreur si SMTP n'est pas configuré
// ou si l'envoi échoue — l'appelant décide de la suite (ex. journaliser le
// lien en dev).
async function sendMail({ to, subject, text }) {
  if (!transporter) {
    throw new Error('SMTP non configuré');
  }
  await transporter.sendMail({
    from: config.smtp.from || config.smtp.user,
    to,
    subject,
    text,
  });
}

module.exports = { sendMail, isConfigured };
