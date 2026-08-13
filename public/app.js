const API = "/api";
const app = document.getElementById("app");
const sessionInfo = document.getElementById("session-info");

const state = {
  token: localStorage.getItem("token") || null,
  email: localStorage.getItem("email") || null,
};

async function api(path, options = {}) {
  const res = await fetch(API + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json() : null;
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.details = data?.details;
    err.field = data?.field;
    throw err;
  }
  return data;
}

function money(n) {
  return `$${Number(n).toFixed(2)}`;
}

function logout() {
  state.token = null;
  state.email = null;
  localStorage.removeItem("token");
  localStorage.removeItem("email");
  render();
}

function render() {
  app.innerHTML = "";
  if (!state.token) {
    sessionInfo.innerHTML = "";
    renderAuth();
  } else {
    sessionInfo.innerHTML = `<span>${state.email}</span> <button class="secondary" id="logout-btn">Log out</button>`;
    document.getElementById("logout-btn").onclick = logout;
    renderDashboard();
  }
}

// ---------- Auth ----------

function renderAuth() {
  const tpl = document.getElementById("tpl-auth").content.cloneNode(true);
  app.appendChild(tpl);

  let mode = "login";
  const tabs = app.querySelectorAll(".tab-btn");
  tabs.forEach((btn) => {
    btn.onclick = () => {
      mode = btn.dataset.tab;
      tabs.forEach((b) => b.classList.toggle("active", b === btn));
    };
  });

  const form = document.getElementById("auth-form");
  const errorEl = document.getElementById("auth-error");

  form.onsubmit = async (e) => {
    e.preventDefault();
    errorEl.textContent = "";
    const fd = new FormData(form);
    const body = { email: fd.get("email"), password: fd.get("password") };
    try {
      const data = await api(`/auth/${mode === "login" ? "login" : "signup"}`, { method: "POST", body });
      state.token = data.token;
      state.email = data.user.email;
      localStorage.setItem("token", state.token);
      localStorage.setItem("email", state.email);
      render();
    } catch (err) {
      errorEl.textContent = err.message;
    }
  };
}

// ---------- Dashboard ----------

async function renderDashboard() {
  const tpl = document.getElementById("tpl-dashboard").content.cloneNode(true);
  app.appendChild(tpl);

  document.getElementById("new-doc-btn").onclick = () => createDraftAndOpen();

  const switchButtons = app.querySelectorAll(".view-switch button");
  switchButtons.forEach((btn) => {
    btn.onclick = () => {
      switchButtons.forEach((b) => b.classList.toggle("active", b === btn));
      document.getElementById("view-documents").hidden = btn.dataset.view !== "documents";
      document.getElementById("view-report").hidden = btn.dataset.view !== "report";
    };
  });

  await renderDocumentList();
  renderReportView();
}

async function createDraftAndOpen() {
  try {
    const doc = await api("/documents", {
      method: "POST",
      body: { title: "Untitled document", customer: "New customer", issueDate: new Date().toISOString().slice(0, 10), lines: [] },
    });
    openDocument(doc.id);
  } catch (err) {
    alert(err.message);
  }
}

async function renderDocumentList() {
  const container = document.getElementById("view-documents");
  container.innerHTML = "";
  const { documents } = await api("/documents");
  const tpl = document.getElementById("tpl-doc-list").content.cloneNode(true);
  container.appendChild(tpl);
  const tbody = document.getElementById("doc-rows");

  if (documents.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:#888">No documents yet. Create one to get started.</td></tr>`;
    return;
  }

  for (const doc of documents) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(doc.title)}</td>
      <td>${escapeHtml(doc.customer)}</td>
      <td>${doc.issueDate}</td>
      <td><span class="badge ${doc.status}">${doc.status}</span></td>
      <td>${money(doc.grandTotal)}</td>
      <td></td>
    `;
    tr.onclick = () => openDocument(doc.id);
    tbody.appendChild(tr);
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// ---------- Document detail ----------

async function openDocument(id) {
  const doc = await api(`/documents/${id}`);
  const container = document.getElementById("view-documents");
  document.querySelectorAll(".view-switch button").forEach((b) => b.classList.remove("active"));
  document.getElementById("view-report").hidden = true;
  container.hidden = false;
  container.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.className = "card doc-detail";

  const readOnly = doc.status === "finalized";

  wrap.innerHTML = `
    <button class="back-link">&larr; Back to documents</button>
    <div class="doc-meta">
      <label>Title <input name="title" value="${escapeHtml(doc.title)}" ${readOnly ? "disabled" : ""} /></label>
      <label>Customer <input name="customer" value="${escapeHtml(doc.customer)}" ${readOnly ? "disabled" : ""} /></label>
      <label>Issue date <input type="date" name="issueDate" value="${doc.issueDate}" ${readOnly ? "disabled" : ""} /></label>
    </div>
    <div class="error" id="doc-error"></div>
    <table class="line-table">
      <thead>
        <tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Discount</th><th>Tax %</th>
        <th>Subtotal</th><th>Disc.</th><th>Tax</th><th>Total</th><th></th></tr>
      </thead>
      <tbody id="line-rows"></tbody>
    </table>
    ${readOnly ? "" : `<button class="secondary" id="add-line-btn">+ Add line item</button>`}
    <div class="totals-panel">
      <div><span>Subtotal</span><span>${money(doc.totals.subtotal)}</span></div>
      <div><span>Total discount</span><span>${money(doc.totals.totalDiscount)}</span></div>
      <div><span>Total tax</span><span>${money(doc.totals.totalTax)}</span></div>
      <div class="grand"><span>Grand total</span><span>${money(doc.totals.grandTotal)}</span></div>
    </div>
    <div class="actions-row">
      <button class="secondary" id="print-btn">Print / Save PDF</button>
      ${readOnly
        ? `<button id="duplicate-btn">Duplicate into new draft</button>`
        : `<button id="finalize-btn">Finalize</button><button class="danger" id="delete-btn">Delete draft</button>`}
    </div>
    ${readOnly ? `<p style="color:var(--muted);font-size:0.85rem">This document is finalized and read-only. Metadata, amounts, and line items can no longer be edited.</p>` : ""}
  `;

  container.appendChild(wrap);

  wrap.querySelector(".back-link").onclick = renderDocumentList;
  wrap.querySelector("#print-btn").onclick = () => {
    renderPrintView(doc);
    window.print();
  };

  const errorEl = wrap.querySelector("#doc-error");
  const showError = (err) => { errorEl.textContent = err.message; };

  if (!readOnly) {
    wrap.querySelector('input[name="title"]').onchange = (e) => patchDoc(doc.id, { title: e.target.value }, showError);
    wrap.querySelector('input[name="customer"]').onchange = (e) => patchDoc(doc.id, { customer: e.target.value }, showError);
    wrap.querySelector('input[name="issueDate"]').onchange = (e) => patchDoc(doc.id, { issueDate: e.target.value }, showError);
  }

  const tbody = wrap.querySelector("#line-rows");
  for (const line of doc.lines) {
    tbody.appendChild(renderLineRow(doc, line, readOnly, showError));
  }

  if (!readOnly) {
    wrap.querySelector("#add-line-btn").onclick = async () => {
      try {
        await api(`/documents/${doc.id}/lines`, {
          method: "POST",
          body: { description: "New item", quantity: 1, unitPrice: 0 },
        });
        openDocument(doc.id);
      } catch (err) {
        showError(err);
      }
    };
    wrap.querySelector("#finalize-btn").onclick = async () => {
      if (!confirm("Finalize this document? It will become read-only.")) return;
      try {
        await api(`/documents/${doc.id}/finalize`, { method: "POST" });
        openDocument(doc.id);
      } catch (err) {
        showError(err);
      }
    };
    wrap.querySelector("#delete-btn").onclick = async () => {
      if (!confirm("Delete this draft document?")) return;
      await api(`/documents/${doc.id}`, { method: "DELETE" });
      renderDocumentList();
    };
  } else {
    wrap.querySelector("#duplicate-btn").onclick = async () => {
      const copy = await api(`/documents/${doc.id}/duplicate`, { method: "POST" });
      openDocument(copy.id);
    };
  }
}

// Renders a clean, plain-text version of the document (no form inputs) into
// #print-area, which is invisible on screen and the only thing visible under
// the @media print rules in styles.css. Built from the same doc object the
// detail view already fetched — no extra request, no auth-in-URL needed.
function renderPrintView(doc) {
  const printArea = document.getElementById("print-area");

  const rows = doc.lines
    .map(
      (line) => `
      <tr>
        <td>${escapeHtml(line.description)}</td>
        <td>${line.quantity}</td>
        <td>${money(line.unitPrice)}</td>
        <td>${line.discount ? (line.discount.type === "percent" ? `${line.discount.value}%` : money(line.discount.value)) : "—"}</td>
        <td>${line.taxPercent != null ? `${line.taxPercent}%` : "—"}</td>
        <td>${money(line.total)}</td>
      </tr>`
    )
    .join("");

  printArea.innerHTML = `
    <h1>${escapeHtml(doc.title)}</h1>
    <div class="print-status">${doc.status}</div>
    <div class="print-meta">
      <div><strong>Customer</strong><br>${escapeHtml(doc.customer)}</div>
      <div><strong>Issue date</strong><br>${doc.issueDate}</div>
    </div>
    <table>
      <thead>
        <tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Discount</th><th>Tax</th><th>Line total</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="print-totals">
      <div><span>Subtotal</span><span>${money(doc.totals.subtotal)}</span></div>
      <div><span>Total discount</span><span>${money(doc.totals.totalDiscount)}</span></div>
      <div><span>Total tax</span><span>${money(doc.totals.totalTax)}</span></div>
      <div class="grand"><span>Grand total</span><span>${money(doc.totals.grandTotal)}</span></div>
    </div>
  `;
}

async function patchDoc(id, body, onError) {
  try {
    await api(`/documents/${id}`, { method: "PATCH", body });
  } catch (err) {
    onError(err);
  }
}

function renderLineRow(doc, line, readOnly, showError) {
  const tr = document.createElement("tr");
  const discountType = line.discount?.type ?? "";
  const discountValue = line.discount?.value ?? "";

  tr.innerHTML = `
    <td><input name="description" value="${escapeHtml(line.description)}" ${readOnly ? "disabled" : ""} /></td>
    <td><input name="quantity" type="number" step="any" min="1" value="${line.quantity}" style="width:5rem" ${readOnly ? "disabled" : ""} /></td>
    <td><input name="unitPrice" type="number" step="0.01" min="0" value="${line.unitPrice}" style="width:6rem" ${readOnly ? "disabled" : ""} /></td>
    <td>
      <select name="discountType" ${readOnly ? "disabled" : ""}>
        <option value="">None</option>
        <option value="percent" ${discountType === "percent" ? "selected" : ""}>Percent</option>
        <option value="fixed" ${discountType === "fixed" ? "selected" : ""}>Fixed</option>
      </select>
      <input name="discountValue" type="number" step="0.01" min="0" value="${discountValue}" style="width:5rem" ${readOnly || !discountType ? "disabled" : ""} />
    </td>
    <td><input name="taxPercent" type="number" step="0.01" min="0" max="100" value="${line.taxPercent ?? ""}" style="width:4.5rem" ${readOnly ? "disabled" : ""} /></td>
    <td>${money(line.subtotal)}</td>
    <td>${money(line.discountAmount)}</td>
    <td>${money(line.taxAmount)}</td>
    <td>${money(line.total)}</td>
    <td>${readOnly ? "" : `<button class="danger" data-role="remove">&times;</button>`}</td>
  `;

  if (readOnly) return tr;

  const discountTypeEl = tr.querySelector('select[name="discountType"]');
  const discountValueEl = tr.querySelector('input[name="discountValue"]');
  discountTypeEl.onchange = () => {
    discountValueEl.disabled = !discountTypeEl.value;
    if (!discountTypeEl.value) discountValueEl.value = "";
  };

  const commit = async () => {
    const description = tr.querySelector('input[name="description"]').value;
    const quantity = Number(tr.querySelector('input[name="quantity"]').value);
    const unitPrice = Number(tr.querySelector('input[name="unitPrice"]').value);
    const taxRaw = tr.querySelector('input[name="taxPercent"]').value;
    const taxPercent = taxRaw === "" ? null : Number(taxRaw);
    const discount = discountTypeEl.value
      ? { type: discountTypeEl.value, value: Number(discountValueEl.value || 0) }
      : null;

    try {
      await api(`/documents/${doc.id}/lines/${line.id}`, {
        method: "PATCH",
        body: { description, quantity, unitPrice, discount, taxPercent },
      });
      openDocument(doc.id);
    } catch (err) {
      showError(err);
    }
  };

  tr.querySelectorAll("input, select").forEach((el) => (el.onchange = commit));
  tr.querySelector('[data-role="remove"]').onclick = async () => {
    await api(`/documents/${doc.id}/lines/${line.id}`, { method: "DELETE" });
    openDocument(doc.id);
  };

  return tr;
}

// ---------- Report ----------

function renderReportView() {
  const container = document.getElementById("view-report");
  container.innerHTML = "";
  const tpl = document.getElementById("tpl-report").content.cloneNode(true);
  container.appendChild(tpl);

  const form = document.getElementById("report-form");
  const results = document.getElementById("report-results");

  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 8) + "01";
  form.from.value = monthStart;
  form.to.value = today;

  form.onsubmit = async (e) => {
    e.preventDefault();
    const from = form.from.value;
    const to = form.to.value;
    try {
      const data = await api(`/reports/summary?from=${from}&to=${to}`);
      results.innerHTML = `
        <div class="report-results-grid">
          <div class="stat"><div class="label">Documents</div><div class="value">${data.documentCount}</div></div>
          <div class="stat"><div class="label">Sum of grand totals</div><div class="value">${money(data.grandTotal)}</div></div>
          <div class="stat"><div class="label">Sum of tax</div><div class="value">${money(data.totalTax)}</div></div>
          <div class="stat"><div class="label">Sum of discount</div><div class="value">${money(data.totalDiscount)}</div></div>
        </div>
      `;
    } catch (err) {
      results.innerHTML = `<p class="error">${err.message}</p>`;
    }
  };

  form.requestSubmit();
}

render();
