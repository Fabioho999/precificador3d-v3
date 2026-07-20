const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const brl = value => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dateBR = value => value ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(new Date(value.includes?.("T") ? value : `${value}T12:00:00-03:00`)) : "A combinar";

export function buildOrderDocument({ order, items = [], settings = {}, attachments = [] }) {
  if (!order) throw new Error("Pedido não encontrado para gerar o PDF.");
  const rows = items.map(item => `<tr><td>${escapeHtml(item.name)}</td><td>${Number(item.quantity || 0)}</td><td>${Number(item.unit_weight_g || 0).toLocaleString("pt-BR")} g</td><td>${escapeHtml(item.material || "")}</td></tr>`).join("");
  const photos = attachments.filter(file => file.kind === "product_photo" && file.url).map(file => `<img src="${escapeHtml(file.url)}" alt="Foto do produto">`).join("");
  const pix = settings.pix_key ? `<section class="pix"><b>Pagamento via PIX</b><div>${escapeHtml(settings.pix_key)}</div>${settings.pix_holder ? `<small>Titular: ${escapeHtml(settings.pix_holder)}</small>` : ""}</section>` : "";
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Orçamento ${escapeHtml(order.project)}</title><style>
  @page{size:A4;margin:14mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#162030;margin:0;font-size:12px}header{display:flex;justify-content:space-between;border-bottom:3px solid #12afc2;padding-bottom:12px}header img{max-height:55px;max-width:150px}h1{margin:0;font-size:23px}h2{font-size:14px;margin:20px 0 7px;color:#087d8c}p{line-height:1.5}.meta{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:14px}.meta div{padding:7px;background:#f3f7fa;border-radius:5px}table{width:100%;border-collapse:collapse}th,td{padding:7px;border-bottom:1px solid #d7e0e7;text-align:left}.total{font-size:18px;font-weight:bold;text-align:right;background:#e8fbfd;padding:13px;margin:18px 0;border-left:4px solid #12afc2}.photos{display:grid;grid-template-columns:1fr 1fr;gap:8px}.photos img{width:100%;height:210px;object-fit:contain;border:1px solid #d7e0e7;border-radius:5px}.pix{text-align:center;border:1px dashed #7c8c9b;padding:12px;margin:16px 0}.pix div{font-family:monospace;font-size:13px;margin:6px}.notes{white-space:pre-wrap;color:#526273}footer{text-align:center;color:#7c8c9b;border-top:1px solid #d7e0e7;margin-top:20px;padding-top:10px}@media print{button{display:none}}
  </style></head><body><header><div>${settings.logo_url ? `<img src="${escapeHtml(settings.logo_url)}">` : ""}</div><div><h1>${escapeHtml(settings.studio_name || "Studio FH3D")}</h1><div>Orçamento de impressão 3D</div></div></header>
  <div class="meta"><div><b>Cliente</b><br>${escapeHtml(order.customer_name || "Não informado")}${order.customer_phone?`<br><small>${escapeHtml(order.customer_phone)}</small>`:""}</div><div><b>Projeto</b><br>${escapeHtml(order.project)}</div><div><b>Emissão</b><br>${dateBR(order.created_at)}</div><div><b>Entrega</b><br>${dateBR(order.due_date)}</div></div>
  ${order.description ? `<h2>Descrição</h2><p>${escapeHtml(order.description)}</p>` : ""}<h2>Itens</h2><table><thead><tr><th>Item</th><th>Qtd.</th><th>Peso unitário</th><th>Material</th></tr></thead><tbody>${rows}</tbody></table>
  ${photos ? `<h2>Referências do produto</h2><div class="photos">${photos}</div>` : ""}${order.notes?`<h2>Observações</h2><div class="notes">${escapeHtml(order.notes)}</div>`:""}<div class="total">Valor total: ${brl(order.final_price)}</div>${pix}
  <h2>Condições</h2><div class="notes">${escapeHtml(settings.modification_terms || "")}
${escapeHtml(settings.validity_terms || "Orçamento válido por 7 dias.")}
${escapeHtml(settings.general_notes || "")}</div>
  <footer>${[settings.whatsapp, settings.email, settings.instagram].filter(Boolean).map(escapeHtml).join(" · ")}</footer></body></html>`;
}

export function generateOrderPdf(payload, existingPopup = null) {
  const html = buildOrderDocument(payload);
  const popup = existingPopup || window.open("", "_blank");
  if (!popup) throw new Error("O navegador bloqueou a janela do PDF. Libere pop-ups para este site.");
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
  popup.addEventListener("load", async () => {
    const images = [...popup.document.images];
    await Promise.all(images.map(image => image.decode?.().catch(() => undefined)));
    popup.focus();
    popup.print();
  }, { once: true });
}
