// ==================== CONFIG ====================
// Définis ton backend ngrok une seule fois
let API_BASE = "https://betexpress.onrender.com"; // ✅ toujours en https
// ⚡ change en "https://xxxx.ngrok-free.app" quand tu utilises Ngrok

// ==================== NAVIGATION ====================
const navBtns = document.querySelectorAll(".nav-btn");
const pages = document.querySelectorAll(".page");

navBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.target;

    // Affichage des pages
    pages.forEach(p => p.classList.remove("active"));
    document.getElementById(target).classList.add("active");

    // Bouton actif
    navBtns.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");

    // Charger les données dynamiques
    if (target === "page-clients") loadClients();
    if (target === "page-his-depot") loadDepot();
    if (target === "page-dashboard") {
      loadDesh();
      loadVentesJour();
      loadVentesMois();
      loadBenefDep();
    }
  });
});

// ==================== FORMULAIRE TRANSACTION ====================
document.getElementById("usdtForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const destinataire = document.getElementById("destinataire").value.trim();
  const montant = parseFloat(document.getElementById("montant").value);
  const prixusdt = parseFloat(document.getElementById("prixusdt").value);
  const totldz = prixusdt * montant;
  const etat = document.getElementById("etat").value;

  if (isNaN(montant) || isNaN(prixusdt)) {
    document.getElementById("message").innerText = "❌ Remplis les champs obligatoires.";
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ destinataire, montant, prixusdt, totldz, etat }),
    });

    const data = await res.json();

    if (!res.ok) {
      document.getElementById("message").innerText = ` ${data.error || data.message}`;
      return;
    }

    if (data.error === "NOT_ENOUGH") {
      showSplitModal(destinataire, montant, prixusdt, totldz, etat, data);
      return;
    }

    document.getElementById("message").innerText = "✅ Transaction ajoutée avec succès !";
    e.target.reset();
    loadClients();
  } catch (err) {
    document.getElementById("message").innerText = `❌ Erreur de connexion: ${err.message}`;
  }
});

// ==================== FORMULAIRE DEPOT ====================
document.getElementById("usdtdepot").addEventListener("submit", async (e) => {
  e.preventDefault();

  const depotUsdt = parseFloat(document.getElementById("deppotusdt").value);
  const PrixUnit = parseFloat(document.getElementById("usdtdz").value);
  const totalDZ = depotUsdt * PrixUnit;

  try {
    const res = await fetch(`${API_BASE}/api/depotusdt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ depotUsdt, PrixUnit, totalDZ }),
    });

    await res.json();
    document.querySelector("#page-depot-usdt #message").innerText = "✅ Dépôt ajouté avec succès !";
    e.target.reset();
  } catch (err) {
    document.querySelector("#page-depot-usdt #message").innerText = `❌ Erreur: ${err.message}`;
  }
});

// ==================== CLIENTS ====================
async function loadClients() {
  try {
    const res = await fetch(`${API_BASE}/api/transactions`);
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || "Erreur lors de la requête");

    const tbody = document.querySelector("#clientsTable tbody");
    tbody.innerHTML = "";

    data.forEach(t => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td class="clickable" onclick="showTransactionOverview(${t.id})">${t.destinataire || "—"}</td>
        <td>${t.montant}</td>
        <td>${t.etat}</td>
      `;
      tbody.appendChild(row);
    });
  } catch (err) {
    console.error("❌ loadClients:", err.message);
  }
}

async function showTransactionOverview(id) {
  try {
    const res = await fetch(`${API_BASE}/api/transactions/${id}`);
    const t = await res.json();

    if (!res.ok) throw new Error(t.error || "Impossible de charger la transaction");

    const modal = document.getElementById("overviewModal");
    const content = document.getElementById("overviewContent");

    content.innerHTML = `
      <h3>👤 ${t.destinataire || "—"}</h3>
      <p>📌 Date : <b>${new Date(t.date).toLocaleString()}</b></p>
      <p>💰 Montant : <input type="number" id="editMontant" value="${t.montant}" /></p>
      <p>📌 État : 
        <select id="editEtat">
          <option value="payer" ${t.etat === "payer" ? "selected" : ""}>✅ Payé</option>
          <option value="attente" ${t.etat === "attente" ? "selected" : ""}>⏳ En attente</option>
          <option value="nonpayer" ${t.etat === "nonpayer" ? "selected" : ""}>❌ Non payé</option>
        </select>
      </p>
      <button class="btn-update">💾 Mettre à jour</button>
      <button class="btn-delete">🗑️ Supprimer</button>
      <button class="btn-close" id="closeModal">Fermer</button>
    `;

    modal.classList.add("show");
    document.getElementById("closeModal").onclick = () => modal.classList.remove("show");

    modal.querySelector(".btn-update").onclick = async () => {
      const montant = parseFloat(document.getElementById("editMontant").value);
      const etat = document.getElementById("editEtat").value;
      await updateClient(id, { montant, etat, destinataire: t.destinataire });
      alert("✅ Transaction mise à jour !");
      modal.classList.remove("show");
    };

    modal.querySelector(".btn-delete").onclick = async () => {
      await deleteClient(id);
      modal.classList.remove("show");
    };
  } catch (err) {
    console.error(err);
    alert("Erreur lors du chargement de la transaction");
  }
}

async function updateClient(id, data) {
  await fetch(`${API_BASE}/api/transactions/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  loadClients();
}

async function deleteClient(id) {
  if (confirm("Supprimer cette transaction ?")) {
    await fetch(`${API_BASE}/api/transactions/${id}`, { method: "DELETE" });
    loadClients();
  }
}

// ==================== DEPOTS ====================
async function loadDepot() {
  try {
    const res = await fetch(`${API_BASE}/api/depotusdt`);
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || "Erreur de chargement dépôt");

    const tbody = document.querySelector("#depotTable tbody");
    tbody.innerHTML = "";

    data.forEach(t => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${t.depotUsdt}</td>
        <td>${t.pirceusdt}</td>
        <td>${t.totldz}</td>
      `;
      tbody.appendChild(row);
    });
  } catch (err) {
    console.error("❌ loadDepot:", err.message);
  }
}

// ==================== DASHBOARD ====================
async function loadDesh() {
  try {
    const res = await fetch(`${API_BASE}/api/solde-ventes`);
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || "Erreur dashboard");

    const soldeUsdt = document.getElementById("totUSDT");
    const venteSolde = document.getElementById("totVent");

    soldeUsdt.innerText = data.totalDepot.toFixed(2) + " USDT";
    venteSolde.style.color = "green";
    venteSolde.innerText = data.totalVentes.toFixed(2) + " USDT";
  } catch (err) {
    console.error("Erreur loadDesh:", err.message);
  }
}

async function loadVentesJour() {
  try {
    const res = await fetch(`${API_BASE}/api/vente-jour`);
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || "Erreur ventes jour");

    document.getElementById("venteJourUSDT").innerText = data.total_usdt.toFixed(2);
    document.getElementById("venteJourDZ").innerText = data.total_dz.toFixed(2);
  } catch (err) {
    console.error("Erreur loadVentesJour:", err.message);
  }
}

async function loadVentesMois() {
  try {
    const res = await fetch(`${API_BASE}/api/vente-mois`);
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || "Erreur ventes mois");

    document.getElementById("venteMoisUSDT").innerText = data.total_usdt.toFixed(2);
    document.getElementById("venteMoisDZ").innerText = data.total_dz.toFixed(2);
  } catch (err) {
    console.error("Erreur loadVentesMois:", err.message);
  }
}

async function loadBenefDep() {
  try {
    const res = await fetch(`${API_BASE}/api/benef-dep`);
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || "Erreur bénéfices");

    const depElem = document.getElementById("depp-dz");
    const benefElem = document.getElementById("benefDZ");

    depElem.innerText = data.totalDepense.toFixed(2) + " DZD";

    let benefValue = data.difference;

    if (benefValue < 0) {
      benefElem.innerText = benefValue.toFixed(2) + " DZD";
      benefElem.style.color = "red";
    } else if (benefValue === 0) {
      benefElem.innerText = "0 DZD";
      benefElem.style.color = "orange";
    } else {
      benefElem.innerText = benefValue.toFixed(2) + " DZD";
      benefElem.style.color = "green";
    }
  } catch (err) {
    console.error("Erreur loadBenefDep:", err.message);
  }
}
