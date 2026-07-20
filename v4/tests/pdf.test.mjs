import test from "node:test";
import assert from "node:assert/strict";
import { buildOrderDocument } from "../js/pdf.js";

test("PDF usa pedido salvo, PIX, observações e escapa HTML", () => {
  const html = buildOrderDocument({
    order: { project: "Peça <teste>", customer_name: "Cliente & Cia", customer_phone: "(11) 99999-0000", created_at: "2026-07-17T12:00:00-03:00", due_date: "2026-07-20", final_price: 150, description: "Descrição", notes: "Não usar <script>" },
    items: [{ name: "Suporte", quantity: 2, unit_weight_g: 25, material: "PLA" }],
    settings: { studio_name: "Studio", pix_key: "pix@example.com", general_notes: "Observação" },
  });
  assert.match(html, /Peça &lt;teste&gt;/);
  assert.match(html, /Cliente &amp; Cia/);
  assert.match(html, /\(11\) 99999-0000/);
  assert.match(html, /Não usar &lt;script&gt;/);
  assert.match(html, /pix@example\.com/);
  assert.match(html, /Observação/);
  assert.match(html, /R\$\s*150,00/);
});
