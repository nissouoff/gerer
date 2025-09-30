const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const db = require("./database");

const app = express();
const PORT = 3001;

// ✅ CORS config (une seule fois)
const corsOptions = {
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "ngrok-skip-browser-warning"]
};
app.use(cors(corsOptions)); // ça suffit pour gérer les préflights

app.use(express.json());
app.use(bodyParser.json());

app.get("/", (req, res) => {
  res.send("API BetExpress en ligne ✅");
});

// tes autres routes ici...


// backend (modif minimale)
app.post("/api/depotusdt", (req, res) => {
  let { depotUsdt, PrixUnit, totalDZ } = req.body;
  depotUsdt = Number(depotUsdt);
  PrixUnit = Number(PrixUnit);
  totalDZ = Number(totalDZ);

  if (!isFinite(depotUsdt) || !isFinite(PrixUnit)) {
    return res.status(400).json({ error: "Montant dépôt et prix unitaire requis et numériques." });
  }

  // 1️⃣ On enregistre le dépôt
  db.run(
    `INSERT INTO depot (depotUsdt, pirceusdt, totldz) VALUES (?, ?, ?)`,
    [depotUsdt, PrixUnit, totalDZ],
    function (err) {
      if (err) {
        console.error("DB error:", err);
        return res.status(500).json({ error: err.message });
      }

      // 2️⃣ Récupérer la valeur actuelle de total_usdt
      db.get(`SELECT total_usdt FROM total WHERE id = 1`, (err2, row) => {
        if (err2) {
          console.error("Erreur SELECT total:", err2);
          return res.status(500).json({ error: err2.message });
        }

        const currentTotal = row ? row.total_usdt : 0;
        const newTotal = currentTotal + depotUsdt;

        // 3️⃣ Mettre à jour total_usdt
        db.run(
          `UPDATE total SET total_usdt = ? WHERE id = 1`,
          [newTotal],
          function (err3) {
            if (err3) {
              console.error("Erreur UPDATE total:", err3);
              return res.status(500).json({ error: err3.message });
            }

            // 4️⃣ Réponse finale
            res.json({
              id: this.lastID,
              depotUsdt,
              PrixUnit,
              totalDZ,
              total_usdt_updated: newTotal,
            });
          }
        );
      });
    }
  );
});


app.post("/api/transactions", (req, res) => {
  const { destinataire, montant, prixusdt, totldz, etat } = req.body;

  if (!montant || !prixusdt || !etat) {
    return res.status(400).json({ error: "Champs obligatoires manquants." });
  }

  // 1️⃣ Vérifier si le solde est suffisant
  db.get(`SELECT total_usdt, total_vente FROM total WHERE id = 1`, (err, row) => {
    if (err) {
      console.error("Erreur SELECT total:", err);
      return res.status(500).json({ error: err.message });
    }

    const soldeDispo = row ? row.total_usdt : 0;   // Solde total dans la table
    const currentVente = row ? row.total_vente : 0;

    // Vérif: montant demandé + déjà vendu > total dispo
    // Vérif: montant demandé + déjà vendu > total dispo
const resteDispo = parseFloat(soldeDispo) - parseFloat(currentVente);

if (parseFloat(montant) > resteDispo) {
  return res.status(400).json({
    error: `❌ Solde USDT insuffisant. Il reste ${resteDispo} USDT disponible dans le compte.`,
  });
}


    // 2️⃣ Insérer la transaction
    db.run(
      `INSERT INTO transactions (destinataire, montant, totaldz, priceusdt, etat) 
       VALUES (?, ?, ?, ?, ?)`,
      [destinataire || "", montant, totldz, prixusdt, etat],
      function (err2) {
        if (err2) {
          console.error("Erreur SQL:", err2);
          return res.status(500).json({ error: err2.message });
        }

        const newVente = currentVente + montant;
        const newSolde = soldeDispo; // ⚠️ On ne diminue pas total_usdt, il reste comme "stock global"

        // 3️⃣ Mettre à jour uniquement total_vente
        db.run(
          `UPDATE total SET total_vente = ? WHERE id = 1`,
          [newVente],
          function (err3) {
            if (err3) {
              console.error("Erreur UPDATE total:", err3);
              return res.status(500).json({ error: err3.message });
            }

            // 4️⃣ Réponse finale
            res.json({
              id: this.lastID,
              destinataire,
              montant,
              totaldz: totldz,
              priceusdt: prixusdt,
              etat,
              total_vente_updated: newVente,
              solde_usdt_total: newSolde,
            });
          }
        );
      }
    );
  });
});



app.post("/api/transactions/split", (req, res) => {
  const { destinataire, montant, etat, depotIdNew } = req.body;
  const montantFloat = parseFloat(montant);

  if (!destinataire || isNaN(montantFloat) || montantFloat <= 0 || !etat || !depotIdNew) {
    return res.status(400).json({ error: "Données invalides pour split." });
  }

  db.get(
    `SELECT * FROM depot WHERE etat = "En cour" ORDER BY id ASC LIMIT 1`,
    (err, depotActuel) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!depotActuel) return res.status(400).json({ error: "Aucun dépôt en cours." });

      const resteDepotActuel = depotActuel.depotUsdt - depotActuel.used;
      const montantPremierDepot = Math.min(montantFloat, resteDepotActuel);
      const montantManquant = montantFloat - montantPremierDepot;

      if (montantManquant <= 0) {
        return res.status(400).json({ error: "Le split n'est pas nécessaire." });
      }

      // 🔹 Terminer le dépôt actuel (ou mettre à jour used si partiel)
      db.run(
        `UPDATE depot SET used = used + ?, etat = ? WHERE id = ?`,
        [montantPremierDepot, "Finish", depotActuel.id],
        function (err1) {
          if (err1) return res.status(500).json({ error: err1.message });

          // 🔹 Activer le nouveau dépôt
          db.run(
            `UPDATE depot SET etat = "En cour" WHERE id = ? AND etat = "STOP"`,
            [depotIdNew],
            function (err2) {
              if (err2) return res.status(500).json({ error: err2.message });
              if (this.changes === 0) {
                return res.status(400).json({ error: "Impossible d’activer ce dépôt." });
              }

              // 🔹 Consommer le manquant dans le nouveau dépôt
              db.get(`SELECT * FROM depot WHERE id = ?`, [depotIdNew], (err3, newDepot) => {
                if (err3) return res.status(500).json({ error: err3.message });
                if (!newDepot) return res.status(400).json({ error: "Nouveau dépôt introuvable." });

                const newUsed = (newDepot.used || 0) + montantManquant;
                const newEtat = newUsed >= newDepot.depotUsdt ? "Finish" : "En cour";

                db.run(
                  `UPDATE depot SET used = ?, etat = ? WHERE id = ?`,
                  [newUsed, newEtat, newDepot.id],
                  function (err4) {
                    if (err4) return res.status(500).json({ error: err4.message });

                    // 🔹 Enregistrer la transaction complète avec les deux dépôts
                    const depotIds = `${depotActuel.id}(${montantPremierDepot}),${newDepot.id}(${montantManquant})`;
                    db.run(
                      `INSERT INTO transactions (destinataire, montant, etat, depotId) VALUES (?, ?, ?, ?)`,
                      [destinataire, montantFloat, etat, depotIds],
                      function (err5) {
                        if (err5) return res.status(500).json({ error: err5.message });

                        res.json({
                          id: this.lastID,
                          destinataire,
                          montant: montantFloat,
                          etat,
                          depotIds,
                          message: "Transaction réalisée sur deux dépôts avec montants"
                        });
                      }
                    );
                  }
                );
              });
            }
          );
        }
      );
    }
  );
});

app.get("/api/transactions/:id", (req, res) => {
  const { id } = req.params;
  db.get(`SELECT * FROM transactions WHERE id = ?`, [id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(row);
  });
});

app.get("/api/transactions", (req, res) => {
  db.all(`SELECT * FROM transactions ORDER BY date DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// ✅ Mettre à jour une transaction
app.put("/api/transactions/:id", (req, res) => {
  const { id } = req.params;
  const { destinataire, montant, etat } = req.body;
  const nouveauMontant = parseFloat(montant);

  // Étape 1 : récupérer l'ancien montant
  db.get(`SELECT montant FROM transactions WHERE id = ?`, [id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: "Transaction introuvable" });

    const ancienMontant = parseFloat(row.montant);
    const difference = nouveauMontant - ancienMontant;

    // Étape 2 : récupérer le total actuel
    db.get(`SELECT total_vente FROM total WHERE id = 1`, (err2, totalRow) => {
      if (err2) return res.status(500).json({ error: err2.message });
      if (!totalRow) return res.status(400).json({ error: "Aucune donnée dans la table total" });

      const nouveauTotal = parseFloat(totalRow.total_vente) + difference;

      // Étape 3 : mettre à jour total
      db.run(`UPDATE total SET total_vente = ? WHERE id = 1`, [nouveauTotal], function (err3) {
        if (err3) return res.status(500).json({ error: err3.message });

        // Étape 4 : mettre à jour la transaction
        db.run(
          `UPDATE transactions SET destinataire = ?, montant = ?, etat = ? WHERE id = ?`,
          [destinataire, nouveauMontant, etat, id],
          function (err4) {
            if (err4) return res.status(500).json({ error: err4.message });

            res.json({
              updated: this.changes,
              oldAmount: ancienMontant,
              newAmount: nouveauMontant,
              newTotal: nouveauTotal,
            });
          }
        );
      });
    });
  });
});


// ✅ Supprimer une transaction
app.delete("/api/transactions/:id", (req, res) => {
  const { id } = req.params;

  // Étape 1 : récupérer le montant de la transaction
  db.get(`SELECT montant FROM transactions WHERE id = ?`, [id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: "Transaction introuvable" });

    const montant = parseFloat(row.montant);

    // Étape 2 : récupérer le total actuel
    db.get(`SELECT total_vente FROM total WHERE id = 1`, (err2, totalRow) => {
      if (err2) return res.status(500).json({ error: err2.message });
      if (!totalRow) return res.status(400).json({ error: "Aucune donnée dans la table total" });

      const nouveauTotal = parseFloat(totalRow.total_vente) - montant;

      // Étape 3 : mettre à jour le total
      db.run(`UPDATE total SET total_vente = ? WHERE id = 1`, [nouveauTotal], function (err3) {
        if (err3) return res.status(500).json({ error: err3.message });

        // Étape 4 : supprimer la transaction
        db.run(`DELETE FROM transactions WHERE id = ?`, [id], function (err4) {
          if (err4) return res.status(500).json({ error: err4.message });
          res.json({ deleted: this.changes, newTotal: nouveauTotal });
        });
      });
    });
  });
});



app.get("/api/depotusdt", (req, res) => {
  db.all(`SELECT * FROM depot ORDER BY date DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get("/api/total", (req, res) => {
  db.all(`SELECT * FROM total WHERE id = 1`, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});


app.get("/api/vente-jour", (req, res) => {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  const query = `
    SELECT 
      IFNULL(SUM(montant), 0) AS total_usdt,
      IFNULL(SUM(priceusdt * montant), 0) AS total_dz
    FROM transactions
    WHERE DATE(date) = ?
  `;

  db.get(query, [today], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(row);
  });
});

app.get("/api/vente-mois", (req, res) => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0"); // mois 01-12

  const query = `
    SELECT 
      IFNULL(SUM(montant), 0) AS total_usdt,
      IFNULL(SUM(priceusdt * montant), 0) AS total_dz
    FROM transactions
    WHERE strftime('%Y-%m', date) = ?
  `;

  db.get(query, [`${year}-${month}`], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(row);
  });
});

app.get("/api/solde-ventes", (req, res) => {
  // Total dépôts
  db.get(`SELECT SUM(depotUsdt) AS totalDepot FROM depot`, (err, rowDepot) => {
    if (err) return res.status(500).json({ error: err.message });

    const totalDepot = rowDepot?.totalDepot || 0;

    // Total ventes
    db.get(`SELECT SUM(montant) AS totalVentes FROM transactions`, (err2, rowVentes) => {
      if (err2) return res.status(500).json({ error: err2.message });

      const totalVentes = rowVentes?.totalVentes || 0;

      res.json({ totalDepot, totalVentes });
    });
  });
});

app.get("/api/benef-dep", (req, res) => {
  // Total dépôts en DZD
  db.get(`SELECT SUM(totldz) AS totalDepense FROM depot`, (err, rowDepot) => {
    if (err) return res.status(500).json({ error: err.message });

    const totalDepense = rowDepot?.totalDepense || 0;

    // Total ventes en DZD
    db.get(`SELECT SUM(totaldz) AS totalVente FROM transactions`, (err2, rowVentes) => {
      if (err2) return res.status(500).json({ error: err2.message });

      const totalVente = rowVentes?.totalVente || 0;

      const difference = totalVente - totalDepense;

      res.json({
        totalDepense,
        totalVente,
        difference
      });
    });
  });
});



app.listen(PORT, () => {
  console.log(`🚀 Backend lancé sur http://localhost:${PORT}`);
});
