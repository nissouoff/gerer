const sqlite3 = require("sqlite3").verbose();

// Connexion à la base (créée si elle n'existe pas)
const db = new sqlite3.Database("./usdt.db", (err) => {
  if (err) {
    console.error("❌ Erreur de connexion à SQLite:", err.message);
  } else {
    console.log("✅ Connecté à SQLite.");
  }
});

// Création des tables
db.serialize(() => {
  // Table des dépôts
  db.run(`
    CREATE TABLE IF NOT EXISTS depot (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      depotUsdt REAL NOT NULL,
      pirceusdt REAL NOT NULL,       -- prix unitaire
      totldz REAL NOT NULL,          -- total en DZD
      used REAL DEFAULT 0,
      date TIMESTAMP DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // Table des transactions
db.run(`
  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    destinataire TEXT NOT NULL,
    montant REAL NOT NULL,       -- montant en USDT par ex
    totaldz REAL NOT NULL,       -- total équivalent en DZD
    priceusdt REAL NOT NULL,     -- prix d'1 USDT en DZD
    etat TEXT NOT NULL,          -- statut de la transaction
    date TIMESTAMP DEFAULT (datetime('now', 'localtime'))

  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS total (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    total_usdt REAL,
    total_vente REAL
  )
`);

// ✅ Insérer la ligne par défaut seulement si le tableau est vide
db.get(`SELECT COUNT(*) as count FROM total`, (err, row) => {
  if (err) {
    console.error("Erreur vérif total:", err.message);
  } else if (row.count === 0) {
    db.run(`INSERT INTO total (total_usdt, total_vente) VALUES (?, ?)`, [0, 0], function (err2) {
      if (err2) {
        console.error("Erreur insertion défaut:", err2.message);
      } else {
        console.log("✔ Ligne par défaut insérée dans 'total'");
      }
    });
  }
});


});

module.exports = db;
