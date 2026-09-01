'use strict';
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { db, migrate } = require('./connection');
const config = require('../config');

function initSchema() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
  migrate();
}

// Idempotent : ne crée les données que si les tables sont vides.
function seed() {
  initSchema();

  if (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n === 0) {
    // Refuse de créer un compte admin avec un mot de passe par défaut en
    // production : aucun identifiant exploitable tel quel ne doit exister.
    const isProd = process.env.NODE_ENV === 'production';
    const weakDefault = !process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD === 'admin123';
    if (isProd && weakDefault) {
      throw new Error(
        'Refus de créer un compte admin avec un mot de passe par défaut en production. ' +
        'Définissez ADMIN_PASSWORD (mot de passe fort) dans .env puis relancez.'
      );
    }
    const hash = bcrypt.hashSync(config.adminPassword, 10);
    db.prepare('INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?)')
      .run(config.adminEmail, hash, 'Administrateur', 'admin');
    console.log('Compte admin créé :', config.adminEmail);
  }

  if (db.prepare('SELECT COUNT(*) AS n FROM wilayas').get().n === 0) {
    const locations = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'locations.json'), 'utf8'));
    const insWilaya = db.prepare('INSERT INTO wilayas (code, name_fr, name_ar) VALUES (?, ?, ?)');
    const insCommune = db.prepare('INSERT INTO communes (id, wilaya_code, name_fr, name_ar) VALUES (?, ?, ?, ?)');
    const seedTx = db.transaction(() => {
      for (const w of locations.wilayas) insWilaya.run(w.code, w.name_fr, w.name_ar);
      for (const c of locations.communes) insCommune.run(c.id, c.wilaya_code, c.name_fr, c.name_ar);
    });
    seedTx();
    console.log('Wilayas et communes créées.');
  }

  if (db.prepare('SELECT COUNT(*) AS n FROM categories').get().n === 0) {
    const insCat = db.prepare('INSERT INTO categories (slug, name_fr, name_ar) VALUES (?, ?, ?)');
    insCat.run('vetements', 'Vêtements', 'ملابس');
    insCat.run('chaussures', 'Chaussures', 'أحذية');
    insCat.run('accessoires', 'Accessoires', 'إكسسوارات');
    console.log('Catégories créées.');
  }

  if (db.prepare('SELECT COUNT(*) AS n FROM products').get().n === 0) {
    const vet = db.prepare('SELECT id FROM categories WHERE slug = ?').get('vetements');
    const chs = db.prepare('SELECT id FROM categories WHERE slug = ?').get('chaussures');
    const acc = db.prepare('SELECT id FROM categories WHERE slug = ?').get('accessoires');
    const insProd = db.prepare(`
      INSERT INTO products
        (slug, name_fr, name_ar, description_fr, description_ar, price_dzd, image, stock, sizes, category_id, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const P = (slug, nfr, nar, dfr, dar, price, stock, cat, sizes, image = '') =>
      insProd.run(slug, nfr, nar, dfr, dar, price, image, stock, sizes, cat.id, 1);

    // Vêtements
    P('t-shirt-coton', 'T-shirt coton', 'تيشيرت قطن',
      'T-shirt 100% coton, coupe confortable pour tous les jours.',
      'تيشيرت قطن 100% بقصّة مريحة للاستعمال اليومي.', 1500, 50, vet, 'S,M,L,XL', '/images/products/t-shirt-coton.jpg');
    P('chemise-oxford', 'Chemise oxford', 'قميص أكسفورد',
      'Chemise en coton oxford, col boutonné, coupe régulière.',
      'قميص من قطن أكسفورد بياقة بأزرار وقصّة عادية.', 3200, 25, vet, 'S,M,L,XL', '/images/products/chemise-oxford.jpg');
    P('jean-classique', 'Jean classique', 'جينز كلاسيكي',
      'Jean coupe droite en denim robuste.',
      'جينز بقصّة مستقيمة من قماش الدنيم المتين.', 4500, 30, vet, '38,40,42,44,46', '/images/products/jean-classique.jpg');
    P('sweat-capuche', 'Sweat à capuche', 'سويت شيرت بقلنسوة',
      'Sweat à capuche doux et chaud, doublure polaire.',
      'سويت شيرت بقلنسوة ناعم ودافئ ببطانة صوفية.', 3900, 4, vet, 'S,M,L,XL', '/images/products/sweat-capuche.jpg');

    // Chaussures
    P('baskets-running', 'Baskets running', 'حذاء رياضي للجري',
      'Baskets légères avec semelle amortissante pour le sport.',
      'حذاء رياضي خفيف بنعل ماص للصدمات.', 6500, 20, chs, '40,41,42,43,44', '/images/products/baskets-running.jpg');
    P('sandales-cuir', 'Sandales en cuir', 'صندل جلدي',
      'Sandales en cuir véritable, semelle antidérapante.',
      'صندل من الجلد الطبيعي بنعل مقاوم للانزلاق.', 4800, 3, chs, '40,41,42,43,44');
    P('mocassins', 'Mocassins élégants', 'حذاء موكاسان أنيق',
      'Mocassins en cuir souple pour un look habillé.',
      'حذاء موكاسان من الجلد الناعم لإطلالة أنيقة.', 7200, 12, chs, '40,41,42,43,44');

    // Accessoires
    P('ceinture-cuir', 'Ceinture en cuir', 'حزام جلدي',
      'Ceinture en cuir véritable avec boucle métallique.',
      'حزام من الجلد الطبيعي بإبزيم معدني.', 1800, 40, acc, 'Taille unique');
    P('sac-a-dos', 'Sac à dos urbain', 'حقيبة ظهر',
      'Sac à dos résistant avec compartiment pour ordinateur.',
      'حقيبة ظهر متينة مع جيب مخصص للحاسوب.', 3500, 15, acc, 'Taille unique');
    P('casquette', 'Casquette classique', 'قبعة كلاسيكية',
      'Casquette en coton réglable, visière courbée.',
      'قبعة قطنية قابلة للتعديل بحاجب منحنٍ.', 1200, 2, acc, 'Taille unique');

    console.log('Produits d\'exemple créés.');
  }

  console.log('Base prête.');
}

module.exports = { initSchema, seed };

if (require.main === module) {
  seed();
}
