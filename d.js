const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const db = require("./database");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(bodyParser.json());

/**
 * ✅ Ajouter une transaction classique
 * - Vérifie le dépôt en cours
 * - Si insuffisant → retourne une erreur spéciale avec liste des dépôts STOP
 */
// =================== POST /api/transactions ===================
// =================== POST /api/transactions ===================
app.post("/api/transactions", (req, res) => {
  const { destinataire, montant, etat, depotIdsSelected } = req.body;
  let reste = parseFloat(montant);

  if (!destinataire || isNaN(reste) || reste <= 0 || !etat) {
    return res.status(400).json({ error: "Données invalides." });
  }

  const depotList = []; // Stocke les dépôts utilisés et montants

  // 🔹 Fonction récursive pour traiter les dépôts
  function processDepot(index = 0, depotsToCheck = []) {
    // Si le montant est entièrement couvert
    if (reste <= 0) {
      const depotIdsString = depotList.map(d => `${d.id}(${d.montant})`).join(",");
      db.run(
        `INSERT INTO transactions (destinataire, montant, etat, depotId) VALUES (?, ?, ?, ?)`,
        [destinataire, montant, etat, depotIdsString],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({
            id: this.lastID,
            destinataire,
            montant,
            etat,
            depotIds: depotIdsString,
            message: "Transaction réalisée sur plusieurs dépôts"
          });
        }
      );
      return;
    }

    // Si on a épuisé tous les dépôts à traiter
    if (index >= depotsToCheck.length) {
      // ⚡ Charger les dépôts STOP disponibles
      db.all(`SELECT * FROM depot WHERE etat = "STOP" ORDER BY id ASC`, [], (err2, depotsStop) => {
        if (err2) return res.status(500).json({ error: err2.message });

        return res.status(409).json({
          error: "NOT_ENOUGH",
          reste,
          depotsStop, // ✅ On envoie la vraie liste au front
          message: "Le montant n'est pas encore couvert, sélectionne un autre dépôt STOP"
        });
      });
      return;
    }

    const depotId = depotsToCheck[index];

    db.get(
      `SELECT * FROM depot WHERE id = ? AND (etat = "En cour" OR etat = "STOP")`,
      [depotId],
      (err, depot) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!depot) return res.status(400).json({ error: "Dépôt choisi invalide" });

        // Montant utilisable dans ce dépôt
        const available = depot.depotUsdt - (depot.used || 0);
        const toUse = Math.min(available, reste);

        // Mettre à jour le dépôt
        const newUsed = (depot.used || 0) + toUse;
        const newEtat = newUsed >= depot.depotUsdt ? "Finish" : "En cour";

        db.run(
          `UPDATE depot SET used = ?, etat = ? WHERE id = ?`,
          [newUsed, newEtat, depot.id],
          function (err2) {
            if (err2) return res.status(500).json({ error: err2.message });

            depotList.push({ id: depot.id, montant: toUse });
            reste -= toUse;

            // Appel récursif pour le dépôt suivant
            processDepot(index + 1, depotsToCheck);
          }
        );
      }
    );
  }

  // 🔹 Récupération des dépôts actifs + STOP si aucun dépôt choisi
  if (!depotIdsSelected || depotIdsSelected.length === 0) {
    db.all(`SELECT * FROM depot WHERE etat = "En cour" ORDER BY id ASC`, [], (err, depotsActifs) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!depotsActifs || depotsActifs.length === 0) {
        return res.status(400).json({ error: "Aucun dépôt actif." });
      }

      // Si le dépôt actif ne suffit pas
      const depotActifId = depotsActifs[0].id;
      const disponible = depotsActifs[0].depotUsdt - depotsActifs[0].used;
      if (reste <= disponible) {
        processDepot(0, [depotActifId]);
      } else {
        // ⚡ Charger les dépôts STOP pour les envoyer aussi
        db.all(`SELECT * FROM depot WHERE etat = "STOP" ORDER BY id ASC`, [], (err2, depotsStop) => {
          if (err2) return res.status(500).json({ error: err2.message });

          return res.status(409).json({
            error: "NOT_ENOUGH",
            reste,
            depotsStop, // ✅ Liste renvoyée au front
            message: "Le dépôt actif ne suffit pas, choisis un dépôt STOP"
          });
        });
      }
    });
  } else {
    // Dépôts déjà choisis par l'utilisateur
    processDepot(0, depotIdsSelected);
  }
});


/**
 * ✅ Transaction split (si le dépôt en cours est épuisé)
 * - Termine l’ancien dépôt (etat = Finish)
 * - Active le nouveau dépôt choisi
 * - Consomme le reste manquant dans le nouveau dépôt
 */
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

/**
 * ✅ Ajouter un dépôt USDT
 */
app.post("/api/depotusdt", (req, res) => {
  const { depotUsdt, PrixUnit, totalDZ } = req.body;

  if (!depotUsdt || !PrixUnit) {
    return res.status(400).json({ error: "Montant dépôt et prix unitaire requis." });
  }

  db.run(
    `INSERT INTO depot (depotUsdt, PrixUnit, totalDZ) VALUES (?, ?, ?)`,
    [depotUsdt, PrixUnit, totalDZ],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, depotUsdt, PrixUnit, totalDZ });
    }
  );
});

/**
 * ✅ Récupérer toutes les transactions
 */
app.get("/api/transactions", (req, res) => {
  db.all(`SELECT * FROM transactions ORDER BY date DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

/**
 * ✅ Récupérer toutes les dépôts
 */
app.get("/api/depotusdt", (req, res) => {
  db.all(`SELECT * FROM depot ORDER BY date DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

/**
 * ✅ Modifier une transaction
 */
app.put("/api/transactions/:id", (req, res) => {
  const { id } = req.params;
  const { destinataire, montant, etat } = req.body;

  db.run(
    `UPDATE transactions SET destinataire = ?, montant = ?, etat = ? WHERE id = ?`,
    [destinataire, montant, etat, id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ updated: this.changes });
    }
  );
});

/**
 * ✅ Supprimer une transaction
 */
app.delete("/api/transactions/:id", (req, res) => {
  const { id } = req.params;

  db.run(`DELETE FROM transactions WHERE id = ?`, id, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ deleted: this.changes });
  });
});

/**
 * ✅ Récupérer une transaction par ID
 */
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

/**
 * ✅ Lancer serveur
 */
app.listen(PORT, () => {
  console.log(`🚀 Backend lancé sur http://localhost:${PORT}`);
});
